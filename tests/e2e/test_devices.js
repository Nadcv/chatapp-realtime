const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(name, 'PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3507' + ts.toString().slice(-8);
  const password = 'senha123';
  await page.fill('#regName', name);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', password);
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone, password };
}

async function login(context, phone, password) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log('LOGIN PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.fill('#loginPhone', phone);
  await page.fill('#loginPassword', password);
  await page.click('button:has-text("Entrar")');
  await page.waitForTimeout(700);
  const mainAppVisible = await page.evaluate(() => document.getElementById('mainApp').style.display === 'flex');
  const errorText = await page.textContent('#loginError').catch(() => '');
  return { page, mainAppVisible, errorText };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // Device A: register (this is device 1, automatically counted).
  const ctxA = await browser.newContext();
  const a = await register(ctxA, 'Device Test', 'devtest_');
  console.log('Device A registered successfully.');

  // Device B: fresh context (fresh localStorage -> fresh deviceId), log in with the SAME account.
  const ctxB = await browser.newContext();
  const b = await login(ctxB, a.phone, a.password);
  console.log('Device B (2nd device) can log in:', b.mainAppVisible);

  // Device C: a THIRD fresh context/device trying the same account -> must be rejected.
  const ctxC = await browser.newContext();
  const c = await login(ctxC, a.phone, a.password);
  console.log('Device C (3rd device) is REJECTED:', !c.mainAppVisible);
  console.log('Rejection message mentions the 2-device limit:', c.errorText.includes('2 dispositivos'));

  // Re-logging in on device A (already-registered device) should still work fine
  // (same deviceId already counted, not a "new" slot) — reuse ctxA's own
  // localStorage (which still has its deviceId) after clearing just the auth token.
  await a.page.goto('http://localhost:3000');
  await a.page.evaluate(() => { localStorage.removeItem('authToken'); localStorage.removeItem('authUser'); });
  await a.page.reload();
  await a.page.fill('#loginPhone', a.phone);
  await a.page.fill('#loginPassword', a.password);
  await a.page.click('button:has-text("Entrar")');
  await a.page.waitForTimeout(700);
  const aRelogin = await a.page.evaluate(() => document.getElementById('mainApp').style.display === 'flex');
  console.log('Device A (already-registered device) can log in again without using a new slot:', aRelogin);

  // --- Devices management screen: device A should see 2 devices listed ---
  await a.page.evaluate(() => openDevicesModal());
  await a.page.waitForTimeout(500);
  const devicesListText = await a.page.textContent('#devicesList');
  const deviceCount = await a.page.evaluate(() => document.querySelectorAll('#devicesList > div').length);
  console.log('Devices list shows 2 devices:', deviceCount === 2);
  console.log('Device A is marked as "(este dispositivo)":', devicesListText.includes('este dispositivo'));

  // Remove device B, freeing a slot, then device C should be able to log in.
  a.page.once('dialog', (d) => d.accept());
  await a.page.click('#devicesList button:has-text("Remover")');
  await a.page.waitForTimeout(500);
  const deviceCountAfterRemoval = await a.page.evaluate(() => document.querySelectorAll('#devicesList > div').length);
  console.log('Devices list shows 1 device after removing one:', deviceCountAfterRemoval === 1);

  const ctxC2 = await browser.newContext();
  const c2 = await login(ctxC2, a.phone, a.password);
  console.log('Device C can now log in after a slot was freed:', c2.mainAppVisible);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
