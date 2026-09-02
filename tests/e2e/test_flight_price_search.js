const { chromium } = require('playwright');

// A aba "Preços" evoluiu para um seletor de 3 modos (Comboio/Autocarro, Voos,
// Planeador) — os campos de voos (antigo #flightOriginInput em texto livre)
// passaram a viver dentro de #flightModeFields, escondidos até se escolher o
// sub-modo "✈️ Voos", e origem/destino passaram a <select> com códigos IATA
// fixos em vez de autocomplete por texto.
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

  const barVisible = await page.evaluate(() => document.getElementById('tripSearchBar').style.display === 'flex');
  console.log('Barra de pesquisa de preços aparece na aba Preços:', barVisible);
  const mapHidden = await page.evaluate(() => document.getElementById('transportMap').style.display === 'none');
  console.log('Mapa escondido nesta aba:', mapHidden);

  const tripModeDefaultVisible = await page.evaluate(() => document.getElementById('tripModeFields').style.display === 'flex');
  console.log('Modo por omissão é Comboio/Autocarro:', tripModeDefaultVisible);
  const flightModeInitiallyHidden = await page.evaluate(() => document.getElementById('flightModeFields').style.display === 'none');
  console.log('Campos de voos ficam escondidos até se escolher o sub-modo Voos:', flightModeInitiallyHidden);

  await page.click('.price-mode-tab[data-mode="flight"]');
  await page.waitForTimeout(200);
  const flightModeVisible = await page.evaluate(() => document.getElementById('flightModeFields').style.display === 'flex');
  console.log('Sub-modo Voos mostra os campos de voo:', flightModeVisible);

  // --- Validação: sem origem/destino escolhidos ---
  await page.click('button:has-text("🔍 Pesquisar voos")');
  await page.waitForTimeout(300);
  const missingCodesMsg = await page.evaluate(() => document.getElementById('fpResults').textContent);
  console.log('Avisa que faltam os códigos IATA quando origem/destino não estão escolhidos:', missingCodesMsg.includes('códigos IATA'));

  // --- Validação: origem/destino escolhidos mas sem data ---
  await page.selectOption('#fpOriginInput', 'LIS');
  await page.selectOption('#fpDestinationInput', 'MAD');
  await page.click('button:has-text("🔍 Pesquisar voos")');
  await page.waitForTimeout(300);
  const missingDateMsg = await page.evaluate(() => document.getElementById('fpResults').textContent);
  console.log('Avisa que falta a data de partida:', missingDateMsg.includes('data de partida'));

  // --- Pesquisa completa (LIS -> MAD), com o mock Ignav a responder ---
  await page.fill('#fpDateInput', '2026-09-15');
  await page.click('button:has-text("🔍 Pesquisar voos")');
  await page.waitForTimeout(600);
  const offersText = await page.evaluate(() => document.getElementById('fpResults').textContent);
  console.log('Mostra a companhia TAP Air Portugal:', offersText.includes('TAP Air Portugal'));
  console.log('Mostra a companhia Ryanair:', offersText.includes('Ryanair'));
  console.log('Mostra "escala(s)" para o voo com ligação:', offersText.includes('escala'));
  console.log('Mostra "direto" para o voo sem escalas:', offersText.includes('direto'));

  // O mock devolve 2 voos: Ryanair a 45€ (1 escala) e TAP a um preço calculado
  // por hash a partir do destino (para MAD: 30 + hash('MAD') % 200 = 40€,
  // direto) — o servidor ordena por preço ascendente, por isso a TAP (mais
  // barata para este par) deve vir primeiro.
  const offersOrder = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#fpResults > div')];
    return rows.map(r => r.textContent);
  });
  const sortedByPrice = offersOrder.length >= 2 && offersOrder[0].includes('TAP Air Portugal') && offersOrder[1].includes('Ryanair');
  console.log('Resultados vêm ordenados por preço (o mais barato primeiro):', sortedByPrice);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
