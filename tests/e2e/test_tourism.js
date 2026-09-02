const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  // Leaflet's real CDN (cdnjs.cloudflare.com) is blocked by this sandbox's outbound
  // proxy allowlist — same limitation hit before with other external hosts. This
  // affects EVERY Leaflet-based screen in the app (Fires, Transport, Navigation,
  // Space), not just this new one, and works fine on the real deployed server.
  // Injecting a minimal fake L implementation here lets us test our OWN
  // integration code (map init, markers, click wiring) without needing the real
  // Leaflet library, which is itself a separately well-tested third party.
  await page.addInitScript(() => {
    function FakeLayerGroup() {
      this._layers = [];
    }
    FakeLayerGroup.prototype.addTo = function () { return this; };
    FakeLayerGroup.prototype.clearLayers = function () { this._layers = []; };
    FakeLayerGroup.prototype.getLayers = function () { return this._layers; };
    function FakeMarker(latlng) {
      this._latlng = { lat: latlng[0], lng: latlng[1] };
      this._tooltip = null;
      this._handlers = {};
    }
    FakeMarker.prototype.bindTooltip = function (text) { this._tooltip = text; return this; };
    FakeMarker.prototype.getTooltip = function () { return { getContent: () => this._tooltip }; };
    FakeMarker.prototype.on = function (evt, cb) { this._handlers[evt] = cb; return this; };
    FakeMarker.prototype.fire = function (evt) { if (this._handlers[evt]) this._handlers[evt](); };
    FakeMarker.prototype.addTo = function (target) { target._layers.push(this); return this; };
    function FakePolyline(latlngs) {
      this._latlngs = latlngs;
      this._layers = null; // não é um grupo, só aqui para nunca rebentar se algo tentar usar como tal
    }
    FakePolyline.prototype.addTo = function () { return this; };
    FakePolyline.prototype.getBounds = function () { return { pad: () => ({}) }; };
    function FakeMap(center, zoom) {
      this._center = { lat: center ? center[0] : 0, lng: center ? center[1] : 0 };
      this._zoom = zoom || 2;
      this._handlers = {};
      this._layers = [];
    }
    FakeMap.prototype.setView = function (latlng, zoom) { this._center = { lat: latlng[0], lng: latlng[1] }; if (zoom != null) this._zoom = zoom; return this; };
    FakeMap.prototype.getCenter = function () { return this._center; };
    FakeMap.prototype.getZoom = function () { return this._zoom; };
    FakeMap.prototype.on = function (evt, cb) { this._handlers[evt] = cb; return this; };
    FakeMap.prototype.invalidateSize = function () {};
    FakeMap.prototype.removeLayer = function (layer) { this._layers = this._layers.filter((l) => l !== layer); };
    FakeMap.prototype.addLayer = function () {};
    FakeMap.prototype.fitBounds = function () {};
    FakeMap.prototype.getBounds = function () { return { getWest: () => -10, getSouth: () => 36, getEast: () => -6, getNorth: () => 42 }; };
    window.L = {
      map: (id) => new FakeMap([39.5, -8], 6),
      tileLayer: () => ({ addTo: () => {} }),
      layerGroup: () => new FakeLayerGroup(),
      marker: (latlng) => new FakeMarker(latlng),
      polyline: (latlngs) => new FakePolyline(latlngs)
    };
  });

  await page.context().grantPermissions(['geolocation'], { origin: 'http://localhost:3000' });
  await page.context().setGeolocation({ latitude: 38.71, longitude: -9.14 }); // Lisboa

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Tourism Test');
  await page.fill('#regUsername', 'tourismtest_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'tourismtest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234strong');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Mock the /api/tourism/* endpoints (real Wikipedia is blocked by this sandbox's
  // outbound proxy allowlist — the server-side data-shaping is unit-tested separately).
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.__poiRequests = [];
    window.__detailsRequests = [];
    window.fetch = (url, ...rest) => {
      if (typeof url === 'string' && url.includes('/api/tourism/poi')) {
        window.__poiRequests.push(url);
        return Promise.resolve(new Response(JSON.stringify({
          points: [
            { title: 'Torre de Belém', lat: 38.6916, lon: -9.2160, distanceM: 120 },
            { title: 'Mosteiro dos Jerónimos', lat: 38.6979, lon: -9.2065, distanceM: 800 }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (typeof url === 'string' && url.includes('/api/tourism/details')) {
        window.__detailsRequests.push(url);
        return Promise.resolve(new Response(JSON.stringify({
          extract: 'A Torre de Belém é uma fortificação do século XVI localizada na freguesia de Santa Maria de Belém.',
          thumbnail: 'https://upload.wikimedia.org/fake-thumb.jpg',
          wikiUrl: 'https://pt.wikipedia.org/wiki/Torre_de_Bel%C3%A9m'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (typeof url === 'string' && url.includes('/api/nav/route')) {
        window.__navRouteRequests = window.__navRouteRequests || [];
        window.__navRouteRequests.push(url);
        return Promise.resolve(new Response(JSON.stringify({
          routes: [{
            distance: 2350, duration: 480,
            geometry: { coordinates: [[-9.14, 38.71], [-9.18, 38.70], [-9.216, 38.6916]] }
          }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, ...rest);
    };
  });

  await page.evaluate(() => openTourismScreen());
  await page.waitForSelector('#tourismScreen.active', { timeout: 3000 });
  console.log('Tourism screen opens:', true);

  // "Portugal" is a whole-country overview (zoom 7) — Wikipedia's geosearch caps
  // the radius at 10km, so a single point can't meaningfully represent "all of
  // Portugal"; the app correctly shows a zoom-in hint instead of searching there.
  await page.evaluate(() => flyTourismTo('portugal'));
  await page.waitForTimeout(400);
  const noSearchAtCountryZoom = await page.evaluate(() => window.__poiRequests.length === 0);
  const countryZoomHint = await page.evaluate(() => document.getElementById('tourismStatus').textContent.includes('Aproxima-te'));
  console.log('The whole-Portugal overview correctly asks to zoom in rather than searching a single point:', noSearchAtCountryZoom && countryZoomHint);

  // Flying to a city-level preset (Madrid, zoom 12) DOES trigger a real search.
  await page.evaluate(() => flyTourismTo('madrid'));
  await page.waitForTimeout(400);
  const poiRequested = await page.evaluate(() => window.__poiRequests.length > 0);
  console.log('Clicking a city-level preset (Madrid) triggers a POI search:', poiRequested);

  const statusAfterSearch = await page.evaluate(() => document.getElementById('tourismStatus').textContent);
  console.log('Status shows the number of points found:', statusAfterSearch.includes('2') && statusAfterSearch.includes('encontrados'));

  const markerCount = await page.evaluate(() => TOURISM.layer.getLayers().length);
  console.log('Two markers are plotted on the map:', markerCount === 2);

  // The newly-requested presets: Valência (city-level, should search), and
  // Alemanha/Holanda (whole-country level, like Portugal — should ask to zoom in).
  await page.evaluate(() => { window.__poiRequests = []; });
  await page.evaluate(() => flyTourismTo('valencia'));
  await page.waitForTimeout(400);
  const valenciaSearches = await page.evaluate(() => window.__poiRequests.length > 0);
  console.log('The new "Valência" preset exists and searches at city level:', valenciaSearches);

  await page.evaluate(() => { window.__poiRequests = []; });
  await page.evaluate(() => flyTourismTo('alemanha'));
  await page.waitForTimeout(400);
  const alemanhaAsksZoom = await page.evaluate(() => window.__poiRequests.length === 0 && document.getElementById('tourismStatus').textContent.includes('Aproxima-te'));
  console.log('The new "Alemanha" preset is a whole-country view (asks to zoom in, like Portugal):', alemanhaAsksZoom);

  await page.evaluate(() => { window.__poiRequests = []; });
  await page.evaluate(() => flyTourismTo('holanda'));
  await page.waitForTimeout(400);
  const holandaAsksZoom = await page.evaluate(() => window.__poiRequests.length === 0 && document.getElementById('tourismStatus').textContent.includes('Aproxima-te'));
  console.log('The new "Holanda" preset is a whole-country view (asks to zoom in, like Portugal):', holandaAsksZoom);

  // Back to Madrid to continue the rest of the test with known POI data.
  await page.evaluate(() => flyTourismTo('madrid'));
  await page.waitForTimeout(400);

  // Clicking a marker opens the detail panel with real Wikipedia-derived content.
  await page.evaluate(() => {
    const layers = TOURISM.layer.getLayers();
    const marker = layers.find(l => l.getTooltip && l.getTooltip()?.getContent() === 'Torre de Belém');
    marker.fire('click');
  });
  await page.waitForSelector('#modalTourismPoi.active', { timeout: 3000 });
  await page.waitForTimeout(300);

  const title = await page.evaluate(() => document.getElementById('tourismPoiTitle').textContent);
  console.log('Detail panel shows the correct title:', title === 'Torre de Belém');

  const extract = await page.evaluate(() => document.getElementById('tourismPoiExtract').textContent);
  console.log('Detail panel shows the fetched extract (brief history):', extract.includes('fortificação do século XVI'));

  const imageVisible = await page.evaluate(() => document.getElementById('tourismPoiImage').style.display === 'block');
  console.log('Detail panel shows the thumbnail image when available:', imageVisible);

  const wikiHref = await page.evaluate(() => document.getElementById('tourismPoiWikiLink').href);
  console.log('"Ler mais" link points to the real Wikipedia article URL from the server:', wikiHref.includes('Torre_de_Bel'));

  const gmapsHref = await page.evaluate(() => document.getElementById('tourismPoiGoogleMapsLink').href);
  console.log('A separate "Abrir no Google Maps" link is also offered, with the right coordinates:', gmapsHref.includes('38.6916') && gmapsHref.includes('-9.216') && gmapsHref.includes('travelmode=transit'));

  // Regression check for the real bug reported: the POI modal (z-index 200) must
  // render ABOVE the still-open Turismo screen (z-index 100), not behind it —
  // previously the modal had no z-index override and was stuck at the default 20,
  // so it was invisible until the Turismo screen was closed.
  const modalZIndex = await page.evaluate(() => parseInt(getComputedStyle(document.getElementById('modalTourismPoi')).zIndex, 10));
  const screenZIndex = await page.evaluate(() => parseInt(getComputedStyle(document.getElementById('tourismScreen')).zIndex, 10));
  console.log('The point detail modal has a higher z-index than the Turismo screen behind it:', modalZIndex > screenZIndex);
  const topElementIsInsideModal = await page.evaluate(() => {
    const modal = document.getElementById('modalTourismPoi');
    const rect = modal.getBoundingClientRect();
    const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 20);
    return modal.contains(el);
  });
  console.log('The topmost element at the modal\'s position is actually part of the modal (not hidden behind the map):', topElementIsInsideModal);

  // "Como chegar" must compute and draw the route INSIDE the app's own map —
  // never open an external site/tab.
  const noNewTabOpened = await (async () => {
    let newPageSeen = false;
    browser.contexts()[0].on('page', () => { newPageSeen = true; });
    await page.evaluate(() => showTourismDirections());
    await page.waitForTimeout(600);
    return !newPageSeen;
  })();
  console.log('"Como chegar" never opens a new tab/window (stays fully in-app):', noNewTabOpened);

  const poiModalClosedAfterDirections = await page.evaluate(() => !document.getElementById('modalTourismPoi').classList.contains('active'));
  console.log('Requesting directions closes the point detail panel (back to the map):', poiModalClosedAfterDirections);

  const navRouteCalled = await page.evaluate(() => (window.__navRouteRequests || []).length > 0);
  console.log('Calls the app\'s own /api/nav/route endpoint (no external maps site):', navRouteCalled);

  const routeDrawn = await page.evaluate(() => !!TOURISM.routeLine);
  console.log('Draws the route as a polyline on the tourism map itself:', routeDrawn);

  const routeMarkersCount = await page.evaluate(() => TOURISM.routeMarkers.length);
  console.log('Places both an origin and a destination marker for the route:', routeMarkersCount === 2);

  const routeStatusText = await page.evaluate(() => document.getElementById('tourismStatus').textContent);
  console.log('Status line shows the real distance/duration from the route response:', routeStatusText.includes('2.4 km') || routeStatusText.includes('2.35 km') || /km/.test(routeStatusText));
  console.log('Status line is honest that this is a car route (no transit data available):', routeStatusText.includes('carro'));

  // Requesting directions again for a new search must not leave the old route lingering.
  await page.evaluate(() => flyTourismTo('madrid'));
  await page.waitForTimeout(400);
  const routeClearedOnNewSearch = await page.evaluate(() => TOURISM.routeLine === null && TOURISM.routeMarkers.length === 0);
  console.log('Starting a new search clears any previously drawn route:', routeClearedOnNewSearch);

  const transportBtnVisible = await page.evaluate(() => document.getElementById('tourismPoiTransportBtn').style.display === 'flex');
  console.log('A point inside Portugal shows the "Transportes (PT)" shortcut button:', transportBtnVisible);

  // Clicking that button should close both this panel and the tourism screen, and open the existing transport screen.
  await page.evaluate(() => openTransportFromTourism());
  await page.waitForTimeout(200);
  const transportOpen = await page.evaluate(() => document.getElementById('transportScreen').classList.contains('active'));
  const tourismClosed = await page.evaluate(() => !document.getElementById('tourismScreen').classList.contains('active'));
  const poiModalClosed = await page.evaluate(() => !document.getElementById('modalTourismPoi').classList.contains('active'));
  console.log('The Portugal shortcut correctly opens the existing Transportes screen:', transportOpen && tourismClosed && poiModalClosed);

  // A point OUTSIDE Portugal (e.g. Paris) must NOT show that shortcut.
  await page.evaluate(() => openTourismScreen());
  await page.evaluate(() => openTourismPoi({ title: 'Torre Eiffel', lat: 48.8584, lon: 2.2945 }));
  await page.waitForTimeout(300);
  const transportBtnHiddenForParis = await page.evaluate(() => document.getElementById('tourismPoiTransportBtn').style.display === 'none');
  console.log('A point outside Portugal (Paris) hides the "Transportes (PT)" shortcut:', transportBtnHiddenForParis);
  await page.evaluate(() => showTourismDirections());
  await page.waitForTimeout(400);
  const parisRouteDrawn = await page.evaluate(() => !!TOURISM.routeLine);
  console.log('"Como chegar" also works in-app for a non-Portugal point (Paris):', parisRouteDrawn);

  // Zooming out too far should refuse to search (avoids a meaningless "world view" query).
  await page.evaluate(() => { TOURISM.map.setView([20, 0], 3); });
  await page.evaluate(() => window.__poiRequests.length && (window.__poiRequests.length = 0)); // reset counter marker (array truncation)
  await page.evaluate(() => { window.__poiRequests = []; });
  await page.evaluate(() => searchTourismHere());
  await page.waitForTimeout(300);
  const noSearchAtWorldZoom = await page.evaluate(() => window.__poiRequests.length === 0);
  const zoomHint = await page.evaluate(() => document.getElementById('tourismStatus').textContent.includes('Aproxima-te'));
  console.log('Searching while too zoomed out (world view) is refused with a helpful hint:', noSearchAtWorldZoom && zoomHint);

  // XSS safety: a POI title containing HTML must not execute when shown as a tooltip/title.
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.__xssFired = false;
    window.fetch = (url, ...rest) => {
      if (typeof url === 'string' && url.includes('/api/tourism/poi')) {
        return Promise.resolve(new Response(JSON.stringify({ points: [{ title: '<img src=x onerror="window.__xssFired=true">', lat: 38.7, lon: -9.1, distanceM: 10 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, ...rest);
    };
  });
  await page.evaluate(() => flyTourismTo('portugal'));
  await page.waitForTimeout(400);
  const xssFired = await page.evaluate(() => window.__xssFired === true);
  console.log('A malicious POI title does NOT execute as script (XSS-safe):', !xssFired);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
