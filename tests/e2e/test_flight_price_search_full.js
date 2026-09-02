const { chromium } = require('playwright');

// Cobre o resto do sub-modo "✈️ Voos" (dentro da aba Preços) que
// test_flight_price_search.js não cobre: ida-e-volta, "voos baratos"
// (varredura de destinos), alertas de preço e estatísticas — mais a
// regressão da aba "Aviões" (rastreio ao vivo), que é uma funcionalidade
// completamente diferente e não deve ser afetada por nada disto.
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
  await page.click('.price-mode-tab[data-mode="flight"]');
  await page.waitForTimeout(200);

  // --- Ida e volta: LIS -> MAD com data de volta ---
  await page.selectOption('#fpOriginInput', 'LIS');
  await page.selectOption('#fpDestinationInput', 'MAD');
  await page.fill('#fpDateInput', '2026-09-15');
  await page.fill('#fpReturnDateInput', '2026-09-20');
  await page.click('button:has-text("🔍 Pesquisar voos")');
  await page.waitForTimeout(600);
  const roundTripText = await page.evaluate(() => document.getElementById('fpResults').textContent);
  console.log('Mostra o preço 150 do voo de ida-e-volta (mock round-trip):', roundTripText.includes('150'));
  console.log('Indica "(ida e volta)" no resultado:', roundTripText.includes('ida e volta'));

  // --- Voos baratos (varredura a partir de LIS) ---
  await page.click('button:has-text("💸 Voos baratos")');
  await page.waitForTimeout(3000);
  const dealsText = await page.evaluate(() => document.getElementById('fpResults').textContent);
  console.log('"Voos baratos" mostra pelo menos um destino:', /Madrid|Barcelona|Londres|Paris|Roma/.test(dealsText));
  const dealsSorted = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#fpResults > div')];
    const prices = rows.map(r => {
      const m = r.textContent.match(/(\d+(?:\.\d+)?)\s*EUR/);
      return m ? parseFloat(m[1]) : null;
    }).filter(p => p != null);
    return prices.every((p, i) => i === 0 || p >= prices[i - 1]);
  });
  console.log('"Voos baratos" vem ordenado do mais barato ao mais caro:', dealsSorted);

  // Clicar num destino preenche o destino e volta a pesquisar essa rota específica.
  await page.click('#fpResults > div:first-child');
  await page.waitForTimeout(600);
  const destAfterDealClick = await page.evaluate(() => document.getElementById('fpDestinationInput').value);
  console.log('Clicar num destino barato preenche o destino e pesquisa essa rota:', !!destAfterDealClick);

  // --- Alertas de preço ---
  // Origem/destino/data são campos partilhados que vivem na secção "Pesquisar"
  // (escondida com display:none nos outros sub-separadores) — têm de ser
  // preenchidos ANTES de mudar para o separador "Alertas".
  await page.selectOption('#fpOriginInput', 'LIS');
  await page.selectOption('#fpDestinationInput', 'MAD');
  await page.fill('#fpDateInput', '2026-09-15');
  await page.click('.flight-sub-tab[data-sub="alerts"]');
  await page.waitForTimeout(300);
  await page.fill('#fpAlertMaxPriceInput', '100');
  await page.click('button:has-text("🔔 Criar alerta")');
  await page.waitForTimeout(400);
  const alertsListText = await page.evaluate(() => document.getElementById('fpAlertsList').textContent);
  console.log('Alerta criado aparece na lista (LIS -> MAD, abaixo de 100 €):', alertsListText.includes('LIS') && alertsListText.includes('MAD') && alertsListText.includes('100'));

  await page.click('#fpAlertsList button:has-text("🗑️")');
  await page.waitForTimeout(400);
  const alertsListAfterDelete = await page.evaluate(() => document.getElementById('fpAlertsList').textContent.trim());
  console.log('Apagar o alerta remove-o da lista:', alertsListAfterDelete === '');

  // --- Estatísticas (já feitas várias pesquisas acima, deve haver histórico) ---
  await page.click('.flight-sub-tab[data-sub="stats"]');
  await page.waitForTimeout(400);
  const statsText = await page.evaluate(() => document.getElementById('fpStatsBox').textContent);
  console.log('Estatísticas mostram o total de pesquisas feitas:', /Total de pesquisas/.test(statsText));
  console.log('Estatísticas mostram o preço mais baixo encontrado:', /mais baixo encontrado/.test(statsText));

  // --- Link de reserva ---
  // window.open() para um domínio externo real (example-airline.test) não
  // resolve dentro da sandbox (proxy de rede bloqueia-o) — em vez de esperar
  // por uma navegação real, interceta-se a própria chamada a window.open
  // para confirmar só o URL que a app tentou abrir.
  await page.evaluate(() => { window.__openedUrls = []; window.open = (url) => window.__openedUrls.push(url); });
  await page.click('.flight-sub-tab[data-sub="search"]');
  await page.waitForTimeout(200);
  await page.click('button:has-text("🔍 Pesquisar voos")');
  await page.waitForTimeout(600);
  await page.click('#fpResults button:has-text("Ver opções de reserva")');
  await page.waitForTimeout(400);
  const openedUrls = await page.evaluate(() => window.__openedUrls);
  console.log('Botão de reserva abre o link de reserva da companhia:', openedUrls.some(u => /example-airline\.test/.test(u)));

  // --- Regressão: a aba "Aviões" (rastreio ao vivo) não tem nada a ver com isto e continua a funcionar ---
  await page.click('.transport-tab[data-tab="flight"]');
  await page.waitForTimeout(300);
  const flightFilterVisible = await page.evaluate(() => document.getElementById('flightFilterBar').style.display === 'flex');
  console.log('Aba Aviões (rastreio ao vivo) continua a funcionar:', flightFilterVisible);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
