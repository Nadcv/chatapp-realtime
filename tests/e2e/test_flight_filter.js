const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Flight Filter Test');
  await page.fill('#regUsername', 'flighttest_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'flighttest' + ts + '@test.com');
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
      if (String(url).startsWith('/api/transport/flights')) {
        const states = [
          ['abc123', 'TAP123  ', 'Portugal', 0, 0, -9.1, 38.7, 9000, false, 230, 90, 0, null, 9000, '1000', false, 0, 'A320'],
          ['def456', 'RYR456  ', 'Ireland', 0, 0, -8.5, 39.0, 10000, false, 240, 100, 0, null, 10000, '2000', false, 0, 'B738'],
          ['ghi789', 'TAP789  ', 'Portugal', 0, 0, -7.9, 38.5, 8000, false, 220, 80, 0, null, 8000, '3000', false, 0, 'A320'],
        ];
        return Promise.resolve(new Response(JSON.stringify({ states }), { status: 200 }));
      }
      return realFetch(url, opts);
    })(window.fetch.bind(window));
  });

  await page.evaluate(() => openTransportScreen());
  await page.click('.transport-tab[data-tab="flight"]');
  await page.waitForTimeout(500);

  const statusNoFilter = await page.evaluate(() => document.getElementById('transportStatus').textContent);
  console.log('Sem filtro mostra 3 voos:', statusNoFilter.includes('3 voos'));

  await page.fill('#flightAirlineFilterInput', 'tap');
  await page.waitForTimeout(300);
  const statusTap = await page.evaluate(() => document.getElementById('transportStatus').textContent);
  console.log('Filtro "tap" mostra 2 voos filtrados:', statusTap.includes('2 voos') && statusTap.toUpperCase().includes('TAP'));

  await page.fill('#flightAirlineFilterInput', 'RYR');
  await page.waitForTimeout(300);
  const statusRyr = await page.evaluate(() => document.getElementById('transportStatus').textContent);
  console.log('Filtro "RYR" mostra 1 voo filtrado:', statusRyr.includes('1 voos') || statusRyr.includes('1 voo'));

  await page.fill('#flightAirlineFilterInput', '');
  await page.waitForTimeout(300);
  const statusCleared = await page.evaluate(() => document.getElementById('transportStatus').textContent);
  console.log('Limpar filtro volta a mostrar 3 voos:', statusCleared.includes('3 voos'));

  // Regression: switching tabs still works
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(300);
  const flightBarHidden = await page.evaluate(() => document.getElementById('flightFilterBar').style.display === 'none');
  console.log('Barra de filtro de voos escondida fora da aba Aviões:', flightBarHidden);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
