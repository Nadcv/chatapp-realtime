const { chromium } = require('playwright');

async function getLastEmail(to) {
  // Filtra pelo destinatário — o servidor SMTP falso é PARTILHADO com outros
  // testes de email (ex.: test_2fa.js) que podem correr em paralelo, e sem
  // este filtro um teste podia ler o email do outro.
  const res = await fetch('http://127.0.0.1:2526/?to=' + encodeURIComponent(to));
  const data = await res.json();
  return data.lastMessage;
}
function extractCode(emailBody) {
  // O boundary MIME (ex.: "--_NmP-a55cab6884976a3f-Part_1") é uma string
  // hexadecimal aleatória que por vezes contém, por coincidência, uma
  // sequência de 6 dígitos — e essa aparece no email MAIS vezes do que o
  // código real (cabeçalho + delimitadores de cada parte). Por isso exigimos
  // que o código esteja isolado por um caracter não-alfanumérico dos dois
  // lados, o que exclui dígitos embutidos no meio de um token hexadecimal.
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
  const phone = '+3519' + ts.toString().slice(-8);
  const email = 'pwreset' + ts + '@test.com';
  await page.fill('#regName', 'Reset Test');
  await page.fill('#regUsername', 'pwreset_' + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', email);
  await page.fill('#regPassword', 'senhaAntiga123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // A second device stays logged in with the OLD password — used later to
  // confirm resetting the password force-logs it out too.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto('http://localhost:3000');
  await page2.fill('#loginPhone', phone);
  await page2.fill('#loginPassword', 'senhaAntiga123');
  await page2.click('button:has-text("Entrar")');
  await page2.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  let page2Dialogs = [];
  page2.on('dialog', d => { page2Dialogs.push(d.message()); d.accept(); });

  await page.evaluate(() => logout());
  await page.waitForTimeout(300);

  // --- Nonexistent phone gets a clear error ---
  await page.evaluate(() => showAuthForm('forgotPassword'));
  await page.waitForSelector('#forgotPasswordBox', { state: 'visible', timeout: 3000 });
  await page.fill('#forgotPhoneInput', '+351000000000');
  await page.click('button:has-text("Enviar código por email")');
  await page.waitForTimeout(400);
  const notFoundError = await page.evaluate(() => document.getElementById('forgotPasswordError').textContent.includes('Não existe'));
  console.log('Telefone inexistente dá um erro claro:', notFoundError);

  // --- Request reset for the real account ---
  await page.fill('#forgotPhoneInput', phone);
  await page.click('button:has-text("Enviar código por email")');
  await page.waitForSelector('#resetPasswordBox', { state: 'visible', timeout: 3000 });
  const maskedShown = await page.evaluate(() => document.getElementById('resetPasswordEmailLabel').textContent);
  console.log('Mostra o email mascarado (não completo):', maskedShown.includes('*') && !maskedShown.includes(email));

  await page.waitForTimeout(500);
  const emailBody = await getLastEmail(email);
  // Nota: o Subject vem codificado em MIME (RFC2047, por causa do emoji/acentos)
  // e não aparece como texto literal — o corpo em texto simples (ASCII puro,
  // sem acentos nessa frase) é o sinal fiável de que o email certo foi enviado.
  console.log('Um email real de redefinição foi enviado (via SMTP fake):', !!emailBody && emailBody.includes('para redefinir a senha da tua conta'));
  const code = extractCode(emailBody);

  // --- Wrong code rejected ---
  await page.fill('#resetCodeInput', '000000');
  await page.fill('#resetNewPasswordInput', 'senhaNovaForte123');
  await page.click('button:has-text("Redefinir senha")');
  await page.waitForTimeout(300);
  const wrongCodeRejected = await page.evaluate(() => document.getElementById('resetPasswordError').textContent.includes('incorreto'));
  console.log('Código errado é rejeitado:', wrongCodeRejected);

  // --- Weak new password rejected ---
  await page.fill('#resetCodeInput', code);
  await page.fill('#resetNewPasswordInput', '12345678');
  await page.click('button:has-text("Redefinir senha")');
  await page.waitForTimeout(300);
  const weakPasswordRejected = await page.evaluate(() => document.getElementById('resetPasswordError').textContent.includes('comum') || document.getElementById('resetPasswordError').textContent.includes('fácil'));
  console.log('Senha nova fraca é rejeitada:', weakPasswordRejected);

  // --- Correct code + strong password succeeds ---
  page.once('dialog', d => d.accept());
  await page.fill('#resetCodeInput', code);
  await page.fill('#resetNewPasswordInput', 'senhaNovaForte123');
  await page.click('button:has-text("Redefinir senha")');
  await page.waitForSelector('#loginFormBox', { state: 'visible', timeout: 5000 });
  const backOnLogin = await page.evaluate(() => document.getElementById('loginFormBox').style.display === 'flex');
  console.log('Depois de redefinir com sucesso, volta ao ecrã de login:', backOnLogin);
  const phonePrefilled = await page.evaluate(() => document.getElementById('loginPhone').value);
  console.log('O telefone já vem preenchido para facilitar entrar:', phonePrefilled === phone);

  // --- The other logged-in device gets force-logged-out with a clear reason ---
  await page2.waitForTimeout(500);
  const page2LoggedOut = await page2.evaluate(() => document.getElementById('loginScreen').classList.contains('hidden') === false);
  const page2GotExplained = page2Dialogs.some(m => m.includes('senha') && m.includes('redefinida'));
  console.log('O outro dispositivo ligado à mesma conta é desligado quando a senha é redefinida:', page2LoggedOut);
  console.log('Esse dispositivo recebe uma explicação clara (não parece só uma falha de rede):', page2GotExplained);

  // --- Old password no longer works ---
  const oldPassRes = await page.evaluate(async (p) => {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p, password: 'senhaAntiga123', deviceId: 'x', deviceName: 'x' }) });
    return r.status;
  }, phone);
  console.log('A senha antiga deixa de funcionar:', oldPassRes === 401);

  // --- New password works ---
  await page.fill('#loginPhone', phone);
  await page.fill('#loginPassword', 'senhaNovaForte123');
  await page.click('button:has-text("Entrar")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const newPassWorks = await page.evaluate(() => document.getElementById('mainApp').style.display === 'flex');
  console.log('A senha nova funciona para entrar:', newPassWorks);

  // --- Code is single-use: reusing it must fail now ---
  const reuseRes = await page.evaluate(async ({ p, c }) => {
    const r = await fetch('/api/password-reset/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p, code: c, newPassword: 'outraSenhaForte123' }) });
    return r.status;
  }, { p: phone, c: code });
  console.log('O código de redefinição não pode ser reutilizado:', reuseRes !== 200);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
