const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Poll 1to1 Teste');
  await page.fill('#regUsername', 'poll_1to1_' + ts);
  await page.fill('#regPhone', '+3511' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'poll1to1' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  // Open the Gemini "chat" (a non-group chat) and confirm pollBtn stays hidden.
  await page.click('.chat-item:has-text("Gemini")');
  await page.waitForTimeout(300);
  const visible = await page.locator('#pollBtn').evaluate(el => getComputedStyle(el).display !== 'none');
  console.log('Poll button hidden outside groups:', !visible);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
