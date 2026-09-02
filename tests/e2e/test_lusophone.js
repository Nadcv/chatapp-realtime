const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text()); });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Lusofonia Teste');
  await page.fill('#regUsername', 'luso_test_' + ts);
  await page.fill('#regPhone', '+3510' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'lusotest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('#mediaBtn');
  await page.click('#modalMediaFeatures button[onclick*="openTvScreen"]');
  await page.waitForSelector('#tvScreen.active');
  await page.waitForTimeout(500);

  const buttons = await page.locator('#tvTabs button').allTextContents();
  console.log('All channel buttons:', JSON.stringify(buttons));
  console.log('Count:', buttons.length);

  // Click the TVS (site) one to verify directUrl wiring
  await page.click('#tvTabs button:has-text("TVS (site)")');
  await page.waitForTimeout(300);
  const src1 = await page.getAttribute('#tvFrame', 'src');
  console.log('TVS (site) iframe src:', src1);

  // Click RTTL to verify it still uses youtube embed
  await page.click('#tvTabs button:has-text("RTTL")');
  await page.waitForTimeout(300);
  const src2 = await page.getAttribute('#tvFrame', 'src');
  console.log('RTTL iframe src:', src2);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
