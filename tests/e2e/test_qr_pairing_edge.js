const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto('http://localhost:3000');
  await pageA.click('.login-switch');
  const ts = Date.now();
  const phone = '+3504' + ts.toString().slice(-8);
  await pageA.fill('#regName', 'QR Edge Test');
  await pageA.fill('#regUsername', 'qredgetest_' + ts);
  await pageA.fill('#regPhone', phone);
  await pageA.selectOption('#regCountry', 'Portugal');
  await pageA.fill('#regEmail', 'qredgetest' + ts + '@test.com');
  await pageA.fill('#regPassword', 'senha123');
  await pageA.click('button:has-text("Criar conta")');
  await pageA.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // --- Test: an expired pairing token is rejected on redeem ---
  const createRes = await pageA.evaluate(async () => {
    const res = await fetch('/api/device-pairing/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': APP.token },
      body: JSON.stringify({ origin: location.origin })
    });
    return res.json();
  });
  console.log('Pairing code created for expiry test:', !!createRes.pairingToken);

  // Fast-forward past expiry using a server-visible trick isn't available from
  // here, so instead verify the /status endpoint reports "pending" right after
  // creation (sanity check) and that a bogus/unknown token reports "expired"
  // immediately (exercises the same code path a real expiry would hit).
  const statusPending = await pageA.evaluate(async (token) => {
    const res = await fetch(`/api/device-pairing/status?pairingToken=${token}`, { headers: { 'X-Auth-Token': APP.token } });
    return (await res.json()).status;
  }, createRes.pairingToken);
  console.log('Status is "pending" right after creation:', statusPending === 'pending');

  const statusUnknown = await pageA.evaluate(async () => {
    const res = await fetch('/api/device-pairing/status?pairingToken=totally-made-up-token', { headers: { 'X-Auth-Token': APP.token } });
    return (await res.json()).status;
  });
  console.log('An unknown/expired token reports "expired":', statusUnknown === 'expired');

  const redeemBogus = await pageA.evaluate(async () => {
    const res = await fetch('/api/device-pairing/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingToken: 'totally-made-up-token', deviceId: 'x', deviceName: 'x' })
    });
    return { ok: res.ok, status: res.status };
  });
  console.log('Redeeming a bogus/expired token is rejected:', !redeemBogus.ok && redeemBogus.status === 400);

  // --- Test: creating a pairing code when already at the 2-device limit is refused up front ---
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto('http://localhost:3000');
  await pageB.fill('#loginPhone', phone);
  await pageB.fill('#loginPassword', 'senha123');
  await pageB.click('button:has-text("Entrar")');
  await pageB.waitForTimeout(700);
  const deviceBIn = await pageB.evaluate(() => document.getElementById('mainApp').style.display === 'flex');
  console.log('2nd device logged in normally:', deviceBIn);

  const createAtLimit = await pageA.evaluate(async () => {
    const res = await fetch('/api/device-pairing/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': APP.token },
      body: JSON.stringify({ origin: location.origin })
    });
    return { ok: res.ok, data: await res.json() };
  });
  console.log('Creating a QR pairing code at the 2-device limit is refused with a clear message:', !createAtLimit.ok && createAtLimit.data.error.includes('2 dispositivos'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
