const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'] });

  async function register(context, name, prefix) {
    const page = await context.newPage();
    await page.goto('http://localhost:3000');
    await page.click('.login-switch');
    const ts = Date.now() + Math.floor(Math.random() * 1000);
    const phone = '+3518' + ts.toString().slice(-8);
    await page.fill('#regName', name);
    await page.fill('#regUsername', prefix + ts);
    await page.fill('#regPhone', phone);
    await page.selectOption('#regCountry', 'Portugal');
    await page.fill('#regEmail', prefix + ts + '@test.com');
    await page.fill('#regPassword', 'senha123');
    await page.click('button:has-text("Criar conta")');
    await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
    return { page, phone };
  }

  const a = await register(ctxA, 'Caller 1to1', 'caller1to1_');
  const b = await register(ctxB, 'Callee 1to1', 'callee1to1_');
  await a.page.waitForTimeout(400);

  await a.page.evaluate((bPhone) => {
    const chatId = dmRoomId(APP.user.phone, bPhone);
    APP.chats.push({ id: chatId, name: 'Callee 1to1', phone: bPhone, type: 'user' });
    APP.currentChatId = chatId;
    startCall('video');
  }, b.phone);

  await a.page.waitForFunction(() => document.getElementById('pipVideo')?.videoWidth > 0, { timeout: 8000 });
  await a.page.click('button[onclick="openSelfieCam()"]');
  await a.page.waitForSelector('#selfieCamOverlay.active');
  await a.page.waitForTimeout(500);
  const canvasOk = await a.page.evaluate(() => {
    const c = document.getElementById('selfieCanvas');
    return c.width > 0 && c.height > 0;
  });
  console.log('1-to-1 selfie still works (pipVideo path):', canvasOk);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
