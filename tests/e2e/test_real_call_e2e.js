// Deep investigation: exercise REAL WebRTC signaling end-to-end (not mocked)
// using Chromium's fake camera/mic devices, so getUserMedia() actually
// succeeds and ontrack actually fires with synthetic media — this lets us
// verify the real 1-to-1 call connection path, not just read the code.
const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log(`CONSOLE ERROR [${name}]:`, msg.text()); });
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
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--disable-web-security', // avoid unrelated cert/mixed-content noise in this synthetic test
    ]
  });
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });

  const a = await register(ctxA, 'Call A Real', 'calla_');
  const b = await register(ctxB, 'Call B Real', 'callb_');

  // A adds B as a real contact (so the DM room is allowed) via username search.
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

  await a.page.click('.chat-item:has-text("Call B Real")');
  await a.page.waitForTimeout(300);

  // A starts a VIDEO call.
  await a.page.evaluate(() => startCall('video'));
  await a.page.waitForTimeout(1000);

  const aCallScreenActive = await a.page.evaluate(() => document.getElementById('callScreen').classList.contains('active'));
  console.log('A: call screen becomes active after starting the call:', aCallScreenActive);
  const aStatusRinging = await a.page.evaluate(() => document.getElementById('callStatus').textContent);
  console.log('A: status shows "Chamando..." while waiting:', aStatusRinging);

  // B should get the incoming call.
  await b.page.waitForSelector('#modalIncomingCall.active', { timeout: 5000 }).catch(() => {});
  const bModalActive = await b.page.evaluate(() => document.getElementById('modalIncomingCall').classList.contains('active'));
  console.log('B: incoming-call modal appears:', bModalActive);

  // B accepts.
  await b.page.evaluate(() => acceptIncomingCall());

  // Wait for both sides to report "Conectado".
  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 }).catch(() => {});
  await b.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 }).catch(() => {});

  const aStatusFinal = await a.page.evaluate(() => document.getElementById('callStatus').textContent);
  const bStatusFinal = await b.page.evaluate(() => document.getElementById('callStatus').textContent);
  console.log('A final call status:', aStatusFinal);
  console.log('B final call status:', bStatusFinal);
  console.log('BOTH sides reach "Conectado":', aStatusFinal.includes('Conectado') && bStatusFinal.includes('Conectado'));

  // Check whether the remote video element actually has a real MediaStream attached
  // on BOTH sides (this is the crux of "one side doesn't show video").
  await a.page.waitForTimeout(1000);
  await b.page.waitForTimeout(1000);
  const aHasRemoteStream = await a.page.evaluate(() => {
    const v = document.getElementById('mainVideo');
    return !!v.srcObject && v.srcObject.getVideoTracks().length > 0 && v.srcObject.getVideoTracks()[0].readyState === 'live';
  });
  const bHasRemoteStream = await b.page.evaluate(() => {
    const v = document.getElementById('mainVideo');
    return !!v.srcObject && v.srcObject.getVideoTracks().length > 0 && v.srcObject.getVideoTracks()[0].readyState === 'live';
  });
  console.log('A: mainVideo has a LIVE remote video track attached:', aHasRemoteStream);
  console.log('B: mainVideo has a LIVE remote video track attached:', bHasRemoteStream);
  console.log('SYMMETRIC: both sides see each other\'s video (not just one-way):', aHasRemoteStream === true && bHasRemoteStream === true);

  // Check actual video frame dimensions are non-zero (proves frames are truly flowing, not just track object present).
  await a.page.waitForTimeout(500);
  const aVideoDims = await a.page.evaluate(() => {
    const v = document.getElementById('mainVideo');
    return { w: v.videoWidth, h: v.videoHeight };
  });
  const bVideoDims = await b.page.evaluate(() => {
    const v = document.getElementById('mainVideo');
    return { w: v.videoWidth, h: v.videoHeight };
  });
  console.log('A: remote video element has non-zero dimensions (frames actually decoding):', JSON.stringify(aVideoDims), aVideoDims.w > 0 && aVideoDims.h > 0);
  console.log('B: remote video element has non-zero dimensions (frames actually decoding):', JSON.stringify(bVideoDims), bVideoDims.w > 0 && bVideoDims.h > 0);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
