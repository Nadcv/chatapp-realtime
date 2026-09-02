const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Planner Test');
  await page.fill('#regUsername', 'plannertest_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'plannertest' + ts + '@test.com');
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
  await page.click('.price-mode-tab[data-mode="planner"]');
  await page.waitForTimeout(200);

  const plannerVisible = await page.evaluate(() => document.getElementById('plannerModeFields').style.display === 'flex');
  console.log('Modo Planeador fica visível ao trocar de aba:', plannerVisible);
  const otherHidden = await page.evaluate(() => document.getElementById('tripModeFields').style.display === 'none' && document.getElementById('flightModeFields').style.display === 'none');
  console.log('Os outros modos ficam escondidos:', otherHidden);

  await page.selectOption('#plannerOriginInput', 'LIS');
  await page.selectOption('#plannerDestinationInput', 'OPO');
  await page.fill('#plannerDateInput', '2026-09-19');
  await page.click('button:has-text("Comparar opções")');
  await page.waitForSelector('#plannerResults div:has-text("Avião")', { timeout: 8000 });

  const resultsText = await page.evaluate(() => document.getElementById('plannerResults').textContent);
  console.log('Mostra a distância em linha reta:', /~\d+ km/.test(resultsText));
  console.log('Mostra a opção de Avião (Ignav):', resultsText.includes('Avião'));
  console.log('Mostra a opção de Comboio/Autocarro (Tictactrip):', resultsText.includes('Comboio/Autocarro'));
  console.log('Mostra a opção de Comboio direto (CP):', resultsText.includes('Comboio direto'));
  console.log('Mostra a nota de que o preço do comboio CP não está disponível:', resultsText.includes('Preço não disponível'));
  // Os horários do mock da CP são relativos a "agora" (ver build_mock_gtfs.js —
  // precisam de ser sempre "daqui a uns minutos", não valores fixos), por isso
  // aqui só confirmamos que aparecem duas horas num formato real (partida e
  // chegada), não um valor específico.
  const cpTimeMatches = resultsText.match(/\d{2}:\d{2}(:\d{2})?/g) || [];
  console.log('Mostra o horário real do comboio CP (partida e chegada, formato HH:MM):', cpTimeMatches.length >= 2);
  console.log('Mostra CO2 estimado com "~" e rótulo (estimativa) para o voo:', resultsText.includes('~') && resultsText.includes('(estimativa)'));
  console.log('Mostra uma recomendação:', resultsText.includes('Recomendação'));

  // Rota sem Tictactrip nem CP direto (só Ignav) — a recomendação cai para o
  // avião, e a dica estática de ligação do aeroporto ao centro deve aparecer.
  await page.selectOption('#plannerDestinationInput', 'MAD');
  await page.click('button:has-text("Comparar opções")');
  await page.waitForSelector('#plannerResults div:has-text("Avião")', { timeout: 8000 });
  const madridText = await page.evaluate(() => document.getElementById('plannerResults').textContent);
  console.log('Sem Tictactrip/CP disponíveis, recomenda o avião e mostra a dica do metro do aeroporto:', madridText.includes('Recomendação') && madridText.includes('Avião') && madridText.includes('Linha 8 do Metro de Madrid'));

  // Rota igual não é permitida
  await page.selectOption('#plannerDestinationInput', 'LIS');
  await page.click('button:has-text("Comparar opções")');
  await page.waitForTimeout(300);
  const sameOriginText = await page.evaluate(() => document.getElementById('plannerResults').textContent);
  console.log('Origem igual ao destino mostra erro amigável:', sameOriginText.includes('não podem ser os mesmos'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
