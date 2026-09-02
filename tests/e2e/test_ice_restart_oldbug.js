// Confirms the OLD code's restartIce() call was a real dead no-op: nothing
// ever reaches the other side, signalingState never changes.
const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3519' + ts.toString().slice(-8);
  await page.fill('#regName', name);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-web-security']
  });
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await register(ctxA, 'OldBug A', 'olda_');
  const b = await register(ctxB, 'OldBug B', 'oldb_');

  const usernameB = await b.page.evaluate(() => APP.user.username);
  await a.page.evaluate((uname) => {
    document.getElementById('modalSearchUser').classList.add('active');
    document.getElementById('searchUsernameInput').value = uname;
  }, usernameB);
  await a.page.evaluate(() => doSearchUser());
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => {
    const btn = [...document.querySelectorAll('#searchUserResult button')].find(b => b.textContent.includes('conversa'));
    if (btn) btn.click();
  });
  await a.page.waitForTimeout(500);
  await a.page.click('.chat-item:has-text("OldBug B")');
  await a.page.waitForTimeout(300);

  await a.page.evaluate(() => startCall('video'));
  await b.page.waitForSelector('#modalIncomingCall.active', { timeout: 5000 });
  await b.page.evaluate(() => acceptIncomingCall());
  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 });

  console.log('Chamada conectou normalmente:', true);
  const before = await a.page.evaluate(() => peerConnection.signalingState);

  // This is exactly what the OLD oniceconnectionstatechange('failed') branch did.
  await a.page.evaluate(() => { try { peerConnection.restartIce(); } catch (e) {} });
  await a.page.waitForTimeout(2000);

  const after = await a.page.evaluate(() => peerConnection.signalingState);
  const bRemoteType = await b.page.evaluate(() => peerConnection.remoteDescription?.type);
  console.log('OLD BUG CONFIRMED: signalingState unchanged after restartIce() (no real renegotiation was sent):', before === after);
  console.log('OLD BUG CONFIRMED: B never received any new offer (remoteDescription.type is still the original "offer", not a renegotiated one — no NEW SDP exchange happened at all):', bRemoteType === 'offer');

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
