const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Porto Test');
  await page.fill('#regUsername', 'porto_' + ts);
  await page.fill('#regPhone', '+3515' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'porto' + ts + '@test.com');
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
  await page.click('.bus-city-tab[data-city="porto"]');
  await page.waitForTimeout(200);

  const scheduleBarVisible = await page.evaluate(() => document.getElementById('portoScheduleBar').style.display === 'flex');
  console.log('Barra de pesquisa do Porto aparece:', scheduleBarVisible);
  const mapHidden = await page.evaluate(() => document.getElementById('transportMap').style.display === 'none');
  console.log('Mapa escondido no modo Porto:', mapHidden);

  await page.fill('#portoSearchInput', 'trindade');
  await page.waitForTimeout(1200);
  const resultsText = await page.evaluate(() => document.getElementById('portoSearchResults').textContent);
  console.log('Resultados mostram "Trindade" (2 vezes, metro + autocarro):', (resultsText.match(/Trindade/g) || []).length === 2);
  const hasMetroIcon = await page.evaluate(() => document.getElementById('portoSearchResults').textContent.includes('🚇'));
  const hasBusIcon = await page.evaluate(() => document.getElementById('portoSearchResults').textContent.includes('🚌'));
  console.log('Resultado do Metro tem ícone 🚇:', hasMetroIcon);
  console.log('Resultado da STCP tem ícone 🚌:', hasBusIcon);

  // Click the metro result (should show scheduled GTFS departure)
  const metroResultHandle = await page.locator('#portoSearchResults div:has-text("🚇")').first();
  await metroResultHandle.click();
  await page.waitForSelector('#modalPortoDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(300);
  const metroTitle = await page.evaluate(() => document.getElementById('portoDeparturesTitle').textContent);
  console.log('Título mostra Trindade com ícone de metro:', metroTitle.includes('Trindade') && metroTitle.includes('🚇'));
  const metroListText = await page.evaluate(() => document.getElementById('portoDeparturesList').textContent);
  console.log('Lista do metro mostra a linha "A":', metroListText.includes('A'));
  console.log('Lista do metro mostra o destino real:', metroListText.includes('Estadio do Dragao'));
  await page.click('#modalPortoDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);

  // Click the bus (STCP) result — expect graceful error since stcp.pt is unreachable in this sandbox
  const busResultHandle = await page.locator('#portoSearchResults div:has-text("🚌")').first();
  await busResultHandle.click();
  await page.waitForSelector('#modalPortoDepartures.active', { timeout: 5000 });
  await page.waitForTimeout(300);
  const busListText = await page.evaluate(() => document.getElementById('portoDeparturesList').textContent);
  console.log('STCP mostra um erro amigável (esperado nesta sandbox, sem PAGE EXCEPTION acima):', busListText.includes('⚠️'));
  const modalStillClosable = await page.evaluate(() => document.getElementById('modalPortoDepartures').classList.contains('active'));
  console.log('Modal continua aberto/fechável mesmo com erro (não trava):', modalStillClosable);
  await page.click('#modalPortoDepartures button:has-text("Fechar")');
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => !document.getElementById('modalPortoDepartures').classList.contains('active'));
  console.log('Fecha corretamente:', closed);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
