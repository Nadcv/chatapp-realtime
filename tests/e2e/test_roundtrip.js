const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Round Trip Test');
  await page.fill('#regUsername', 'roundtrip_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'roundtrip' + ts + '@test.com');
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

  // --- Trip (Tictactrip) round-trip ---
  await page.fill('#tripOriginInput', 'lyon');
  await page.waitForTimeout(500);
  await page.click('#tripOriginResults div:has-text("Lyon")');
  await page.fill('#tripDestinationInput', 'paris');
  await page.waitForTimeout(500);
  await page.click('#tripDestinationResults div:has-text("Paris")');
  await page.fill('#tripDateInput', '2026-09-19');
  await page.fill('#tripReturnDateInput', '2026-09-20');
  await page.click('button:has-text("Pesquisar preços")');
  await page.waitForTimeout(500);
  const tripText = await page.evaluate(() => document.getElementById('tripOffersResults').textContent);
  console.log('Mostra "Ida" para a viagem de outbound:', tripText.includes('Ida'));
  console.log('Mostra "Volta" para a viagem de inbound:', tripText.includes('Volta'));
  console.log('Mostra o preço da volta 15.50:', tripText.includes('15.50'));

  // --- Flight (Ignav) round-trip ---
  await page.click('.price-mode-tab[data-mode="flight"]');
  await page.waitForTimeout(200);
  await page.selectOption('#fpOriginInput', 'LIS');
  await page.selectOption('#fpDestinationInput', 'OPO');
  await page.fill('#fpDateInput', '2026-12-01');
  await page.fill('#fpReturnDateInput', '2026-12-08');
  await page.click('button:has-text("Pesquisar voos")');
  await page.waitForTimeout(500);
  const fpText = await page.evaluate(() => document.getElementById('fpResults').textContent);
  console.log('Mostra o preço combinado 150:', fpText.includes('150'));
  console.log('Mostra "(ida e volta)":', fpText.includes('ida e volta'));
  console.log('Mostra o troço de Ida:', fpText.includes('Ida:'));
  console.log('Mostra o troço de Volta:', fpText.includes('Volta:'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
