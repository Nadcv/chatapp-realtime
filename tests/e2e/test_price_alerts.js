const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  page.on('dialog', async (dialog) => { console.log('DIALOG:', dialog.message()); await dialog.dismiss(); });
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Price Alert Test');
  await page.fill('#regUsername', 'pricealert_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'pricealert' + ts + '@test.com');
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

  await page.selectOption('#fpOriginInput', 'LIS');
  await page.selectOption('#fpDestinationInput', 'OPO');
  await page.fill('#fpDateInput', '2026-12-01');
  await page.click('.flight-sub-tab[data-sub="alerts"]');
  await page.waitForTimeout(300);
  await page.fill('#fpAlertMaxPriceInput', '60');
  await page.click('button:has-text("Criar alerta")');
  await page.waitForTimeout(500);

  const listText = await page.evaluate(() => document.getElementById('fpAlertsList').textContent);
  console.log('Mostra o alerta criado (LIS -> OPO, 60):', listText.includes('LIS') && listText.includes('OPO') && listText.includes('60'));

  // Switching sub-tab and back should reload and still show it
  await page.click('.flight-sub-tab[data-sub="search"]');
  await page.waitForTimeout(200);
  await page.click('.flight-sub-tab[data-sub="alerts"]');
  await page.waitForTimeout(400);
  const listText2 = await page.evaluate(() => document.getElementById('fpAlertsList').textContent);
  console.log('Alerta persiste ao mudar de secção e voltar:', listText2.includes('LIS'));

  // Delete it
  await page.click('#fpAlertsList button:has-text("🗑️")');
  await page.waitForTimeout(500);
  const listText3 = await page.evaluate(() => document.getElementById('fpAlertsList').textContent);
  console.log('Apagar o alerta remove-o da lista:', !listText3.includes('LIS'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
