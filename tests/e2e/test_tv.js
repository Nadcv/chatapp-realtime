const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text()); });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'TV Teste');
  await page.fill('#regUsername', 'tv_test_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'tvtest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('#mediaBtn');
  await page.click('#modalMediaFeatures button[onclick*="openTvScreen"]');
  await page.waitForSelector('#tvScreen.active');
  console.log('TV screen opened OK');

  await page.waitForTimeout(500);
  const tabsText = await page.textContent('#tvTabs');
  console.log('Tabs:', tabsText.replace(/\s+/g, ' ').trim());

  let src = await page.getAttribute('#tvFrame', 'src');
  console.log('Initial iframe src:', src);

  // Switch to Spain
  await page.click('#tvTabs button:has-text("Español")');
  await page.waitForTimeout(300);
  src = await page.getAttribute('#tvFrame', 'src');
  console.log('After clicking RTVE, iframe src:', src);

  // Switch to France
  await page.click('#tvTabs button:has-text("France 24")');
  await page.waitForTimeout(300);
  src = await page.getAttribute('#tvFrame', 'src');
  console.log('After clicking France 24, iframe src:', src);

  // Close screen, verify iframe resets
  await page.click('#tvScreen button:has-text("✖️")');
  await page.waitForTimeout(300);
  src = await page.getAttribute('#tvFrame', 'src');
  console.log('After closing, iframe src:', src);
  const stillActive = await page.evaluate(() => document.getElementById('tvScreen').classList.contains('active'));
  console.log('Screen still active after close?', stillActive);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
