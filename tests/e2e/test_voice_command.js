const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Voice Command Test');
  await page.fill('#regUsername', 'voicecmd_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'voicecmd' + ts + '@test.com');
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
  await page.waitForTimeout(200);
  await page.click('.price-mode-tab[data-mode="flight"]');
  await page.waitForTimeout(300);

  // Test 1: "quero ir para Madrid amanhã" -> destination MAD, origin defaults to LIS, date = tomorrow
  await page.evaluate(() => applyVoiceCommand('quero ir para Madrid amanhã'));
  await page.waitForTimeout(600);
  const origin1 = await page.evaluate(() => document.getElementById('fpOriginInput').value);
  const dest1 = await page.evaluate(() => document.getElementById('fpDestinationInput').value);
  const date1 = await page.evaluate(() => document.getElementById('fpDateInput').value);
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  console.log('Origem preenchida com LIS (default):', origin1 === 'LIS');
  console.log('Destino reconhecido como MAD (Madrid):', dest1 === 'MAD');
  console.log('Data reconhecida como amanhã:', date1 === tomorrow);
  const status1 = await page.evaluate(() => document.getElementById('fpVoiceStatus').textContent);
  console.log('Mostra a transcrição ouvida:', status1.includes('Madrid'));

  // Test 2: does NOT overwrite an already-filled origin
  await page.selectOption('#fpOriginInput', 'OPO');
  await page.evaluate(() => applyVoiceCommand('quero ir para Barcelona hoje'));
  await page.waitForTimeout(300);
  const origin2 = await page.evaluate(() => document.getElementById('fpOriginInput').value);
  const dest2 = await page.evaluate(() => document.getElementById('fpDestinationInput').value);
  console.log('Não sobrescreve origem já preenchida (mantém OPO):', origin2 === 'OPO');
  console.log('Reconhece Barcelona (BCN):', dest2 === 'BCN');

  // Test 3: unrecognized city shows friendly message, does not crash
  await page.evaluate(() => applyVoiceCommand('quero ir para uma cidade qualquer'));
  await page.waitForTimeout(200);
  const status3 = await page.evaluate(() => document.getElementById('fpVoiceStatus').textContent);
  console.log('Cidade não reconhecida mostra aviso amigável:', status3.includes('não percebi'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
