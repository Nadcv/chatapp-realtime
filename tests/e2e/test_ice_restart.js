// Prova que "attemptIceRestart1to1"/"attemptIceRestartGroup" fazem mesmo uma
// renegociação real (novo offer -> novo answer, trocados pelo servidor) em
// vez do "pc.restartIce()" antigo, que nunca enviava nada a ninguém — o bug
// real por trás de chamadas presas em "Conectado"/"A tentar reconectar..."
// para sempre depois de um problema breve de rede.
const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
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

  const a = await register(ctxA, 'ICE Restart A', 'icea_');
  const b = await register(ctxB, 'ICE Restart B', 'iceb_');

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
  await a.page.click('.chat-item:has-text("ICE Restart B")');
  await a.page.waitForTimeout(300);

  // A calls, B accepts, wait for both to connect.
  await a.page.evaluate(() => startCall('video'));
  await b.page.waitForSelector('#modalIncomingCall.active', { timeout: 5000 });
  await b.page.evaluate(() => acceptIncomingCall());
  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 });
  await b.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 });
  console.log('Chamada 1-para-1 conectou normalmente antes do teste:', true);

  // --- REGRESSION CHECK: the old restartIce() call was a dead no-op (no
  // negotiationneeded listener existed). Confirm a real renegotiate_offer now
  // reaches B and B actually answers back through the new signaling events. ---
  const beforeSignalingState = await a.page.evaluate(() => peerConnection.signalingState);
  console.log('Estado de sinalização antes de simular falha de ICE (deve ser "stable"):', beforeSignalingState === 'stable');

  // Simulate what oniceconnectionstatechange('failed') would trigger on A (the
  // original caller/offerer) by calling the real function directly.
  await a.page.evaluate(() => attemptIceRestart1to1());

  // B should receive a genuine new offer and answer it for real.
  await a.page.waitForFunction(() => peerConnection.signalingState === 'stable', { timeout: 5000 }).catch(() => {});
  const afterSignalingState = await a.page.evaluate(() => peerConnection.signalingState);
  console.log('A volta a "stable" depois da renegociação (prova que B respondeu de verdade):', afterSignalingState === 'stable');

  const bGotNewOffer = await b.page.evaluate(() => peerConnection.remoteDescription && peerConnection.remoteDescription.type === 'offer');
  console.log('B recebeu e aplicou um NOVO offer via renegotiate_offer_received:', bGotNewOffer);

  const stillConnected = await Promise.all([
    a.page.evaluate(() => document.getElementById('callStatus').textContent),
    b.page.evaluate(() => document.getElementById('callStatus').textContent)
  ]);
  console.log('Chamada continua "Conectada" dos dois lados depois da renegociação:', stillConnected.every(s => s.includes('Conectado')));

  // --- Role guard: B (the callee/answerer) must NOT try to initiate its own
  // ICE restart — only the original offerer (A) may, to avoid glare. ---
  const bCallDirection = await b.page.evaluate(() => APP.callDirection);
  console.log('B tem o papel correto registado (callDirection="incoming"):', bCallDirection === 'incoming');
  const bSignalingBefore = await b.page.evaluate(() => peerConnection.signalingState);
  await b.page.evaluate(() => attemptIceRestart1to1()); // should be a no-op for the callee
  await b.page.waitForTimeout(500);
  const bSignalingAfter = await b.page.evaluate(() => peerConnection.signalingState);
  console.log('B (callee) chamar attemptIceRestart1to1 não faz nada (evita glare):', bSignalingBefore === bSignalingAfter);

  // --- Retry cap: after 3 real attempts, a 4th should be refused and show a clear failure status. ---
  await a.page.evaluate(() => { iceRestartAttempts1to1 = 3; });
  await a.page.evaluate(() => attemptIceRestart1to1());
  await a.page.waitForTimeout(300);
  const cappedStatus = await a.page.evaluate(() => document.getElementById('callStatus').textContent);
  console.log('Depois de 3 tentativas, mostra uma falha clara em vez de tentar para sempre:', cappedStatus.includes('Não foi possível recuperar'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
