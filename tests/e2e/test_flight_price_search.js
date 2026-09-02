const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Flight Price Test');
  await page.fill('#regUsername', 'flightprice_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'flightprice' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const bounds = { getSouth: () => 36.8, getNorth: () => 42.2, getWest: () => -9.6, getEast: () => -6.1 };
    const chainable = { setView: () => chainable, addTo: () => chainable, invalidateSize: () => {}, on: () => chainable, removeLayer: () => chainable, hasLayer: () => false, clearLayers: () => chainable, addLayer: () => chainable, bindPopup: () => chainable, setLatLng: () => chainable, remove: () => {}, getBounds: () => bounds };
    window.L = { map: () => chainable, tileLayer: () => chainable, layerGroup: () => chainable, marker: () => chainable, divIcon: () => ({}), polyline: () => chainable, icon: () => ({}) };
    window.fetch = ((realFetch) => (url, opts) => {
      if (String(url).startsWith('/api/metro/status')) return Promise.resolve(new Response(JSON.stringify({ lines: [] }), { status: 200 }));
      if (String(url).startsWith('/api/transport/buses')) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      return realFetch(url, opts);
    })(window.fetch.bind(window));
  });

  await page.evaluate(() => openTransportScreen());
  await page.click('.transport-tab[data-tab="priceSearch"]');
  await page.waitForTimeout(300);

  const barVisible = await page.evaluate(() => document.getElementById('flightPriceSearchBar').style.display === 'flex');
  console.log('Barra de pesquisa de preços aparece na aba Preços:', barVisible);
  const mapHidden = await page.evaluate(() => document.getElementById('transportMap').style.display === 'none');
  console.log('Mapa escondido nesta aba:', mapHidden);

  // Test "not configured" path (no mock server / no env keys set for this run)
  await page.fill('#flightOriginInput', 'lis');
  await page.waitForTimeout(500);
  const notConfiguredMsg = await page.evaluate(() => document.getElementById('flightOriginResults').textContent);
  console.log('Mostra aviso de "por configurar" quando faltam as chaves:', notConfiguredMsg.includes('por configurar'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
