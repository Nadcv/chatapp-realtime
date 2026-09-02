const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

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
  await page.fill('#regName', 'Tourism Weather Test');
  await page.fill('#regUsername', 'tourismwx_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'tourismwx' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.__weatherRequests = [];
    window.fetch = (url, ...rest) => {
      if (typeof url === 'string' && url.includes('/api/weather')) {
        window.__weatherRequests.push(url);
        return Promise.resolve(new Response(JSON.stringify({
          place: null,
          current: { temperature_2m: 21.4, weather_code: 0, relative_humidity_2m: 60, apparent_temperature: 22, wind_speed_10m: 10 },
          daily: { weather_code: [0], temperature_2m_max: [25], temperature_2m_min: [15], precipitation_probability_max: [0] }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (typeof url === 'string' && url.includes('/api/tourism/poi')) {
        return Promise.resolve(new Response(JSON.stringify({ points: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, ...rest);
    };
  });

  await page.evaluate(() => openTourismScreen());
  await page.waitForSelector('#tourismScreen.active', { timeout: 3000 });

  const chipHiddenInitially = await page.evaluate(() => document.getElementById('tourismWeather').style.display === 'none');
  console.log('Weather chip is hidden before any search happens:', chipHiddenInitially);

  await page.evaluate(() => flyTourismTo('madrid'));
  await page.waitForTimeout(500);

  const weatherRequestedWithCoords = await page.evaluate(() => window.__weatherRequests.some(u => u.includes('lat=') && u.includes('lon=')));
  console.log('Flying to a city requests weather using lat/lon (not a place name):', weatherRequestedWithCoords);

  const chipVisible = await page.evaluate(() => document.getElementById('tourismWeather').style.display === 'block');
  console.log('Weather chip becomes visible after loading:', chipVisible);

  const chipText = await page.evaluate(() => document.getElementById('tourismWeather').textContent);
  console.log('Weather chip shows the temperature from the response:', chipText.includes('21°C'));
  console.log('Weather chip shows a weather icon for the given code:', chipText.includes('☀️'));

  // Even a whole-country zoom level (which skips the POI search) still shows weather.
  await page.evaluate(() => { window.__weatherRequests = []; });
  await page.evaluate(() => flyTourismTo('portugal'));
  await page.waitForTimeout(500);
  const weatherStillLoadsAtCountryZoom = await page.evaluate(() => window.__weatherRequests.length > 0);
  const statusStillAsksZoom = await page.evaluate(() => document.getElementById('tourismStatus').textContent.includes('Aproxima-te'));
  console.log('Weather still loads even at whole-country zoom (where POI search is skipped):', weatherStillLoadsAtCountryZoom && statusStillAsksZoom);

  // A failed weather fetch hides the chip gracefully instead of showing stale/broken data.
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, ...rest) => {
      if (typeof url === 'string' && url.includes('/api/weather')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'falha' }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
      }
      if (typeof url === 'string' && url.includes('/api/tourism/poi')) {
        return Promise.resolve(new Response(JSON.stringify({ points: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, ...rest);
    };
  });
  await page.evaluate(() => flyTourismTo('paris'));
  await page.waitForTimeout(500);
  const chipHiddenOnFailure = await page.evaluate(() => document.getElementById('tourismWeather').style.display === 'none');
  console.log('A failed weather request hides the chip gracefully (no broken/stale display):', chipHiddenOnFailure);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
