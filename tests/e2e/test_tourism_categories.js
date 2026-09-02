const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  // Leaflet's real CDN is blocked by this sandbox's proxy — same limitation as
  // before. Inject a minimal fake L so the tourism map integration code runs.
  await page.addInitScript(() => {
    function FakeLayerGroup() { this._layers = []; }
    FakeLayerGroup.prototype.addTo = function () { return this; };
    FakeLayerGroup.prototype.clearLayers = function () { this._layers = []; };
    FakeLayerGroup.prototype.getLayers = function () { return this._layers; };
    function FakeMarker(latlng) { this._latlng = { lat: latlng[0], lng: latlng[1] }; this._tooltip = null; this._handlers = {}; }
    FakeMarker.prototype.bindTooltip = function (text) { this._tooltip = text; return this; };
    FakeMarker.prototype.getTooltip = function () { return { getContent: () => this._tooltip }; };
    FakeMarker.prototype.on = function (evt, cb) { this._handlers[evt] = cb; return this; };
    FakeMarker.prototype.fire = function (evt) { if (this._handlers[evt]) this._handlers[evt](); };
    FakeMarker.prototype.addTo = function (target) { target._layers.push(this); return this; };
    function FakeMap(center, zoom) { this._center = { lat: center[0], lng: center[1] }; this._zoom = zoom; this._handlers = {}; this._layers = []; }
    FakeMap.prototype.setView = function (latlng, zoom) { this._center = { lat: latlng[0], lng: latlng[1] }; if (zoom != null) this._zoom = zoom; return this; };
    FakeMap.prototype.getCenter = function () { return this._center; };
    FakeMap.prototype.getZoom = function () { return this._zoom; };
    FakeMap.prototype.on = function (evt, cb) { this._handlers[evt] = cb; return this; };
    FakeMap.prototype.invalidateSize = function () {};
    FakeMap.prototype.removeLayer = function () {};
    FakeMap.prototype.fitBounds = function () {};
    window.L = {
      map: () => new FakeMap([39.5, -8], 6),
      tileLayer: () => ({ addTo: () => {} }),
      layerGroup: () => new FakeLayerGroup(),
      marker: (latlng) => new FakeMarker(latlng)
    };
  });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Tourism Category Test');
  await page.fill('#regUsername', 'tourismcat_' + ts);
  await page.fill('#regPhone', '+3511' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'tourismcat' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.__categoryRequests = [];
    window.fetch = (url, ...rest) => {
      if (typeof url === 'string' && url.includes('/api/tourism/category')) {
        window.__categoryRequests.push(url);
        const u = new URL(url, location.origin);
        const cat = u.searchParams.get('category');
        const fixtures = {
          praias: [{ title: 'Praia de Carcavelos', lat: 38.6779, lon: -9.3369, wikiTitle: null }],
          museus: [{ title: 'Museu Nacional de Arte Antiga', lat: 38.7053, lon: -9.1614, wikiTitle: 'Museu Nacional de Arte Antiga' }],
          atracoes: [{ title: 'Miradouro da Graça', lat: 38.7156, lon: -9.1305, wikiTitle: null }],
          parques: [{ title: 'Parque Eduardo VII', lat: 38.7280, lon: -9.1539, wikiTitle: 'Parque Eduardo VII' }]
        };
        return Promise.resolve(new Response(JSON.stringify({ points: fixtures[cat] || [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (typeof url === 'string' && url.includes('/api/tourism/poi')) {
        return Promise.resolve(new Response(JSON.stringify({ points: [{ title: 'Castelo de S. Jorge', lat: 38.7139, lon: -9.1335, distanceM: 50 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (typeof url === 'string' && url.includes('/api/tourism/details')) {
        const u = new URL(url, location.origin);
        const title = u.searchParams.get('title');
        if (title === 'Museu Nacional de Arte Antiga') {
          return Promise.resolve(new Response(JSON.stringify({ extract: 'O maior museu de arte de Portugal.', thumbnail: null, wikiUrl: 'https://pt.wikipedia.org/wiki/Museu_Nacional_de_Arte_Antiga' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        // Um ponto do OSM sem título de Wikipédia correspondente -> a API real
        // provavelmente devolveria 404; simulamos essa falha aqui.
        return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, ...rest);
    };
  });

  await page.evaluate(() => openTourismScreen());
  await page.waitForSelector('#tourismScreen.active', { timeout: 3000 });
  await page.evaluate(() => TOURISM.map.setView([38.72, -9.14], 13));

  // Default category is "Geral" (Wikipedia-based, existing behaviour) and its chip starts active.
  const geralActiveByDefault = await page.evaluate(() => document.querySelector('.tourism-category[data-category="geral"]').classList.contains('btn-accept'));
  console.log('"Geral" is the active category by default:', geralActiveByDefault);

  await page.evaluate(() => searchTourismHere());
  await page.waitForTimeout(300);
  const geralUsesOldEndpoint = await page.evaluate(() => TOURISM.layer.getLayers().some(l => l.getTooltip().getContent() === 'Castelo de S. Jorge'));
  console.log('"Geral" still uses the original Wikipedia-based /api/tourism/poi endpoint:', geralUsesOldEndpoint);

  // Switching to "Praias" calls the new category endpoint and plots the returned beach.
  await page.evaluate(() => setTourismCategory('praias'));
  await page.waitForTimeout(300);
  const praiasChipActive = await page.evaluate(() => document.querySelector('.tourism-category[data-category="praias"]').classList.contains('btn-accept'));
  const geralChipInactive = await page.evaluate(() => !document.querySelector('.tourism-category[data-category="geral"]').classList.contains('btn-accept'));
  console.log('Selecting "Praias" activates its chip and deactivates the previous one:', praiasChipActive && geralChipInactive);

  const praiasRequestedCategory = await page.evaluate(() => window.__categoryRequests.some(u => u.includes('category=praias')));
  console.log('Selecting "Praias" calls /api/tourism/category with category=praias:', praiasRequestedCategory);

  const beachMarkerShown = await page.evaluate(() => TOURISM.layer.getLayers().some(l => l.getTooltip().getContent() === 'Praia de Carcavelos'));
  console.log('The beach returned by the category search is plotted on the map:', beachMarkerShown);

  // Museums: a point WITH an OSM "wikipedia" tag must use that exact title for its details lookup.
  await page.evaluate(() => setTourismCategory('museus'));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const marker = TOURISM.layer.getLayers().find(l => l.getTooltip().getContent() === 'Museu Nacional de Arte Antiga');
    marker.fire('click');
  });
  await page.waitForSelector('#modalTourismPoi.active', { timeout: 3000 });
  await page.waitForTimeout(300);
  const museumExtract = await page.evaluate(() => document.getElementById('tourismPoiExtract').textContent);
  console.log('A museum with an OSM "wikipedia" tag correctly fetches its real Wikipedia summary:', museumExtract.includes('maior museu de arte'));
  await page.click('#modalTourismPoi button:has-text("Fechar")');

  // Attractions: a point WITHOUT a wikipedia tag falls back gracefully (no crash, no scary error).
  await page.evaluate(() => setTourismCategory('atracoes'));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const marker = TOURISM.layer.getLayers().find(l => l.getTooltip().getContent() === 'Miradouro da Graça');
    marker.fire('click');
  });
  await page.waitForTimeout(300);
  const attractionExtract = await page.evaluate(() => document.getElementById('tourismPoiExtract').textContent);
  console.log('A point with no matching Wikipedia article shows a graceful message (not a scary error):', attractionExtract.includes('Sem descrição disponível'));
  const attractionTitle = await page.evaluate(() => document.getElementById('tourismPoiTitle').textContent);
  console.log('The point still shows its real OSM name as the title:', attractionTitle === 'Miradouro da Graça');
  await page.click('#modalTourismPoi button:has-text("Fechar")');

  // Parks/squares category.
  await page.evaluate(() => setTourismCategory('parques'));
  await page.waitForTimeout(300);
  const parkMarkerShown = await page.evaluate(() => TOURISM.layer.getLayers().some(l => l.getTooltip().getContent() === 'Parque Eduardo VII'));
  console.log('The "Parques/Praças" category is wired up and plots results:', parkMarkerShown);

  // XSS safety for category-sourced points too (OSM names are also untrusted external data).
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.__xssFired = false;
    window.fetch = (url) => {
      if (typeof url === 'string' && url.includes('/api/tourism/category')) {
        return Promise.resolve(new Response(JSON.stringify({ points: [{ title: '<img src=x onerror="window.__xssFired=true">', lat: 38.7, lon: -9.1, wikiTitle: null }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url);
    };
  });
  await page.evaluate(() => setTourismCategory('museus'));
  await page.waitForTimeout(300);
  const xssFired = await page.evaluate(() => window.__xssFired === true);
  console.log('A malicious OSM-sourced name does NOT execute as script (XSS-safe):', !xssFired);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
