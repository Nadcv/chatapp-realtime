const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Guimaraes Test');
  await page.fill('#regUsername', 'gmr_' + ts);
  await page.fill('#regPhone', '+3516' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'gmr' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const bounds = { getSouth: () => -90, getNorth: () => 90, getWest: () => -180, getEast: () => 180 };
    const chainable = { setView: () => chainable, addTo: () => chainable, invalidateSize: () => {}, on: () => chainable, removeLayer: () => chainable, hasLayer: () => false, clearLayers: () => chainable, addLayer: () => chainable, bindPopup: () => chainable, setLatLng: () => chainable, remove: () => {}, getBounds: () => bounds };
    window.L = { map: () => chainable, tileLayer: () => chainable, layerGroup: () => chainable, marker: () => chainable, divIcon: () => ({}), polyline: () => chainable, icon: () => ({}) };
  });

  await page.evaluate(() => openTransportScreen());
  await page.waitForTimeout(300);

  // --- Check 1: bus city toggle only visible on bus tab ---
  const toggleVisibleOnBus = await page.evaluate(() => document.getElementById('busCityToggle').style.display === 'flex');
  console.log('Alternador de cidade visível no separador Autocarros:', toggleVisibleOnBus);

  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(200);
  const toggleHiddenOnRail = await page.evaluate(() => document.getElementById('busCityToggle').style.display === 'none');
  console.log('Alternador de cidade escondido no separador Metro/Comboio:', toggleHiddenOnRail);

  await page.click('.transport-tab[data-tab="bus"]');
  await page.waitForTimeout(200);

  // --- Check 2: switching to Guimarães hides the map and shows the search bar ---
  await page.click('.bus-city-tab[data-city="guimaraes"]');
  await page.waitForTimeout(200);
  const mapHidden = await page.evaluate(() => document.getElementById('transportMap').style.display === 'none');
  const scheduleBarVisible = await page.evaluate(() => document.getElementById('guimaraesScheduleBar').style.display === 'flex');
  console.log('Mapa escondido ao mudar para Guimarães:', mapHidden);
  console.log('Barra de pesquisa de Guimarães aparece:', scheduleBarVisible);

  // --- Check 3: searching a stop shows results ---
  // Dados reais da GUIMABUS (fixture tests/mocks/fixtures/guimaraes_gtfs.zip, maior que um
  // mock sintético) — em máquinas mais lentas o debounce de 300ms + fetch podem passar
  // ligeiramente de 600ms, por isso a espera é mais generosa que nos outros testes.
  await page.fill('#guimaraesSearchInput', 'campo da feira');
  await page.waitForTimeout(1200);
  const resultsText = await page.evaluate(() => document.getElementById('guimaraesSearchResults').textContent);
  console.log('Resultado da pesquisa mostra "CAMPO DA FEIRA":', resultsText.includes('CAMPO DA FEIRA'));

  // --- Check 4: clicking a result opens the departures modal with real data ---
  await page.click('#guimaraesSearchResults div:has-text("CAMPO DA FEIRA")');
  await page.waitForSelector('#modalGuimaraesDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(300);
  const title = await page.evaluate(() => document.getElementById('guimaraesDeparturesTitle').textContent);
  console.log('Título mostra o nome da paragem:', title.includes('CAMPO DA FEIRA'));
  const listText = await page.evaluate(() => document.getElementById('guimaraesDeparturesList').textContent);
  // O nome mostrado é o comprido (route_long_name), tal como em todos os outros feeds GTFS
  // desta app (ex.: CP mostra "Alfa Pendular", não o código curto) — por isso verificamos o
  // nome comprido real da linha 003 nestes dados, não o código "003" em si.
  console.log('Lista mostra uma linha real (LINHA CIDADE):', listText.includes('LINHA CIDADE'));
  console.log('Lista mostra um destino real (CENTRAL DE CAMIONAGEM):', listText.includes('CENTRAL DE CAMIONAGEM'));

  await page.click('#modalGuimaraesDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);
  const modalClosed = await page.evaluate(() => !document.getElementById('modalGuimaraesDepartures').classList.contains('active'));
  console.log('Modal fecha corretamente:', modalClosed);

  // --- Check 5: switching back to Lisboa restores the live map ---
  await page.click('.bus-city-tab[data-city="lisboa"]');
  await page.waitForTimeout(300);
  const mapVisibleAgain = await page.evaluate(() => document.getElementById('transportMap').style.display !== 'none');
  const scheduleBarHiddenAgain = await page.evaluate(() => document.getElementById('guimaraesScheduleBar').style.display === 'none');
  console.log('Mapa volta a aparecer ao mudar para Lisboa:', mapVisibleAgain);
  console.log('Barra de pesquisa de Guimarães volta a esconder-se:', scheduleBarHiddenAgain);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
