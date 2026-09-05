// O registo exige agora confirmar um código enviado para o email indicado —
// só entra em ação quando o servidor tem email configurado (getMailTransporter()),
// que É o caso neste lote de testes (SMTP falso, ver fake_smtp.js). Sem isto,
// qualquer email inventado/alheio registava-se à vontade; a conta agora só é
// criada a sério depois de confirmado o código.
const { chromium } = require('playwright');

async function getLastEmail(to) {
  const res = await fetch('http://127.0.0.1:2526/?to=' + encodeURIComponent(to));
  const data = await res.json();
  return data.lastMessage;
}
function extractCode(emailBody) {
  const matches = [...emailBody.matchAll(/(?<![a-zA-Z0-9])(\d{6})(?![a-zA-Z0-9])/g)].map(m => m[1]);
  const counts = {};
  matches.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
  const repeated = Object.entries(counts).find(([, n]) => n >= 2);
  return repeated ? repeated[0] : (matches[matches.length - 1] || null);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  const phone = '+3518' + ts.toString().slice(-8);
  const username = 'regemail_' + ts;
  const email = 'regemail' + ts + '@test.com';

  // --- Email claramente inválido é recusado logo, sem sequer tentar enviar nada. ---
  await page.fill('#regName', 'Register Email Test');
  await page.fill('#regUsername', username);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'isto-nao-e-um-email');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForTimeout(400);
  const invalidEmailRejected = await page.evaluate(() => document.getElementById('registerError').textContent.includes('válido'));
  console.log('Email claramente inválido é recusado logo (sem mandar código):', invalidEmailRejected);

  // --- Email válido: fica "por confirmar", NÃO entra logo na app. ---
  await page.fill('#regEmail', email);
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#registerVerifyBox', { state: 'visible', timeout: 5000 });
  const notLoggedInYet = await page.evaluate(() => document.getElementById('mainApp').style.display !== 'flex');
  console.log('Depois de submeter um email válido, NÃO entra logo na app (fica à espera do código):', notLoggedInYet);
  const maskedShown = await page.evaluate(() => document.getElementById('registerVerifyEmailLabel').textContent);
  console.log('Mostra o email mascarado (não completo):', maskedShown.includes('*') && !maskedShown.includes(email));

  // --- A conta ainda não existe a sério: login com essa senha falha. ---
  const loginBeforeConfirm = await page.evaluate(async (p) => {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p, password: 'senha1234forte', deviceId: 'x', deviceName: 'x' }) });
    return r.status;
  }, phone);
  console.log('Antes de confirmar o código, a conta ainda não existe a sério (login falha):', loginBeforeConfirm === 401);

  await page.waitForTimeout(500);
  const emailBody = await getLastEmail(email);
  console.log('Um email real de confirmação foi enviado (via SMTP fake):', !!emailBody && emailBody.includes('confirma') && /\d{6}/.test(emailBody));
  const code = extractCode(emailBody);

  // --- Código errado é recusado, continua no ecrã de confirmação. ---
  await page.fill('#registerVerifyCodeInput', '000000');
  await page.click('#registerVerifyBox button:has-text("Confirmar")');
  await page.waitForTimeout(400);
  const wrongCodeRejected = await page.evaluate(() => document.getElementById('registerVerifyError').textContent.includes('incorreto'));
  console.log('Código errado é rejeitado com mensagem clara:', wrongCodeRejected);
  const stillOnVerifyScreen = await page.evaluate(() => document.getElementById('registerVerifyBox').style.display === 'flex');
  console.log('Continua no ecrã de confirmação depois de um código errado:', stillOnVerifyScreen);

  // --- Código certo: agora sim, conta criada e login automático. ---
  await page.fill('#registerVerifyCodeInput', code);
  await page.click('#registerVerifyBox button:has-text("Confirmar")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const loggedInAfterConfirm = await page.evaluate(() => document.getElementById('mainApp').style.display === 'flex');
  console.log('Depois do código certo, a conta é criada e entra automaticamente:', loggedInAfterConfirm);

  // --- O código já usado não pode ser reutilizado (ex.: pedido repetido). ---
  const reuseRes = await page.evaluate(async ({ p, c }) => {
    const r = await fetch('/api/register/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p, code: c }) });
    return { ok: r.ok };
  }, { p: phone, c: code });
  console.log('O código de confirmação não pode ser reutilizado:', reuseRes.ok === false);

  // --- Enquanto uma segunda pessoa tenta o MESMO telefone antes de confirmar, é recusado. ---
  const page2 = await browser.newPage();
  await page2.goto('http://localhost:3000');
  await page2.click('.login-switch');
  const ts2 = Date.now();
  await page2.fill('#regName', 'Outra Pessoa');
  await page2.fill('#regUsername', 'regemail_outra_' + ts2);
  await page2.fill('#regPhone', phone); // mesmo telefone já usado (e confirmado) acima
  await page2.selectOption('#regCountry', 'Portugal');
  await page2.fill('#regEmail', 'outra' + ts2 + '@test.com');
  await page2.fill('#regPassword', 'senha1234forte');
  await page2.click('button:has-text("Criar conta")');
  await page2.waitForTimeout(400);
  const duplicatePhoneRejected = await page2.evaluate(() => document.getElementById('registerError').textContent.includes('Já existe'));
  console.log('Um telefone já confirmado por outra conta não pode ser reutilizado:', duplicatePhoneRejected);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
