// Tests the graceful-degradation paths of 2FA: (1) can't enable without an
// email on file, (2) even if enabled, login never gets blocked when the
// server has no mail transporter configured at all (this test's server run
// has no EMAIL_USER/EMAIL_PASS set) — a legitimate account owner must never
// get locked out just because email sending isn't configured.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  const phone = '+3514' + ts.toString().slice(-8);
  await page.fill('#regName', 'Fallback Test');
  await page.fill('#regUsername', 'fallback2fa_' + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  // No email filled in on purpose.
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // --- Cannot enable 2FA without an email on file ---
  const noEmailResult = await page.evaluate(async () => {
    return new Promise((resolve) => { socket.once('two_factor_updated', resolve); socket.emit('set_two_factor', { enabled: true }); });
  });
  console.log('Ativar 2FA sem email é recusado com um erro claro:', noEmailResult.twoFactorEnabled === false && !!noEmailResult.error);

  // Now set an email, then enabling should succeed.
  await page.evaluate((email) => {
    return new Promise((resolve) => { socket.once('email_updated', resolve); socket.emit('set_email', { email }); });
  }, 'fallback' + ts + '@test.com');
  const withEmailResult = await page.evaluate(async () => {
    return new Promise((resolve) => { socket.once('two_factor_updated', resolve); socket.emit('set_two_factor', { enabled: true }); });
  });
  console.log('Depois de definir um email, ativar 2FA funciona:', withEmailResult.twoFactorEnabled === true);

  // --- Server has NO mail transporter configured in this run (no EMAIL_USER/PASS) ---
  // A brand-new device logging in must NOT be blocked, even with 2FA "on".
  await page.evaluate(() => logout());
  await page.waitForTimeout(300);
  const newDeviceLoginRes = await page.evaluate(async (p) => {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p, password: 'senha1234forte', deviceId: 'some-other-fresh-device-id', deviceName: 'Another Device' }) });
    return { status: r.status, body: await r.json() };
  }, phone);
  console.log('Sem servidor de email configurado, um dispositivo novo consegue entrar na mesma (nunca fica bloqueado por falta de configuração):', newDeviceLoginRes.body.success === true && !newDeviceLoginRes.body.needsVerification);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
