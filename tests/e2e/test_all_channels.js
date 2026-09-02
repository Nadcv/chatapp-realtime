const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Verify Teste');
  await page.fill('#regUsername', 'verify_test_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'verifytest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('#mediaBtn');
  await page.click('#modalMediaFeatures button[onclick*="openTvScreen"]');
  await page.waitForSelector('#tvScreen.active');
  await page.waitForTimeout(500);

  const dims = await page.evaluate(() => {
    const el = document.getElementById('tvTabs');
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  console.log('tvTabs dims:', JSON.stringify(dims));

  // Scroll all the way right and check each button is individually reachable & clickable
  const names = ['Euronews (Português)', 'Euronews (Español)', 'France 24', 'TVS (site)', 'Record News', 'DW Español', 'El Doce'];
  for (const name of names) {
    const btn = page.locator('#tvTabs button', { hasText: name }).first();
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox();
    const inView = box && box.x >= 0 && box.x < 412;
    console.log(name, '-> reachable & in-view after scroll:', inView, box ? `x=${box.x.toFixed(0)}` : 'no box');
  }

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
