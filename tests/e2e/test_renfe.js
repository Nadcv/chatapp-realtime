const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Renfe Test');
  await page.fill('#regUsername', 'renfe_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'renfe' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const bounds = { getSouth: () => -90, getNorth: () => 90, getWest: () => -180, getEast: () => 180 };
    const chainable = { setView: () => chainable, addTo: () => chainable, invalidateSize: () => {}, on: () => chainable, removeLayer: () => chainable, hasLayer: () => false, clearLayers: () => chainable, addLayer: () => chainable, bindPopup: () => chainable, setLatLng: () => chainable, remove: () => {}, getBounds: () => bounds };
    window.L = { map: () => chainable, tileLayer: () => chainable, layerGroup: () => chainable, marker: () => chainable, divIcon: () => ({}), polyline: () => chainable, icon: () => ({}), circleMarker: () => chainable };
  });
  await page.evaluate(() => openTransportScreen());

  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(300);
  await page.click('.rail-country-tab[data-country="renfe"]');
  await page.waitForTimeout(200);
  const railRenfeVisible = await page.evaluate(() => document.getElementById('railRenfeContent').style.display === 'flex');
  const railPtHidden = await page.evaluate(() => document.getElementById('railPortugalContent').style.display === 'none');
  console.log('Trocar para "Espanha (Renfe)" mostra o conteúdo certo e esconde Portugal:', railRenfeVisible && railPtHidden);

  await page.fill('#railRenfeSearchInput', 'madrid');
  await page.waitForTimeout(600);
  const railResultsText = await page.evaluate(() => document.getElementById('railRenfeSearchResults').textContent);
  console.log('Mostra estações da Cercanías e do AVE juntas (Madrid Atocha + Madrid Puerta de Atocha):', railResultsText.includes('(Cercanías/Rodalies)') && railResultsText.includes('(AVE/Larga Distância)'));

  await page.click('#railRenfeSearchResults div:has-text("Madrid Atocha Cercanias")');
  await page.waitForSelector('#modalTrainDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const cercaniasListText = await page.evaluate(() => document.getElementById('trainDeparturesList').textContent);
  console.log('Mostra a partida da Cercanías (rota "C3", destino "Madrid Chamartin"):', cercaniasListText.includes('C3') && cercaniasListText.includes('Madrid Chamartin'));
  await page.click('#modalTrainDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);

  await page.click('#railRenfeSearchResults div:has-text("Madrid Puerta de Atocha")');
  await page.waitForSelector('#modalTrainDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const aveListText = await page.evaluate(() => document.getElementById('trainDeparturesList').textContent);
  console.log('Mostra a partida do AVE (rota "AVE", destino "Barcelona Sants") sem misturar com a Cercanías:', aveListText.includes('AVE') && aveListText.includes('Barcelona Sants') && !aveListText.includes('Madrid Chamartin'));
  await page.click('#modalTrainDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);

  await page.click('.rail-country-tab[data-country="pt"]');
  await page.waitForTimeout(200);
  const backToPt = await page.evaluate(() => document.getElementById('railPortugalContent').style.display === 'flex' && document.getElementById('railRenfeContent').style.display === 'none');
  console.log('Voltar a "Portugal" mostra o conteúdo certo de novo:', backToPt);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
