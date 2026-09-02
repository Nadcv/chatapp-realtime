const { chromium } = require('playwright');

// Tests the new GTFS-based CP train schedule feature in the Transportes screen.
// Uses the real server (started with CP_GTFS_URL pointing at a local mock GTFS zip,
// since the real CP feed is unreachable from this sandbox) — this exercises the
// full path: client search UI -> /api/trains/stations -> /api/trains/departures.
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Train Test');
  await page.fill('#regUsername', 'train_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'train' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Leaflet is loaded from a CDN (cdnjs.cloudflare.com) blocked by this sandbox's network
  // policy, so `L` is undefined here — stub just enough of it so openTransportScreen()
  // (needed to reach the new rail search bar) doesn't throw. This is a pre-existing sandbox
  // limitation affecting every map-based screen in the app, unrelated to this feature.
  await page.evaluate(() => {
    const bounds = { getSouth: () => -90, getNorth: () => 90, getWest: () => -180, getEast: () => 180 };
    const chainable = { setView: () => chainable, addTo: () => chainable, invalidateSize: () => {}, on: () => chainable, removeLayer: () => chainable, hasLayer: () => false, clearLayers: () => chainable, addLayer: () => chainable, bindPopup: () => chainable, setLatLng: () => chainable, remove: () => {}, getBounds: () => bounds };
    window.L = { map: () => chainable, tileLayer: () => chainable, layerGroup: () => chainable, marker: () => chainable, divIcon: () => ({}), polyline: () => chainable, icon: () => ({}) };
  });
  await page.evaluate(() => openTransportScreen());
  await page.waitForSelector('#transportScreen.active, #transportScreen', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);

  // --- Check 1: rail search bar hidden on bus tab (default) ---
  const barHiddenOnBus = await page.evaluate(() => document.getElementById('railScheduleBar').style.display === 'none');
  console.log('Barra de pesquisa de comboios escondida no separador Autocarros (default):', barHiddenOnBus);

  // --- Check 2: switching to rail tab shows the search bar ---
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(200);
  const barVisibleOnRail = await page.evaluate(() => document.getElementById('railScheduleBar').style.display === 'flex');
  console.log('Barra de pesquisa aparece ao mudar para o separador Metro/Comboio:', barVisibleOnRail);

  // --- Check 3: switching to flight tab hides it again ---
  await page.click('.transport-tab[data-tab="flight"]');
  await page.waitForTimeout(200);
  const barHiddenOnFlight = await page.evaluate(() => document.getElementById('railScheduleBar').style.display === 'none');
  console.log('Barra de pesquisa volta a esconder-se no separador Aviões:', barHiddenOnFlight);
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(200);

  // --- Check 4: typing a station name shows search results ---
  await page.fill('#railSearchInput', 'lisboa');
  await page.waitForTimeout(600); // debounce is 300ms
  const resultsText = await page.evaluate(() => document.getElementById('railSearchResults').textContent);
  console.log('Resultado da pesquisa mostra "Lisboa Oriente":', resultsText.includes('Lisboa Oriente'));
  console.log('  (conteúdo: ' + JSON.stringify(resultsText.trim()) + ')');

  // --- Check 5: clicking a result opens the departures modal with real times ---
  await page.click('#railSearchResults div:has-text("Lisboa Oriente")');
  await page.waitForSelector('#modalTrainDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(300);
  const title = await page.evaluate(() => document.getElementById('trainDeparturesTitle').textContent);
  console.log('Título do modal de partidas mostra o nome da estação:', title.includes('Lisboa Oriente'));
  const listText = await page.evaluate(() => document.getElementById('trainDeparturesList').textContent);
  console.log('Lista de partidas mostra o nome completo da rota "Alfa Pendular":', listText.includes('Alfa Pendular'));
  console.log('Lista de partidas mostra o destino "Porto Campanha":', listText.includes('Porto Campanha'));

  // --- Check 6: closing the modal works ---
  await page.click('#modalTrainDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);
  const modalClosed = await page.evaluate(() => !document.getElementById('modalTrainDepartures').classList.contains('active'));
  console.log('Modal de partidas fecha corretamente:', modalClosed);

  // --- Check 7: searching for a non-existent station shows a friendly empty message ---
  await page.fill('#railSearchInput', 'estacaoquenaoexiste123');
  await page.waitForTimeout(600);
  const emptyText = await page.evaluate(() => document.getElementById('railSearchResults').textContent);
  console.log('Pesquisa sem resultados mostra mensagem amigável:', emptyText.includes('Nenhuma estação'));

  // --- Check 8: clearing the search box clears results ---
  await page.fill('#railSearchInput', '');
  await page.waitForTimeout(600);
  const clearedText = await page.evaluate(() => document.getElementById('railSearchResults').textContent.trim());
  console.log('Limpar a pesquisa limpa os resultados:', clearedText === '');

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
