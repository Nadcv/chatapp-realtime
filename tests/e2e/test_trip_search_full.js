const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Trip Search Test');
  await page.fill('#regUsername', 'tripsearch_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'tripsearch' + ts + '@test.com');
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

  const barVisible = await page.evaluate(() => document.getElementById('tripSearchBar').style.display === 'flex');
  console.log('Barra de pesquisa aparece na aba Preços:', barVisible);

  await page.fill('#tripOriginInput', 'lyon');
  await page.waitForTimeout(500);
  const originResults = await page.evaluate(() => document.getElementById('tripOriginResults').textContent);
  console.log('Resultados de origem mostram Lyon:', originResults.includes('Lyon'));
  await page.click('#tripOriginResults div:has-text("Lyon")');
  const originValue = await page.evaluate(() => document.getElementById('tripOriginInput').value);
  console.log('Input de origem preenchido:', originValue.includes('Lyon'));

  await page.fill('#tripDestinationInput', 'paris');
  await page.waitForTimeout(500);
  await page.click('#tripDestinationResults div:has-text("Paris")');
  const destValue = await page.evaluate(() => document.getElementById('tripDestinationInput').value);
  console.log('Input de destino preenchido:', destValue.includes('Paris'));

  await page.fill('#tripDateInput', '2026-09-19');
  await page.click('button:has-text("Pesquisar preços")');
  await page.waitForTimeout(500);
  const offersText = await page.evaluate(() => document.getElementById('tripOffersResults').textContent);
  console.log('Mostra o preço 14.20:', offersText.includes('14.20'));
  console.log('Mostra Flixbus:', offersText.includes('Flixbus'));
  console.log('Mostra OUIGO e SNCF (juntos):', offersText.includes('OUIGO, SNCF'));
  console.log('Mostra "1 escala(s)" para o comboio com ligação:', offersText.includes('1 escala'));
  console.log('Mostra "direto" para o autocarro sem escalas:', offersText.includes('direto'));
  console.log('Mostra pegada de CO2:', offersText.includes('CO'));

  // Regression: other tabs still work
  await page.click('.transport-tab[data-tab="flight"]');
  await page.waitForTimeout(300);
  const flightFilterVisible = await page.evaluate(() => document.getElementById('flightFilterBar').style.display === 'flex');
  console.log('Aba Aviões (filtro companhia) continua a funcionar:', flightFilterVisible);
  const tripBarHidden = await page.evaluate(() => document.getElementById('tripSearchBar').style.display === 'none');
  console.log('Barra de pesquisa de preços escondida fora da sua aba:', tripBarHidden);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
