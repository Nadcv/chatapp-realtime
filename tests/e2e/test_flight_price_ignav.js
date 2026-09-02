const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  page.on('dialog', async (dialog) => { console.log('DIALOG:', dialog.message()); await dialog.dismiss(); });
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Flight Price Ignav Test');
  await page.fill('#regUsername', 'ignavtest_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'ignavtest' + ts + '@test.com');
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
    window.open = (url) => { window.__openedUrl = url; return null; };
  });

  await page.evaluate(() => openTransportScreen());
  await page.click('.transport-tab[data-tab="priceSearch"]');
  await page.waitForTimeout(300);

  const tripDefaultVisible = await page.evaluate(() => document.getElementById('tripModeFields').style.display === 'flex');
  console.log('Modo Comboio/Autocarro é o default:', tripDefaultVisible);

  await page.click('.price-mode-tab[data-mode="flight"]');
  await page.waitForTimeout(200);
  const flightVisible = await page.evaluate(() => document.getElementById('flightModeFields').style.display === 'flex');
  const tripHidden = await page.evaluate(() => document.getElementById('tripModeFields').style.display === 'none');
  console.log('Alternar para modo Voos mostra os campos certos:', flightVisible && tripHidden);

  await page.selectOption('#fpOriginInput', 'LIS');
  await page.selectOption('#fpDestinationInput', 'OPO');
  await page.fill('#fpDateInput', '2026-12-01');
  await page.click('button:has-text("Pesquisar voos")');
  await page.waitForTimeout(500);
  const offersText = await page.evaluate(() => document.getElementById('fpResults').textContent);
  console.log('Mostra o preço 45 (Ryanair, mais barato primeiro):', offersText.indexOf('45') < offersText.indexOf('89'));
  console.log('Mostra TAP Air Portugal:', offersText.includes('TAP Air Portugal'));
  console.log('Mostra Ryanair:', offersText.includes('Ryanair'));
  console.log('Mostra "1 escala(s)":', offersText.includes('1 escala'));
  console.log('Mostra "direto":', offersText.includes('direto'));

  await page.click('#fpResults button:has-text("Ver opções de reserva") >> nth=0');
  await page.waitForTimeout(400);
  const openedUrl = await page.evaluate(() => window.__openedUrl);
  console.log('Abre o link de reserva correto (não processa pagamento aqui):', openedUrl === 'https://example-airline.test/book/itin_stop_002');

  // Regression: switching back to trip mode and to other tabs
  await page.click('.price-mode-tab[data-mode="trip"]');
  await page.waitForTimeout(200);
  const backToTrip = await page.evaluate(() => document.getElementById('tripModeFields').style.display === 'flex');
  console.log('Volta ao modo Comboio/Autocarro corretamente:', backToTrip);

  await page.click('.transport-tab[data-tab="flight"]');
  await page.waitForTimeout(200);
  const liveFlightFilterOk = await page.evaluate(() => document.getElementById('flightFilterBar').style.display === 'flex');
  console.log('Aba Aviões (rastreamento ao vivo, filtro companhia) continua a funcionar:', liveFlightFilterOk);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
