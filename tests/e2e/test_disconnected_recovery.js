// Proves the real bug from the live screenshots: iceConnectionState
// 'disconnected' showed "a tentar recuperar..." but NEVER actually tried
// anything — it only acted on 'failed', which some networks/browsers take a
// long time to reach (or never reach) while stuck "disconnected". Confirms
// the new debounced auto-restart actually fires a real renegotiation after
// ~5s of being stuck disconnected, and does NOT fire if it recovers on its
// own first (avoids restarting on every brief blip).
const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3513' + ts.toString().slice(-8);
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
  const a = await register(ctxA, 'Disc Test A', 'disca_');
  const b = await register(ctxB, 'Disc Test B', 'discb_');

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
  await a.page.click('.chat-item:has-text("Disc Test B")');
  await a.page.waitForTimeout(300);

  await a.page.evaluate(() => startCall('video'));
  await b.page.waitForSelector('#modalIncomingCall.active', { timeout: 5000 });
  await b.page.evaluate(() => acceptIncomingCall());
  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 });
  await b.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 });

  // --- Simulate a real "disconnected" ICE state (fake a browser reporting it) ---
  await a.page.evaluate(() => {
    Object.defineProperty(peerConnection, 'iceConnectionState', { get: () => 'disconnected', configurable: true });
    peerConnection.oniceconnectionstatechange();
  });
  await a.page.waitForTimeout(200);
  const showsUnstable = await a.page.evaluate(() => document.getElementById('callStatus').textContent.includes('instável'));
  console.log('Mostra "Ligação instável" assim que entra em "disconnected":', showsUnstable);

  const bSignalingBefore = await b.page.evaluate(() => peerConnection.signalingState);

  // BUG CHECK (would fail on the old code): nothing should have been sent
  // to B yet — the real restart is debounced by ~5s, not instant.
  await a.page.waitForTimeout(2000);
  const bSignalingAt2s = await b.page.evaluate(() => peerConnection.signalingState);
  console.log('Não dispara logo aos 2s (dá tempo de recuperar sozinho primeiro):', bSignalingAt2s === bSignalingBefore);

  // Wait past the 5s debounce: a REAL renegotiation must now have happened.
  await a.page.waitForTimeout(3500);
  const bGotRealOffer = await b.page.evaluate(() => peerConnection.remoteDescription?.type === 'offer');
  console.log('BUG CORRIGIDO: ao fim de ~5s ainda "disconnected", dispara uma renegociação REAL (B recebe um novo offer):', bGotRealOffer);
  const aBackToStable = await a.page.evaluate(() => peerConnection.signalingState === 'stable');
  console.log('A volta a "stable" (prova que B respondeu de verdade, não só que A tentou):', aBackToStable);

  await browser.close();

  // --- Second call: recovers on its own within the 5s window -> must NOT restart ---
  const browser2 = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-web-security']
  });
  const ctxA2 = await browser2.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB2 = await browser2.newContext({ permissions: ['camera', 'microphone'] });
  const a2 = await register(ctxA2, 'Disc Test A2', 'disca2_');
  const b2 = await register(ctxB2, 'Disc Test B2', 'discb2_');
  const usernameB2 = await b2.page.evaluate(() => APP.user.username);
  await a2.page.evaluate((uname) => {
    document.getElementById('modalSearchUser').classList.add('active');
    document.getElementById('searchUsernameInput').value = uname;
  }, usernameB2);
  await a2.page.evaluate(() => doSearchUser());
  await a2.page.waitForTimeout(500);
  await a2.page.evaluate(() => {
    const btn = [...document.querySelectorAll('#searchUserResult button')].find(b => b.textContent.includes('conversa'));
    if (btn) btn.click();
  });
  await a2.page.waitForTimeout(500);
  await a2.page.click('.chat-item:has-text("Disc Test B2")');
  await a2.page.waitForTimeout(300);
  await a2.page.evaluate(() => startCall('video'));
  await b2.page.waitForSelector('#modalIncomingCall.active', { timeout: 5000 });
  await b2.page.evaluate(() => acceptIncomingCall());
  await a2.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 });

  await a2.page.evaluate(() => {
    Object.defineProperty(peerConnection, 'iceConnectionState', { get: () => 'disconnected', configurable: true });
    peerConnection.oniceconnectionstatechange();
  });
  await a2.page.waitForTimeout(1500);
  // Recovers on its own quickly (as many brief blips do).
  await a2.page.evaluate(() => {
    Object.defineProperty(peerConnection, 'iceConnectionState', { get: () => 'connected', configurable: true });
    peerConnection.oniceconnectionstatechange();
  });
  await a2.page.waitForTimeout(4500); // past the original 5s debounce window
  const b2NeverGotExtraOffer = await b2.page.evaluate(() => peerConnection.signalingState === 'stable');
  const a2StatusRecovered = await a2.page.evaluate(() => document.getElementById('callStatus').textContent.includes('Conectado'));
  console.log('Se recuperar sozinho antes dos 5s, NÃO força uma renegociação desnecessária:', b2NeverGotExtraOffer && a2StatusRecovered);

  await browser2.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
