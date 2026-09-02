const { chromium } = require('playwright');

async function registerUser(context, name, usernamePrefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3517' + ts.toString().slice(-8);
  await page.fill('#regName', name);
  await page.fill('#regUsername', usernamePrefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', usernamePrefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'] });

  const a = await registerUser(ctxA, 'Chamador Teste', 'caller_');
  const b = await registerUser(ctxB, 'Recetor Teste', 'callee_');
  await a.page.waitForTimeout(800);
  await b.page.waitForTimeout(800);

  // Injeta diretamente o contacto do B no A (bypassa o fluxo real de
  // pesquisa/adicionar contacto, que não é o que este teste está a validar)
  // e liga para ele.
  await a.page.evaluate((bPhone) => {
    const chatId = dmRoomId(APP.user.phone, bPhone);
    APP.chats.push({ id: chatId, name: 'Recetor Teste', phone: bPhone, type: 'user', online: true });
    APP.currentChatId = chatId;
    startCall('voice');
  }, b.phone);

  await b.page.waitForSelector('#modalIncomingCall.active', { timeout: 8000 });
  await b.page.waitForTimeout(300);

  const ringState = await b.page.evaluate(() => ({
    hasCtx: !!ringtoneCtx,
    hasTimer: !!ringtoneTimer,
    muted: ringtoneMuted,
    btnText: document.getElementById('ringtoneMuteBtn')?.textContent,
    callerName: document.getElementById('incomingCallerName')?.textContent,
    callType: document.getElementById('incomingCallType')?.textContent
  }));
  console.log('Incoming call ring state (before mute):', ringState);

  await b.page.click('#ringtoneMuteBtn');
  await b.page.waitForTimeout(200);
  const mutedState = await b.page.evaluate(() => ({
    muted: ringtoneMuted,
    btnText: document.getElementById('ringtoneMuteBtn')?.textContent
  }));
  console.log('After mute click:', mutedState);

  await b.page.click('button[onclick="declineIncomingCall()"]');
  await b.page.waitForTimeout(300);
  const afterDecline = await b.page.evaluate(() => ({ hasCtx: !!ringtoneCtx, hasTimer: !!ringtoneTimer }));
  console.log('After decline (should both be false):', afterDecline);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
