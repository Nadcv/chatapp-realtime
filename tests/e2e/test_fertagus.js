const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Fertagus Test');
  await page.fill('#regUsername', 'fertagus_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'fertagus' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const bounds = { getSouth: () => -90, getNorth: () => 90, getWest: () => -180, getEast: () => 180 };
    const chainable = { setView: () => chainable, addTo: () => chainable, invalidateSize: () => {}, on: () => chainable, removeLayer: () => chainable, hasLayer: () => false, clearLayers: () => chainable, addLayer: () => chainable, bindPopup: () => chainable, setLatLng: () => chainable, remove: () => {}, getBounds: () => bounds };
    window.L = { map: () => chainable, tileLayer: () => chainable, layerGroup: () => chainable, marker: () => chainable, divIcon: () => ({}), polyline: () => chainable, icon: () => ({}) };
  });
  await page.evaluate(() => openTransportScreen());
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(300);

  await page.fill('#railSearchInput', 'a');
  await page.waitForTimeout(600);
  const resultsText = await page.evaluate(() => document.getElementById('railSearchResults').textContent);
  console.log('Mostra estações da CP e da Fertagus na mesma pesquisa:', resultsText.includes('(CP)') && resultsText.includes('(Fertagus)'));
  console.log('Mostra a estação Roma-Areeiro (Fertagus):', resultsText.includes('Roma-Areeiro'));

  await page.click('#railSearchResults div:has-text("Roma-Areeiro")');
  await page.waitForSelector('#modalTrainDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const title = await page.evaluate(() => document.getElementById('trainDeparturesTitle').textContent);
  console.log('Título do modal mostra a estação Fertagus:', title.includes('Roma-Areeiro'));
  const listText = await page.evaluate(() => document.getElementById('trainDeparturesList').textContent);
  console.log('Lista de partidas mostra a rota "Fertagus" e destino "Setúbal":', listText.includes('Fertagus') && listText.includes('Setúbal'));

  await page.click('#modalTrainDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);

  // Confirma que clicar numa estação da CP continua a pedir as partidas da CP (não da Fertagus)
  await page.fill('#railSearchInput', '');
  await page.waitForTimeout(300);
  await page.fill('#railSearchInput', 'lisboa');
  await page.waitForTimeout(600);
  await page.click('#railSearchResults div:has-text("Lisboa Oriente")');
  await page.waitForSelector('#modalTrainDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const cpListText = await page.evaluate(() => document.getElementById('trainDeparturesList').textContent);
  console.log('Estação da CP continua a mostrar a rota "Alfa Pendular" (não confunde os operadores):', cpListText.includes('Alfa Pendular'));

  await page.click('#modalTrainDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);

  // "Ver comboios em trânsito" também deve incluir Fertagus, com a operadora identificada
  await page.check('#railEstimatedToggle');
  await page.waitForTimeout(600);
  const estimatedStatus = await page.evaluate(() => document.getElementById('railEstimatedStatus').textContent);
  console.log('"Comboios em trânsito" mostra pelo menos 1 comboio (CP + Fertagus juntos):', /\d+ comboio/.test(estimatedStatus));

  const fertagusTrainCheck = await page.evaluate(async () => {
    const res = await fetch('/api/trains/positions-estimated');
    const data = await res.json();
    return (data.trains || []).some(t => t.operator === 'Fertagus');
  });
  console.log('A API de posições estimadas inclui um comboio da Fertagus, com o operador identificado:', fertagusTrainCheck);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
