const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Madrid Test');
  await page.fill('#regUsername', 'madrid_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'madrid' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const bounds = { getSouth: () => -90, getNorth: () => 90, getWest: () => -180, getEast: () => 180 };
    const chainable = { setView: () => chainable, addTo: () => chainable, invalidateSize: () => {}, on: () => chainable, removeLayer: () => chainable, hasLayer: () => false, clearLayers: () => chainable, addLayer: () => chainable, bindPopup: () => chainable, setLatLng: () => chainable, remove: () => {}, getBounds: () => bounds };
    window.L = { map: () => chainable, tileLayer: () => chainable, layerGroup: () => chainable, marker: () => chainable, divIcon: () => ({}), polyline: () => chainable, icon: () => ({}), circleMarker: () => chainable };
  });
  await page.evaluate(() => openTransportScreen());

  // --- Autocarros: Madrid (EMT) ---
  await page.click('.bus-city-tab[data-city="madrid"]');
  await page.waitForTimeout(300);
  const madridBarVisible = await page.evaluate(() => document.getElementById('madridBusScheduleBar').style.display === 'flex');
  console.log('Barra de pesquisa da EMT Madrid aparece:', madridBarVisible);

  await page.fill('#madridBusSearchInput', 'callao');
  await page.waitForTimeout(600);
  const busResultsText = await page.evaluate(() => document.getElementById('madridBusSearchResults').textContent);
  console.log('Mostra a paragem "Plaza de Callao":', busResultsText.includes('Plaza de Callao'));

  await page.click('#madridBusSearchResults div:has-text("Plaza de Callao")');
  await page.waitForSelector('#modalGuimaraesDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const busListText = await page.evaluate(() => document.getElementById('guimaraesDeparturesList').textContent);
  console.log('Mostra a partida da EMT Madrid (rota "Linea 27", destino "Atocha"):', busListText.includes('Linea 27') && busListText.includes('Atocha'));
  await page.click('#modalGuimaraesDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);

  // --- Metro/Comboio: Madrid (Metro/Cercanías/Metro Ligero) ---
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(300);
  await page.click('.rail-country-tab[data-country="madrid"]');
  await page.waitForTimeout(200);
  const railMadridVisible = await page.evaluate(() => document.getElementById('railMadridContent').style.display === 'flex');
  const railPtHidden = await page.evaluate(() => document.getElementById('railPortugalContent').style.display === 'none');
  console.log('Trocar para "Madrid" mostra o conteúdo certo e esconde o de Portugal:', railMadridVisible && railPtHidden);

  await page.fill('#railMadridSearchInput', 'a');
  await page.waitForTimeout(600);
  const railResultsText = await page.evaluate(() => document.getElementById('railMadridSearchResults').textContent);
  console.log('Mostra estações do Metro, Metro Ligero e Cercanías juntas:', railResultsText.includes('(Metro)') && railResultsText.includes('(Metro Ligero)') && railResultsText.includes('(Cercanías)'));

  await page.click('#railMadridSearchResults div:has-text("Chamartin")');
  await page.waitForSelector('#modalTrainDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const railListText = await page.evaluate(() => document.getElementById('trainDeparturesList').textContent);
  console.log('Mostra a partida da Cercanías (rota "Cercanias C1"):', railListText.includes('Cercanias C1'));
  await page.click('#modalTrainDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);

  // Voltar para Portugal não deve confundir os dados
  await page.click('.rail-country-tab[data-country="pt"]');
  await page.waitForTimeout(200);
  const backToPt = await page.evaluate(() => document.getElementById('railPortugalContent').style.display === 'flex' && document.getElementById('railMadridContent').style.display === 'none');
  console.log('Voltar a "Portugal" mostra o conteúdo certo de novo:', backToPt);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
