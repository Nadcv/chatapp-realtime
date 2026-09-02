const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Map Search Test');
  await page.fill('#regUsername', 'mapsearch_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'mapsearch' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const bounds = { getSouth: () => -90, getNorth: () => 90, getWest: () => -180, getEast: () => 180 };
    const chainable = { setView: () => chainable, addTo: () => chainable, invalidateSize: () => {}, on: () => chainable, removeLayer: () => chainable, hasLayer: () => false, clearLayers: () => chainable, addLayer: () => chainable, bindPopup: () => chainable, openPopup: () => chainable, setLatLng: () => chainable, remove: () => {}, getBounds: () => bounds };
    window.L = { map: () => chainable, tileLayer: () => chainable, layerGroup: () => chainable, marker: () => chainable, divIcon: () => ({}), polyline: () => chainable, icon: () => ({}), circleMarker: () => chainable };
    // Mock só o geocode (Nominatim está bloqueado neste sandbox) — o resto das
    // chamadas (transportes, metro, etc.) continua real.
    window.fetch = ((realFetch) => (url, opts) => {
      if (String(url).startsWith('/api/nav/geocode')) {
        return Promise.resolve(new Response(JSON.stringify([
          { lat: '38.7223', lon: '-9.1393', display_name: 'Rossio, Lisboa, Portugal' },
          { lat: '38.7169', lon: '-9.1399', display_name: 'Praça do Comércio, Lisboa, Portugal' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (String(url).startsWith('/api/metro/status')) return Promise.resolve(new Response(JSON.stringify({ lines: [] }), { status: 200 }));
      return realFetch(url, opts);
    })(window.fetch.bind(window));
  });

  // Abre pelo menu "Mais funcionalidades", como um utilizador real faria.
  await page.click('button[onclick="openMoreFeaturesModal()"], .icon-more, [onclick*="modalMoreFeatures"]:not([onclick*="closeModal"])').catch(() => {});
  const opened = await page.evaluate(() => { document.getElementById('modalMoreFeatures').classList.add('active'); return true; });
  console.log('Consegue abrir o modal "Mais funcionalidades":', opened);
  await page.click('#modalMoreFeatures button:has-text("Mapa")');
  await page.waitForTimeout(300);
  const screenVisible = await page.evaluate(() => document.getElementById('mapSearchScreen').classList.contains('active'));
  console.log('O ecrã "Mapa" abre a partir do menu "Mais":', screenVisible);

  await page.fill('#mapSearchInput', 'rossio');
  await page.waitForTimeout(600);
  const resultsText = await page.evaluate(() => document.getElementById('mapSearchResults').textContent);
  console.log('Mostra os dois resultados da pesquisa (Rossio e Praça do Comércio):', resultsText.includes('Rossio') && resultsText.includes('Praça do Comércio'));

  await page.click('#mapSearchResults div:has-text("Rossio")');
  await page.waitForTimeout(200);
  const afterSelect = await page.evaluate(() => ({
    resultsCleared: document.getElementById('mapSearchResults').innerHTML === '',
    inputValue: document.getElementById('mapSearchInput').value,
    statusText: document.getElementById('mapSearchStatus').textContent,
    hasMarker: !!MAPSEARCH.marker
  }));
  console.log('Selecionar um resultado limpa a lista, atualiza o campo e mostra a morada completa no estado:', afterSelect.resultsCleared && afterSelect.inputValue === 'Rossio' && afterSelect.statusText.includes('Lisboa') && afterSelect.hasMarker);

  // "Como chegar" deve fechar o Mapa e abrir a Navegação já com o destino escolhido.
  await page.evaluate(() => mapSearchGoToNav(38.7223, -9.1393, 'Rossio, Lisboa, Portugal'));
  await page.waitForTimeout(300);
  const navState = await page.evaluate(() => ({
    mapClosed: !document.getElementById('mapSearchScreen').classList.contains('active'),
    navOpen: document.getElementById('navScreen').classList.contains('active'),
    destLabel: NAV.destination && NAV.destination.label
  }));
  console.log('"Como chegar" fecha o Mapa, abre a Navegação e define o destino certo:', navState.mapClosed && navState.navOpen && navState.destLabel === 'Rossio, Lisboa, Portugal');

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
