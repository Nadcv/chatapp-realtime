const { chromium } = require('playwright');

// Testa a nova rede de França (SNCF Transilien — Paris/Île-de-França), a versão
// "reduzida" escolhida em vez do feed nacional inteiro da SNCF (TER+Intercités+TGV,
// que é enorme — ver README). Mesmo padrão de já usado para CP/Guimarães/Renfe:
// servidor real com FRANCE_GTFS_URL a apontar para um mock GTFS local.
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'France Test');
  await page.fill('#regUsername', 'francetest_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'francetest' + ts + '@test.com');
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
  await page.click('.rail-country-tab[data-country="france"]');
  await page.waitForTimeout(200);
  const franceVisible = await page.evaluate(() => document.getElementById('railFranceContent').style.display === 'flex');
  const ptHidden = await page.evaluate(() => document.getElementById('railPortugalContent').style.display === 'none');
  console.log('Trocar para "França (Transilien)" mostra o conteúdo certo e esconde Portugal:', franceVisible && ptHidden);

  await page.fill('#railFranceSearchInput', 'nord');
  await page.waitForTimeout(600);
  const resultsText = await page.evaluate(() => document.getElementById('railFranceSearchResults').textContent);
  console.log('Resultado da pesquisa mostra "Paris Gare du Nord":', resultsText.includes('Paris Gare du Nord'));

  await page.click('#railFranceSearchResults div:has-text("Paris Gare du Nord")');
  await page.waitForSelector('#modalTrainDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const title = await page.evaluate(() => document.getElementById('trainDeparturesTitle').textContent);
  console.log('Título do modal de partidas mostra o nome da estação:', title.includes('Paris Gare du Nord'));
  const listText = await page.evaluate(() => document.getElementById('trainDeparturesList').textContent);
  console.log('Lista de partidas mostra o nome da rota "RER B":', listText.includes('RER B'));
  console.log('Lista de partidas mostra o destino "Mitry - Claye":', listText.includes('Mitry - Claye'));

  await page.click('#modalTrainDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);
  const modalClosed = await page.evaluate(() => !document.getElementById('modalTrainDepartures').classList.contains('active'));
  console.log('Modal de partidas fecha corretamente:', modalClosed);

  await page.fill('#railFranceSearchInput', 'estacaoquenaoexiste123');
  await page.waitForTimeout(600);
  const emptyText = await page.evaluate(() => document.getElementById('railFranceSearchResults').textContent);
  console.log('Pesquisa sem resultados mostra mensagem amigável:', emptyText.includes('Nenhuma estação'));

  // Regressão: voltar para Portugal mostra o conteúdo certo de novo (não fica preso em França).
  await page.click('.rail-country-tab[data-country="pt"]');
  await page.waitForTimeout(200);
  const backToPt = await page.evaluate(() => document.getElementById('railPortugalContent').style.display === 'flex' && document.getElementById('railFranceContent').style.display === 'none');
  console.log('Voltar a "Portugal" mostra o conteúdo certo de novo:', backToPt);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
