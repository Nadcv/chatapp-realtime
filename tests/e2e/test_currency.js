const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text()); });

  // Mock the /api/currency/rates response since the real external API is blocked in this sandbox
  await page.route('**/*', async (route) => {
    if (!route.request().url().includes('/api/currency/rates')) return route.continue();
    console.log('MOCK INTERCEPTED:', route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        base: 'EUR',
        updated: 'Tue, 18 Aug 2026 00:00:00 GMT',
        rates: { EUR: 1, USD: 1.08, BRL: 5.83, AOA: 990.5, CVE: 110.27, MZN: 68.9, STN: 24.5, GBP: 0.855 }
      })
    });
  });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Cambio Teste');
  await page.fill('#regUsername', 'cambio_test_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'cambiotest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('button[title="Mais funcionalidades"]');
  await page.click('#modalMoreFeatures button[onclick*="openCurrencyScreen"]');
  await page.waitForSelector('#currencyScreen.active');
  await page.waitForTimeout(500);

  const fromOptions = await page.locator('#currencyFrom option').allTextContents();
  console.log('From options (first 5):', fromOptions.slice(0, 5));
  console.log('Total options:', fromOptions.length);

  console.log('Default from value:', await page.inputValue('#currencyFrom'));
  console.log('Default to value:', await page.inputValue('#currencyTo'));
  console.log('Result (1 EUR -> USD, should be ~1.08 USD):', await page.textContent('#currencyResult'));

  await page.fill('#currencyAmount', '10');
  await page.waitForTimeout(200);
  console.log('Result (10 EUR -> USD, should be ~10.8 USD):', await page.textContent('#currencyResult'));

  await page.selectOption('#currencyTo', 'STN');
  await page.waitForTimeout(200);
  console.log('Result (10 EUR -> STN, should be ~245 STN):', await page.textContent('#currencyResult'));

  await page.click('button[title="Trocar"]');
  await page.waitForTimeout(200);
  console.log('After swap - from:', await page.inputValue('#currencyFrom'), 'to:', await page.inputValue('#currencyTo'));
  console.log('Result after swap:', await page.textContent('#currencyResult'));

  console.log('Updated text:', await page.textContent('#currencyUpdated'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
