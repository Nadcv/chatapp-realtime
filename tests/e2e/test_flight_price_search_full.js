const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Flight Price Full Test');
  await page.fill('#regUsername', 'flightpricefull_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'flightpricefull' + ts + '@test.com');
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

  await page.fill('#flightOriginInput', 'lis');
  await page.waitForTimeout(500);
  const originResults = await page.evaluate(() => document.getElementById('flightOriginResults').textContent);
  console.log('Resultados de origem mostram Lisboa:', originResults.includes('Lisboa'));
  await page.click('#flightOriginResults div:has-text("Lisboa")');
  const originValue = await page.evaluate(() => document.getElementById('flightOriginInput').value);
  console.log('Input de origem preenchido com "Lisboa (LIS)":', originValue.includes('LIS'));

  await page.fill('#flightDestinationInput', 'mad');
  await page.waitForTimeout(500);
  await page.click('#flightDestinationResults div:has-text("Madrid")');
  const destValue = await page.evaluate(() => document.getElementById('flightDestinationInput').value);
  console.log('Input de destino preenchido com "Madrid (MAD)":', destValue.includes('MAD'));

  await page.fill('#flightDateInput', '2026-09-15');
  await page.click('button:has-text("Pesquisar preços")');
  await page.waitForTimeout(500);
  const offersText = await page.evaluate(() => document.getElementById('flightOffersResults').textContent);
  console.log('Mostra o preço 89.9:', offersText.includes('89.9'));
  console.log('Mostra a companhia TAP Air Portugal:', offersText.includes('TAP Air Portugal'));
  console.log('Mostra a companhia Ryanair:', offersText.includes('Ryanair'));
  console.log('Mostra "1 escala(s)" para o voo com ligação:', offersText.includes('1 escala'));
  console.log('Mostra "direto" para o voo sem escalas:', offersText.includes('direto'));

  // Regression: flight filter tab (companies) still works
  await page.click('.transport-tab[data-tab="flight"]');
  await page.waitForTimeout(300);
  const flightFilterVisible = await page.evaluate(() => document.getElementById('flightFilterBar').style.display === 'flex');
  console.log('Aba Aviões (filtro companhia) continua a funcionar:', flightFilterVisible);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
