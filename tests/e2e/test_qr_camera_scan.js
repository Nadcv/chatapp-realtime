const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // First register an account (device A) so there's something to QR-pair into,
  // and get a real pairing token from it.
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto('http://localhost:3000');
  await pageA.click('.login-switch');
  const ts = Date.now();
  const phone = '+3503' + ts.toString().slice(-8);
  await pageA.fill('#regName', 'QR Cam Test');
  await pageA.fill('#regUsername', 'qrcamtest_' + ts);
  await pageA.fill('#regPhone', phone);
  await pageA.selectOption('#regCountry', 'Portugal');
  await pageA.fill('#regEmail', 'qrcamtest' + ts + '@test.com');
  await pageA.fill('#regPassword', 'senha123');
  await pageA.click('button:has-text("Criar conta")');
  await pageA.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await pageA.evaluate(() => openDevicesModal());
  const [createResp] = await Promise.all([
    pageA.waitForResponse(r => r.url().includes('/api/device-pairing/create')),
    pageA.click('button:has-text("Associar novo dispositivo")'),
  ]);
  const { pairingToken } = await createResp.json();

  // --- Test 1: real (unmocked) Chromium build here has no BarcodeDetector —
  // clicking the button on the LOGIN screen must show the graceful fallback,
  // not a broken/frozen camera screen. ---
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  pageB.on('pageerror', err => console.log('B PAGE EXCEPTION:', err.message));
  await pageB.goto('http://localhost:3000');
  const qrButtonOnlyOnLogin = await pageB.evaluate(() => {
    const loginHasIt = !!document.querySelector('#loginFormBox button[onclick="openQrScanModal()"]');
    return loginHasIt;
  });
  console.log('The QR-scan button is present on the LOGIN form:', qrButtonOnlyOnLogin);
  await pageB.click('#loginFormBox .login-switch');
  const qrButtonAbsentOnRegister = await pageB.evaluate(() => !document.querySelector('#registerFormBox button[onclick="openQrScanModal()"]'));
  console.log('The QR-scan button is NOT present on the REGISTER form (as requested):', qrButtonAbsentOnRegister);
  await pageB.click('#registerFormBox .login-switch'); // back to login form

  await pageB.click('button[onclick="openQrScanModal()"]');
  await pageB.waitForSelector('#modalQrScan.active');
  await pageB.waitForTimeout(300);
  const fallbackShown = await pageB.textContent('#qrScanContent');
  console.log('Unsupported browser shows a clear fallback message (not a broken camera screen):', fallbackShown.includes('não suporta leitura de QR'));
  // The fallback path replaces #qrScanContent's innerHTML with just the
  // message, so the <video> element is removed entirely rather than merely
  // hidden — either way, no camera view should be showing.
  const videoHiddenInFallback = await pageB.evaluate(() => !document.getElementById('qrScanVideo'));
  console.log('No camera view is shown when unsupported (video element gone, not left dangling):', videoHiddenInFallback);
  await pageB.click('button:has-text("Cancelar")');

  // --- Test 2: mock a fake BarcodeDetector that immediately "sees" the real
  // pairing QR content, to exercise the actual scan-success handling logic. ---
  const ctxC = await browser.newContext({ permissions: ['camera'] });
  const pageC = await ctxC.newPage();
  pageC.on('pageerror', err => console.log('C PAGE EXCEPTION:', err.message));
  await pageC.addInitScript((token) => {
    window.__fakeDetectCalls = 0;
    window.BarcodeDetector = class {
      constructor() {}
      async detect() {
        window.__fakeDetectCalls++;
        if (window.__fakeDetectCalls < 2) return []; // simula 1 frame sem código antes de "ver" o QR
        return [{ rawValue: `${location.origin}/?pair=${token}` }];
      }
    };
    // Fake camera stream so getUserMedia doesn't need real hardware — must be
    // a real MediaStream instance, since HTMLVideoElement.srcObject validates
    // the type strictly (a plain {getTracks} object throws a TypeError). An
    // empty (trackless) MediaStream never reaches "enough data" for a real
    // <video>.play() to resolve, so also stub play() itself for this test —
    // a real camera stream always has actual tracks and doesn't need this.
    navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  }, pairingToken);
  await pageC.goto('http://localhost:3000');
  await pageC.click('button[onclick="openQrScanModal()"]');
  await pageC.waitForTimeout(500);
  const scannedIn = await pageC.evaluate(() => APP.user && APP.user.name === 'QR Cam Test');
  console.log('Scanning the QR (mocked detector) logs the new device straight in:', scannedIn);
  const modalClosedAfterScan = await pageC.evaluate(() => !document.getElementById('modalQrScan').classList.contains('active'));
  console.log('The scan modal closes automatically after a successful scan:', modalClosedAfterScan);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
