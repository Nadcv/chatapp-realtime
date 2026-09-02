const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'NoScroll Teste');
  await page.fill('#regUsername', 'noscroll_test_' + ts);
  await page.fill('#regPhone', '+3511' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'noscrolltest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('#mediaBtn');
  await page.click('#modalMediaFeatures button[onclick*="openTvScreen"]');
  await page.waitForSelector('#tvScreen.active');
  await page.waitForTimeout(500);

  await page.screenshot({ path: __dirname + '/../output/tv_noscroll.png' });

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
