const { chromium } = require('playwright');

// Antes, só o PRIMEIRO utilizador registado no servidor é que era admin
// (ver isAdminPhone/firstRegisteredPhone). Agora há também um caminho
// explícito: marcar "🔑 Registar como administrador" no ecrã de criar conta e
// escrever a senha de administrador do servidor (ADMIN_SIGNUP_SECRET) — só
// funciona com a senha certa, e nunca cria a conta se a senha estiver errada
// (para nunca ficar ninguém a pensar que é admin sem ser). Este teste precisa
// de ADMIN_SIGNUP_SECRET definida no ambiente do servidor (ver run-all.js:
// process.env é propagado para o servidor spawnado).
const ADMIN_SECRET = process.env.ADMIN_SIGNUP_SECRET || 'segredo-teste-123';

async function goToRegisterForm(page) {
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  await page.waitForSelector('#registerFormBox', { state: 'visible' });
}

async function fillRegisterForm(page, name, prefix) {
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3512' + ts.toString().slice(-8);
  const username = prefix + ts;
  await page.fill('#regName', name);
  await page.fill('#regUsername', username);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  return { phone, username };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // Cada "conta" usa o seu próprio contexto (cookies/localStorage isolados) —
  // senão a sessão restaurada automaticamente (authToken em localStorage) de
  // uma página "logaria" as páginas seguintes sozinha, sem chegar a mostrar o
  // ecrã de registo (ver restoreSession() em index.html).
  const ctxThrowaway = await browser.newContext();
  const ctxUi = await browser.newContext();
  const ctxNormal = await browser.newContext();
  const ctxWrong = await browser.newContext();
  const ctxAdmin = await browser.newContext();

  // Consome já a vaga de "primeira conta do servidor" (que fica sempre admin
  // por uma regra à parte, antiga — ver isAdminPhone) com uma conta
  // descartável, para as contas de teste a seguir NUNCA calharem de ser a
  // primeira por acidente (o que tornaria os testes #2 instáveis consoante a
  // ordem de arranque do servidor nesta corrida).
  const throwawayPage = await ctxThrowaway.newPage();
  await goToRegisterForm(throwawayPage);
  await fillRegisterForm(throwawayPage, 'Zeroth Account', 'adminseczero_');
  await throwawayPage.click('button:has-text("Criar conta")');
  await throwawayPage.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // --- 1. O campo da senha de administrador começa escondido, e aparece ao marcar a caixa. ---
  const pageUi = await ctxUi.newPage();
  await goToRegisterForm(pageUi);
  const hiddenBefore = await pageUi.evaluate(() => document.getElementById('regAdminSecret').style.display === 'none');
  console.log('O campo "Senha de administrador" começa escondido:', hiddenBefore);
  await pageUi.check('#regAdminCheck');
  const visibleAfterCheck = await pageUi.evaluate(() => document.getElementById('regAdminSecret').style.display === 'block');
  console.log('Aparece ao marcar "Registar como administrador":', visibleAfterCheck);
  await pageUi.uncheck('#regAdminCheck');
  const hiddenAfterUncheck = await pageUi.evaluate(() => document.getElementById('regAdminSecret').style.display === 'none');
  console.log('Volta a esconder-se ao desmarcar:', hiddenAfterUncheck);

  // --- 2. Registo NORMAL (sem marcar a caixa) nunca fica admin por causa disto. ---
  const normalPage = await ctxNormal.newPage();
  await goToRegisterForm(normalPage);
  await fillRegisterForm(normalPage, 'Admin Test Normal', 'adminsecn_');
  await normalPage.click('button:has-text("Criar conta")');
  await normalPage.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const normalIsAdmin = await normalPage.evaluate(() => APP.user.isAdmin);
  console.log('Conta registada sem marcar a caixa NÃO fica administradora:', normalIsAdmin === false);

  // --- 3. Registo como admin com a senha ERRADA: a conta nem chega a ser criada. ---
  const wrongPage = await ctxWrong.newPage();
  await goToRegisterForm(wrongPage);
  const wrongInfo = await fillRegisterForm(wrongPage, 'Admin Test Wrong', 'adminsecw_');
  await wrongPage.check('#regAdminCheck');
  await wrongPage.fill('#regAdminSecret', 'senha-completamente-errada');
  await wrongPage.click('button:has-text("Criar conta")');
  await wrongPage.waitForTimeout(600);
  const wrongStillOnRegisterScreen = await wrongPage.evaluate(() => document.getElementById('mainApp').style.display !== 'flex');
  const wrongShowsError = await wrongPage.evaluate(() => document.getElementById('registerError').textContent.length > 0);
  console.log('Senha de administrador ERRADA recusa o registo (conta não é criada):', wrongStillOnRegisterScreen && wrongShowsError);

  // Confirma a sério no servidor que a conta nunca chegou a existir (não dá para entrar com essa senha de conta).
  const loginAttempt = await wrongPage.evaluate(async (phone) => {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: 'senha1234forte', deviceId: 'x', deviceName: 'x' }) });
    return r.status;
  }, wrongInfo.phone);
  console.log('A conta rejeitada realmente nunca foi criada no servidor (login por esse telefone falha):', loginAttempt === 401);

  // --- 4. Registo como admin com a senha CERTA: fica marcado como administrador, mesmo não sendo o primeiro utilizador. ---
  const adminPage = await ctxAdmin.newPage();
  await goToRegisterForm(adminPage);
  await fillRegisterForm(adminPage, 'Admin Test Correct', 'adminsecc_');
  await adminPage.check('#regAdminCheck');
  await adminPage.fill('#regAdminSecret', ADMIN_SECRET);
  await adminPage.click('button:has-text("Criar conta")');
  await adminPage.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const correctIsAdmin = await adminPage.evaluate(() => APP.user.isAdmin);
  console.log('Senha de administrador CERTA marca a conta como administradora (mesmo não sendo a primeira conta do servidor):', correctIsAdmin === true);
  const adminBtnVisible = await adminPage.evaluate(() => document.getElementById('adminBtn').style.display !== 'none');
  console.log('O botão de administrador fica visível na app para essa conta:', adminBtnVisible);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
