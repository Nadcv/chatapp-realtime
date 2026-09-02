const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'AI Removal Teste');
  await page.fill('#regUsername', 'ai_removal_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'airemoval' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(500);

  const chatItems = await page.locator('#chatList .chat-item h4').allTextContents();
  console.log('Chat list entries:', chatItems);
  console.log('Has old GitHub assistant contact:', chatItems.some(t => t.includes('Assistente IA')));
  console.log('Has Gemini contact:', chatItems.some(t => t.includes('Gemini')));

  // Open the Gemini chat and check the seed message + avatar/subtitle.
  await page.click('.chat-item:has-text("Gemini")');
  await page.waitForTimeout(300);
  console.log('Chat subtitle:', await page.textContent('#chatSubtitle'));
  console.log('First message text:', await page.locator('.message').first().textContent());

  // Exercise summarizeChat() — should now call /api/gemini-chat, not /api/ai-chat.
  const requests = [];
  page.on('request', req => { if (req.url().includes('/api/')) requests.push(req.url()); });
  await page.fill('#messageInput', 'teste mensagem 1');
  await page.press('#messageInput', 'Enter');
  await page.waitForTimeout(200);
  await page.fill('#messageInput', 'teste mensagem 2');
  await page.press('#messageInput', 'Enter');
  await page.waitForTimeout(500);
  await page.evaluate(() => summarizeChat());
  await page.waitForTimeout(500);
  console.log('API calls made:', requests.filter(u => u.includes('gemini-chat') || u.includes('ai-chat')));
  console.log('Summary modal text:', await page.textContent('#summaryContent'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
