const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Wrap Teste');
  await page.fill('#regUsername', 'wrap_test_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'wraptest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('#mediaBtn');
  await page.click('#modalMediaFeatures button[onclick*="openTvScreen"]');
  await page.waitForSelector('#tvScreen.active');
  await page.waitForTimeout(500);

  const names = ['Euronews (Português)', 'Euronews (Español)', 'France 24', 'TVS', 'TVS (site)', 'TPA', 'RTC', 'TVM', 'RTTL'];
  let allVisibleNoScroll = true;
  for (const name of names) {
    const btn = page.locator('#tvTabs button', { hasText: name }).first();
    const visible = await btn.isVisible();
    const box = await btn.boundingBox();
    const inViewportNoScroll = box && box.y < 915 && box.x >= 0 && box.x + box.width <= 412;
    if (!inViewportNoScroll) allVisibleNoScroll = false;
    console.log(name, '-> visible without any scroll:', inViewportNoScroll, box ? `x=${box.x.toFixed(0)} y=${box.y.toFixed(0)}` : 'no box');
  }
  console.log('ALL VISIBLE WITHOUT SCROLL:', allVisibleNoScroll);

  await page.screenshot({ path: __dirname + '/../output/tv_wrapped.png' });

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
