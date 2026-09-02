const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text()); });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Watch Teste');
  await page.fill('#regUsername', 'watch_test_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'watchtest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('button[title^="Onde Assistir"]');
  await page.waitForSelector('#watchScreen.active');
  console.log('Watch screen opened OK');

  await page.fill('#watchSearchInput', 'Matrix');
  await page.click('#watchScreen button:has-text("🔍")');
  await page.waitForTimeout(800);
  console.log('Results (not configured expected):', (await page.textContent('#watchResults')).trim());

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
