const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Travel Stats Test');
  await page.fill('#regUsername', 'travelstats_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'travelstats' + ts + '@test.com');
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
  await page.waitForTimeout(200);
  await page.click('.price-mode-tab[data-mode="flight"]');
  await page.waitForTimeout(300);

  // Check stats before any search
  await page.click('.flight-sub-tab[data-sub="stats"]');
  await page.waitForTimeout(400);
  const emptyText = await page.evaluate(() => document.getElementById('fpStatsBox').textContent);
  console.log('Antes de pesquisar, mostra mensagem de "sem pesquisas":', emptyText.includes('não pesquisaste'));
  await page.click('.flight-sub-tab[data-sub="search"]');
  await page.waitForTimeout(200);

  // Do two searches: LIS->OPO twice, LIS->VLC once (mock server gives OPO=89/45, VLC=59-ish per earlier logic)
  await page.selectOption('#fpOriginInput', 'LIS');
  await page.selectOption('#fpDestinationInput', 'OPO');
  await page.fill('#fpDateInput', '2026-12-01');
  await page.click('button:has-text("Pesquisar voos")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Pesquisar voos")');
  await page.waitForTimeout(500);
  await page.selectOption('#fpDestinationInput', 'VLC');
  await page.click('button:has-text("Pesquisar voos")');
  await page.waitForTimeout(500);

  await page.click('.flight-sub-tab[data-sub="stats"]');
  await page.waitForTimeout(500);
  const statsText = await page.evaluate(() => document.getElementById('fpStatsBox').textContent);
  console.log('Mostra 3 pesquisas no total:', statsText.includes('3'));
  console.log('Mostra a rota mais pesquisada (LIS → OPO, 2x):', statsText.includes('LIS → OPO') && statsText.includes('2x'));
  console.log('Mostra o preço mais baixo encontrado (45, Ryanair p/ OPO):', statsText.includes('45'));
  console.log('Mostra a distância total pesquisada (dashboard):', /~\d+ km/.test(statsText));
  console.log('Mostra a comparação com a volta ao mundo:', statsText.includes('volta ao mundo'));
  console.log('Mostra o CO2 estimado dos voos pesquisados:', statsText.includes('CO₂ estimado'));
  console.log('Mostra o aviso de que é baseado em pesquisas, não viagens reais:', statsText.includes('não sabemos quais viagens'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
