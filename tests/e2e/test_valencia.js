const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Valencia Test');
  await page.fill('#regUsername', 'valencia_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'valencia' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const bounds = { getSouth: () => -90, getNorth: () => 90, getWest: () => -180, getEast: () => 180 };
    const chainable = { setView: () => chainable, addTo: () => chainable, invalidateSize: () => {}, on: () => chainable, removeLayer: () => chainable, hasLayer: () => false, clearLayers: () => chainable, addLayer: () => chainable, bindPopup: () => chainable, setLatLng: () => chainable, remove: () => {}, getBounds: () => bounds };
    window.L = { map: () => chainable, tileLayer: () => chainable, layerGroup: () => chainable, marker: () => chainable, divIcon: () => ({}), polyline: () => chainable, icon: () => ({}), circleMarker: () => chainable };
  });
  await page.evaluate(() => openTransportScreen());

  // --- Autocarros: Valência (EMT) ---
  await page.click('.bus-city-tab[data-city="valencia"]');
  await page.waitForTimeout(300);
  const valenciaBarVisible = await page.evaluate(() => document.getElementById('valenciaBusScheduleBar').style.display === 'flex');
  console.log('Barra de pesquisa da EMT Valência aparece:', valenciaBarVisible);

  await page.fill('#valenciaBusSearchInput', 'ayuntamiento');
  await page.waitForTimeout(600);
  const busResultsText = await page.evaluate(() => document.getElementById('valenciaBusSearchResults').textContent);
  console.log('Mostra a paragem "Plaza del Ayuntamiento":', busResultsText.includes('Plaza del Ayuntamiento'));

  await page.click('#valenciaBusSearchResults div:has-text("Plaza del Ayuntamiento")');
  await page.waitForSelector('#modalGuimaraesDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const busListText = await page.evaluate(() => document.getElementById('guimaraesDeparturesList').textContent);
  console.log('Mostra a partida da EMT Valência (rota "9", destino "Estacion del Norte"):', busListText.includes('9') && busListText.includes('Estacion del Norte'));
  await page.click('#modalGuimaraesDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);

  // --- Metro/Comboio: Valência (Metrovalencia) ---
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(300);
  await page.click('.rail-country-tab[data-country="valencia"]');
  await page.waitForTimeout(200);
  const railValenciaVisible = await page.evaluate(() => document.getElementById('railValenciaContent').style.display === 'flex');
  const railPtHidden = await page.evaluate(() => document.getElementById('railPortugalContent').style.display === 'none');
  const railMadridHidden = await page.evaluate(() => document.getElementById('railMadridContent').style.display === 'none');
  console.log('Trocar para "Valência" mostra o conteúdo certo e esconde Portugal/Madrid:', railValenciaVisible && railPtHidden && railMadridHidden);

  await page.fill('#railValenciaSearchInput', 'xativa');
  await page.waitForTimeout(600);
  const railResultsText = await page.evaluate(() => document.getElementById('railValenciaSearchResults').textContent);
  console.log('Mostra a estação "Xativa" do Metrovalencia:', railResultsText.includes('Xativa'));

  await page.click('#railValenciaSearchResults div:has-text("Xativa")');
  await page.waitForSelector('#modalTrainDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const railListText = await page.evaluate(() => document.getElementById('trainDeparturesList').textContent);
  console.log('Mostra a partida do Metrovalencia (rota "3"):', railListText.includes('3'));
  await page.click('#modalTrainDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);

  // Voltar para Portugal não deve confundir os dados
  await page.click('.rail-country-tab[data-country="pt"]');
  await page.waitForTimeout(200);
  const backToPt = await page.evaluate(() => document.getElementById('railPortugalContent').style.display === 'flex' && document.getElementById('railValenciaContent').style.display === 'none');
  console.log('Voltar a "Portugal" mostra o conteúdo certo de novo:', backToPt);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
