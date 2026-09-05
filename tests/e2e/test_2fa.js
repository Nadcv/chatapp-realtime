// Full end-to-end test of the new two-factor login flow, using a real (fake)
// SMTP server the app server actually connects to (see fake_smtp.js) — this
// exercises the REAL email-sending code path, not a mocked/bypassed one.
const { chromium } = require('playwright');

async function getLastEmail(to) {
  // Filtra pelo destinatário — o servidor SMTP falso é PARTILHADO com outros
  // testes de email (ex.: test_password_reset.js) que podem correr em
  // paralelo, e sem este filtro um teste podia ler o email do outro.
  const res = await fetch('http://127.0.0.1:2526/?to=' + encodeURIComponent(to));
  const data = await res.json();
  return data.lastMessage;
}
function extractCode(emailBody) {
  // The email has a plain-text AND an html part, both carrying the real code
  // — picking whichever 6-digit run appears TWICE avoids false matches from
  // headers/MIME boundaries (Message-ID, Date, etc.). The random MIME
  // boundary hex string can itself contain a 6-digit run embedded between
  // letters (e.g. "...cab6884976a3f...") that shows up MORE often than the
  // real code (once per part delimiter) — requiring non-alphanumeric
  // characters on both sides excludes digits embedded inside such a token.
  const matches = [...emailBody.matchAll(/(?<![a-zA-Z0-9])(\d{6})(?![a-zA-Z0-9])/g)].map(m => m[1]);
  const counts = {};
  matches.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
  const repeated = Object.entries(counts).find(([, n]) => n >= 2);
  return repeated ? repeated[0] : (matches[matches.length - 1] || null);
}

