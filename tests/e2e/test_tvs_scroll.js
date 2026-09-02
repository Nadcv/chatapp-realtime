const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // Emulate a real phone viewport (similar to the screenshots: ~900x600 CSS px equivalent, Android Chrome)
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text()); });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Scroll Teste');
  await page.fill('#regUsername', 'scroll_test_' + ts);
  await page.fill('#regPhone', '+3512' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'scrolltest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('button[title^="Televisão em direto"]');
  await page.waitForSelector('#tvScreen.active');
  await page.waitForTimeout(500);

  const dims = await page.evaluate(() => {
    const el = document.getElementById('tvTabs');
    const cs = getComputedStyle(el);
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: cs.overflowX,
      needsScroll: el.scrollWidth > el.clientWidth
    };
  });
  console.log('tvTabs dimensions:', JSON.stringify(dims));

  // Try scrolling the container to the far right
  await page.evaluate(() => {
    const el = document.getElementById('tvTabs');
    el.scrollLeft = el.scrollWidth;
  });
  await page.waitForTimeout(200);

  const stpBox = await page.locator('#tvTabs button:has-text("TVS")').boundingBox();
  console.log('TVS button bounding box after scroll:', JSON.stringify(stpBox));

  const viewportWidth = 412;
  const isWithinViewport = stpBox && stpBox.x >= 0 && stpBox.x < viewportWidth;
  console.log('Is TVS button within the visible viewport after scrolling?', isWithinViewport);

  await page.screenshot({ path: __dirname + '/../output/tv_scrolled.png' });

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
