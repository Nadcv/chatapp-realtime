const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Flight Deals Test');
  await page.fill('#regUsername', 'flightdeals_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'flightdeals' + ts + '@test.com');
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
  await page.click('.price-mode-tab[data-mode="flight"]');
  await page.waitForTimeout(200);

  await page.selectOption('#fpOriginInput', 'LIS');
  await page.fill('#fpDateInput', '2026-12-01');
  await page.click('button:has-text("Voos baratos")');
  await page.waitForTimeout(1000);

  const text = await page.evaluate(() => document.getElementById('fpResults').textContent);
  const rowCount = await page.evaluate(() => document.getElementById('fpResults').children.length);
  console.log('Mostra Valência na lista:', text.includes('Valência'));
  console.log('Mostra Paris (mais barato) antes de Valência (ordenado por preço):', text.indexOf('Paris') < text.indexOf('Valência'));
  console.log('Mostra 16 destinos:', rowCount === 16);

  // Click a deal, should fill destination and run full search
  await page.click('#fpResults div:has-text("Valência")');
  await page.waitForTimeout(500);
  const destValue = await page.evaluate(() => document.getElementById('fpDestinationInput').value);
  console.log('Clicar num destino preenche o campo destino (VLC):', destValue === 'VLC');
  const offersText = await page.evaluate(() => document.getElementById('fpResults').textContent);
  console.log('E corre a pesquisa completa para essa rota (mostra opções de reserva):', offersText.includes('Ver opções de reserva'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