// O registo agora exige confirmar um código de email (ver "Regista os
// utilizadores no cadastro" — só entra em ação quando o servidor tem email
// configurado, que É o caso neste lote de testes via SMTP falso) — regista e
// já resolve esse passo, para o resto do teste continuar como antes.
async function registerAndConfirmEmail(page, { name, username, phone, email, password }) {
  await page.fill('#regName', name);
  await page.fill('#regUsername', username);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', email);
  await page.fill('#regPassword', password);
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#registerVerifyBox', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(500);
  const emailBody = await getLastEmail(email);
  const code = extractCode(emailBody);
  await page.fill('#registerVerifyCodeInput', code);
  await page.click('#registerVerifyBox button:has-text("Confirmar")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  const phone = '+3516' + ts.toString().slice(-8);
  const email = '2fa' + ts + '@test.com';
  await registerAndConfirmEmail(page, { name: '2FA Test', username: 'twofa_' + ts, phone, email, password: 'senha1234forte' });

  // --- Toggle should require an email already being present (it is, from registration) ---
  await page.evaluate(() => openProfileModal());
  const emailPrefilled = await page.evaluate(() => document.getElementById('profileEmailInput').value);
  console.log('Email do perfil vem pré-preenchido do registo:', emailPrefilled === email);
  const twoFaOffByDefault = await page.evaluate(() => !document.getElementById('twoFactorCheck').checked);
  console.log('2FA vem desligada por omissão:', twoFaOffByDefault);

  // Enable 2FA.
  await page.evaluate(() => { document.getElementById('twoFactorCheck').checked = true; saveTwoFactorSetting(); });
  await page.waitForTimeout(400);
  const twoFaEnabled = await page.evaluate(() => APP.user.twoFactorEnabled === true);
  console.log('2FA fica ativada depois do toggle:', twoFaEnabled);

  // --- Existing device: logging out and back in on the SAME device/browser must NOT ask for a code ---
  await page.evaluate(() => logout());
  await page.waitForTimeout(300);
  // (deviceId persists in localStorage across logout — this is still "the same device")
  await page.fill('#loginPhone', phone);
  await page.fill('#loginPassword', 'senha1234forte');
  await page.click('button:has-text("Entrar")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const noCodeAskedOnSameDevice = await page.evaluate(() => document.getElementById('mainApp').style.display === 'flex');
  console.log('BUG CHECK: dispositivo já conhecido NÃO pede código (só a password):', noCodeAskedOnSameDevice);

  await browser.close();

  // --- New device (fresh browser context = fresh localStorage = fresh deviceId) ---
  const browser2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page2 = await browser2.newPage();
  await page2.goto('http://localhost:3000');
  await page2.fill('#loginPhone', phone);
  await page2.fill('#loginPassword', 'senha1234forte');
  await page2.click('button:has-text("Entrar")');

  await page2.waitForSelector('#verifyCodeBox', { state: 'visible', timeout: 5000 });
  const verifyBoxShown = await page2.evaluate(() => document.getElementById('verifyCodeBox').style.display === 'flex');
  console.log('Dispositivo NOVO é barrado e mostra o ecrã de código:', verifyBoxShown);
  const maskedEmailShown = await page2.evaluate(() => document.getElementById('verifyCodeEmailLabel').textContent);
  console.log('Mostra o email mascarado (não o email completo):', maskedEmailShown.includes('*') && !maskedEmailShown.includes(email));

  await page2.waitForTimeout(500);
  const emailBody = await getLastEmail(email);
  console.log('Um email real foi mesmo enviado pelo servidor (via SMTP fake) com um código:', !!emailBody && /\d{6}/.test(emailBody));
  const code = extractCode(emailBody);

  // Wrong code first.
  await page2.fill('#verifyCodeInput', '000000');
  await page2.click('button:has-text("Confirmar")');
  await page2.waitForTimeout(300);
  const wrongCodeRejected = await page2.evaluate(() => document.getElementById('verifyCodeError').textContent.includes('incorreto'));
  console.log('Código errado é rejeitado com uma mensagem clara:', wrongCodeRejected);
  const stillOnVerifyScreen = await page2.evaluate(() => document.getElementById('verifyCodeBox').style.display === 'flex');
  console.log('Continua no ecrã de verificação depois de um código errado:', stillOnVerifyScreen);

  // Correct code.
  await page2.fill('#verifyCodeInput', code);
  await page2.click('button:has-text("Confirmar")');
  await page2.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const loggedInAfterCode = await page2.evaluate(() => document.getElementById('mainApp').style.display === 'flex');
  console.log('Login completa com sucesso depois do código certo:', loggedInAfterCode);

  // Code must be single-use — reusing it (e.g. a replayed request) must fail now.
  const reuseRes = await page2.evaluate(async ({ p, c }) => {
    const r = await fetch('/api/login/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p, code: c }) });
    return { ok: r.ok, body: await r.json() };
  }, { p: phone, c: code });
  console.log('O mesmo código não pode ser reutilizado depois de já ter sido usado:', reuseRes.ok === false);

  // This account is now at the 2-device cap (original registration device +
  // this new one) — free up the FIRST device's slot so a 3rd fresh browser
  // context can reach the 2FA challenge below instead of being rejected by
  // the unrelated "max 2 devices" limit.
  await page2.evaluate(async () => {
    const token = localStorage.getItem('authToken');
    const devicesRes = await fetch('/api/devices?deviceId=' + encodeURIComponent(getOrCreateDeviceId()), { headers: { 'x-auth-token': token } });
    const { devices } = await devicesRes.json();
    const other = devices.find(d => !d.isThisDevice);
    if (other) await fetch('/api/devices/remove', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': token }, body: JSON.stringify({ deviceId: other.id }) });
  });

  await browser2.close();

  // --- 3rd context: brute-force cap (5 wrong attempts invalidates the pending code) ---
  const browser3 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page3 = await browser3.newPage();
  await page3.goto('http://localhost:3000');
  await page3.fill('#loginPhone', phone);
  await page3.fill('#loginPassword', 'senha1234forte');
  await page3.click('button:has-text("Entrar")');
  await page3.waitForSelector('#verifyCodeBox', { state: 'visible', timeout: 5000 });
  await page3.waitForTimeout(400);
  let lastBody = null;
  for (let i = 0; i < 6; i++) {
    lastBody = await page3.evaluate(async (p) => {
      const r = await fetch('/api/login/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p, code: '999999' }) });
      return { status: r.status, body: await r.json() };
    }, phone);
  }
  console.log('Ao fim de várias tentativas erradas, o código pendente é invalidado (429 + mensagem de "demasiadas tentativas"):', lastBody.status === 429 && lastBody.body.error.includes('Demasiadas'));

  await browser3.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
