const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // Device A: register (device 1).
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  pageA.on('pageerror', err => console.log('A PAGE EXCEPTION:', err.message));
  await pageA.goto('http://localhost:3000');
  await pageA.click('.login-switch');
  const ts = Date.now();
  const phone = '+3505' + ts.toString().slice(-8);
  await pageA.fill('#regName', 'QR Pair Test');
  await pageA.fill('#regUsername', 'qrpairtest_' + ts);
  await pageA.fill('#regPhone', phone);
  await pageA.selectOption('#regCountry', 'Portugal');
  await pageA.fill('#regEmail', 'qrpairtest' + ts + '@test.com');
  await pageA.fill('#regPassword', 'senha123');
  await pageA.click('button:has-text("Criar conta")');
  await pageA.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Open the devices modal, then "Associar novo dispositivo" -> intercept the
  // create-pairing response to read the real pairingToken and QR data URL.
  await pageA.evaluate(() => openDevicesModal());
  await pageA.waitForTimeout(300);
  const [createResp] = await Promise.all([
    pageA.waitForResponse(r => r.url().includes('/api/device-pairing/create')),
    pageA.click('button:has-text("Associar novo dispositivo")'),
  ]);
  const createData = await createResp.json();
  console.log('Pairing creation succeeded:', createResp.ok() && !!createData.pairingToken);
  console.log('QR data URL looks like a PNG data URI:', createData.qrDataUrl?.startsWith('data:image/png;base64,'));
  console.log('Expiry is 60 seconds:', createData.expiresInSec === 60);

  await pageA.waitForSelector('#modalDevicePairing.active');
  const qrImgVisible = await pageA.evaluate(() => !!document.querySelector('#devicePairingContent img'));
  console.log('QR code image is shown in the modal:', qrImgVisible);
  const countdownShown = await pageA.evaluate(() => /Expira em \d+s/.test(document.getElementById('devicePairingCountdown')?.textContent || ''));
  console.log('Countdown timer is shown:', countdownShown);

  // Device B: a FRESH context (no session) opens the pairing URL directly —
  // this is what scanning the QR with a phone's camera app would do.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  pageB.on('pageerror', err => console.log('B PAGE EXCEPTION:', err.message));
  await pageB.goto(`http://localhost:3000/?pair=${createData.pairingToken}`);
  await pageB.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const deviceBLoggedIn = await pageB.evaluate(() => APP.user && APP.user.name === 'QR Pair Test');
  console.log('Device B auto-logs in via the QR URL (no password typed):', deviceBLoggedIn);
  const urlCleaned = await pageB.evaluate(() => !location.search.includes('pair='));
  console.log('The ?pair= query param is cleaned from the URL after redeeming:', urlCleaned);

  // Device A's modal should detect completion via polling within a few seconds.
  await pageA.waitForTimeout(2500);
  const paSeesCompleted = await pageA.evaluate(() => document.getElementById('devicePairingContent').textContent.includes('sucesso'));
  console.log('Device A sees the "associated successfully" confirmation via polling:', paSeesCompleted);

  // Re-using the SAME pairing token again must fail (single-use).
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.goto('http://localhost:3000');
  const reuseResp = await pageC.evaluate(async (pairingToken) => {
    const res = await fetch('/api/device-pairing/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingToken, deviceId: 'fake-device-id-reuse-test', deviceName: 'Reuse Attempt' })
    });
    return { ok: res.ok, status: res.status };
  }, createData.pairingToken);
  console.log('Reusing the same pairing token a second time is rejected:', !reuseResp.ok);

  // A THIRD device would now hit the 2-device limit (A + B already used the 2 slots).
  const ctxD = await browser.newContext();
  const pageD = await ctxD.newPage();
  await pageD.goto('http://localhost:3000');
  await pageD.fill('#loginPhone', phone);
  await pageD.fill('#loginPassword', 'senha123');
  await pageD.click('button:has-text("Entrar")');
  await pageD.waitForTimeout(700);
  const deviceDRejected = await pageD.evaluate(() => document.getElementById('mainApp').style.display !== 'flex');
  const deviceDError = await pageD.textContent('#loginError');
  console.log('A 3rd device (regular login) is still correctly rejected after QR pairing used a slot:', deviceDRejected && deviceDError.includes('2 dispositivos'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
