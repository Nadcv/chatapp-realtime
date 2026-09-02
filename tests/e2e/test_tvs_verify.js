const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text()); });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'TVS Teste');
  await page.fill('#regUsername', 'tvs_test_' + ts);
  await page.fill('#regPhone', '+3513' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'tvstest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('#mediaBtn');
  await page.click('#modalMediaFeatures button[onclick*="openTvScreen"]');
  await page.waitForSelector('#tvScreen.active');
  await page.waitForTimeout(500);

  const html = await page.innerHTML('#tvTabs');
  console.log('tvTabs innerHTML:', html);

  const buttonCount = await page.locator('#tvTabs button').count();
  console.log('Number of channel buttons:', buttonCount);

  const stpVisible = await page.locator('#tvTabs button:has-text("TVS")').count();
  console.log('TVS button found?', stpVisible > 0);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
