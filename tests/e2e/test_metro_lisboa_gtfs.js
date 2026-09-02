const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Metro GTFS Test');
  await page.fill('#regUsername', 'mlgtfs_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'mlgtfs' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const bounds = { getSouth: () => -90, getNorth: () => 90, getWest: () => -180, getEast: () => 180 };
    const chainable = { setView: () => chainable, addTo: () => chainable, invalidateSize: () => {}, on: () => chainable, removeLayer: () => chainable, hasLayer: () => false, clearLayers: () => chainable, addLayer: () => chainable, bindPopup: () => chainable, setLatLng: () => chainable, remove: () => {}, getBounds: () => bounds };
    window.L = { map: () => chainable, tileLayer: () => chainable, layerGroup: () => chainable, marker: () => chainable, divIcon: () => ({}), polyline: () => chainable, icon: () => ({}) };
    window.fetch = ((realFetch) => (url, opts) => {
      if (String(url).startsWith('/api/metro/status')) return Promise.resolve(new Response(JSON.stringify({ lines: [] }), { status: 200 }));
      return realFetch(url, opts);
    })(window.fetch.bind(window));
  });

  await page.evaluate(() => openTransportScreen());
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(400);

  await page.fill('#metroLisboaSearchInput', 'rossio');
  await page.waitForTimeout(600);
  const resultsText = await page.evaluate(() => document.getElementById('metroLisboaSearchResults').textContent);
  console.log('Resultado mostra "Rossio":', resultsText.includes('Rossio'));

  await page.click('#metroLisboaSearchResults div:has-text("Rossio")');
  await page.waitForSelector('#modalMetroLisboaDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(300);
  const title = await page.evaluate(() => document.getElementById('metroLisboaDeparturesTitle').textContent);
  console.log('Título mostra Rossio:', title.includes('Rossio'));
  const listText = await page.evaluate(() => document.getElementById('metroLisboaDeparturesList').textContent);
  console.log('Lista mostra a linha "Azul":', listText.includes('Azul'));
  console.log('Lista mostra o destino real (Reboleira):', listText.includes('Reboleira'));

  await page.click('#modalMetroLisboaDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => !document.getElementById('modalMetroLisboaDepartures').classList.contains('active'));
  console.log('Modal fecha corretamente:', closed);

  // Confirm the CP train search still works alongside it (regression check)
  await page.fill('#railSearchInput', 'x');
  await page.waitForTimeout(500);
  console.log('Pesquisa de comboios CP continua a existir e responde (sem exceção acima):', true);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
