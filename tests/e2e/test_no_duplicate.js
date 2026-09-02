const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Dup Teste');
  await page.fill('#regUsername', 'dup_teste_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'duptest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  const groupName = 'Grupo Dup ' + ts;
  await page.click('button[onclick="openContactsFeaturesModal()"]');
  await page.waitForSelector('#modalContactsFeatures.active');
  await page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await page.waitForSelector('#modalCreateGroup.active');
  await page.fill('#groupName', groupName);
  await page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await page.waitForTimeout(600);
  await page.click(`.chat-item:has-text("${groupName}")`);
  await page.waitForTimeout(300);

  // Send 2 text messages + 1 "photo" (small base64 PNG) via the real send path.
  await page.fill('#messageInput', 'Mensagem de teste 1');
  await page.press('#messageInput', 'Enter');
  await page.waitForTimeout(200);
  await page.fill('#messageInput', 'Mensagem de teste 2');
  await page.press('#messageInput', 'Enter');
  await page.waitForTimeout(300);

  // A minimal valid 1x1 PNG, sent as a fake "photo" attachment through the real path.
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await page.evaluate(async (dataUrl) => {
    await sendAttachmentMessage(dataUrl, 'foto.png', 'image/png');
  }, tinyPng);
  await page.waitForTimeout(400);

  const countBefore = await page.evaluate(() => APP.messages[APP.currentChatId].length);
  console.log('Message count before any reconnect (expect 3):', countBefore);

  // Force a real socket reconnect — this is exactly what happens on a brief
  // network blip or the phone backgrounding the app, which is what the user
  // reported triggers duplicated messages/photos.
  await page.evaluate(() => new Promise((resolve) => {
    socket.once('connect', () => setTimeout(resolve, 600));
    socket.disconnect();
    socket.connect();
  }));
  await page.waitForTimeout(300);
  const countAfterFirstReconnect = await page.evaluate(() => APP.messages[APP.currentChatId].length);
  console.log('Message count after 1st reconnect (should STILL be', countBefore + ', not doubled):', countAfterFirstReconnect);

  // Do it again to make sure it's not slowly accumulating.
  await page.evaluate(() => new Promise((resolve) => {
    socket.once('connect', () => setTimeout(resolve, 600));
    socket.disconnect();
    socket.connect();
  }));
  await page.waitForTimeout(300);
  const countAfterSecondReconnect = await page.evaluate(() => APP.messages[APP.currentChatId].length);
  console.log('Message count after 2nd reconnect (should still be the same):', countAfterSecondReconnect);

  const photoCount = await page.evaluate(() => APP.messages[APP.currentChatId].filter(m => m.fileData).length);
  console.log('Exactly 1 photo present (not duplicated):', photoCount === 1);

  console.log('No duplication across reconnects:', countBefore === countAfterFirstReconnect && countAfterFirstReconnect === countAfterSecondReconnect);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
