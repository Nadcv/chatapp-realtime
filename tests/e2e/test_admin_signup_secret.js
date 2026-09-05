const { chromium } = require('playwright');

// Antes, só o PRIMEIRO utilizador registado no servidor é que era admin
// (ver isAdminPhone/firstRegisteredPhone). Agora há também um caminho
// explícito: uma janela PRÓPRIA "🔑 Área do administrador" (link discreto no
// ecrã de login, separada do formulário normal de criar conta de propósito)
// que pede a senha de administrador do servidor (ADMIN_SIGNUP_SECRET) — só
// funciona com a senha certa, e nunca cria a conta se a senha estiver errada
// (para nunca ficar ninguém a pensar que é admin sem ser). Este teste precisa
// de ADMIN_SIGNUP_SECRET definida no ambiente do servidor (ver run-all.js:
// process.env é propagado para o servidor spawnado).
const ADMIN_SECRET = process.env.ADMIN_SIGNUP_SECRET || 'segredo-teste-123';

async function goToLoginScreen(page) {
  await page.goto('http://localhost:3000');
  await page.waitForSelector('#loginFormBox', { state: 'visible' });
}

async function fillAdminRegisterForm(page, name, prefix) {
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3512' + ts.toString().slice(-8);
  const username = prefix + ts;
  await page.fill('#adminRegName', name);
  await page.fill('#adminRegUsername', username);
  await page.fill('#adminRegPhone', phone);
  await page.selectOption('#adminRegCountry', 'Portugal');
  await page.fill('#adminRegEmail', prefix + ts + '@test.com');
  await page.fill('#adminRegPassword', 'senha1234forte');
  return { phone, username };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // Cada "conta" usa o seu próprio contexto (cookies/localStorage isolados) —
  // senão a sessão restaurada automaticamente (authToken em localStorage) de
  // uma página "logaria" as páginas seguintes sozinha, sem chegar a mostrar o
  // ecrã de login (ver restoreSession() em index.html).
  const ctxThrowaway = await browser.newContext();
  const ctxUi = await browser.newContext();
  const ctxNormal = await browser.newContext();
  const ctxWrong = await browser.newContext();
  const ctxAdmin = await browser.newContext();

  // Consome já a vaga de "primeira conta do servidor" (que fica sempre admin
  // por uma regra à parte, antiga — ver isAdminPhone) com uma conta
  // descartável (registo normal), para as contas de teste a seguir NUNCA
  // calharem de ser a primeira por acidente (o que tornaria os testes #2
  // instáveis consoante a ordem de arranque do servidor nesta corrida).
  const throwawayPage = await ctxThrowaway.newPage();
  await goToLoginScreen(throwawayPage);
  await throwawayPage.click('.login-switch');
  await throwawayPage.waitForSelector('#registerFormBox', { state: 'visible' });
  const ts0 = Date.now();
  await throwawayPage.fill('#regName', 'Zeroth Account');
  await throwawayPage.fill('#regUsername', 'adminseczero_' + ts0);
  await throwawayPage.fill('#regPhone', '+3512' + ts0.toString().slice(-8));
  await throwawayPage.selectOption('#regCountry', 'Portugal');
  await throwawayPage.fill('#regEmail', 'adminseczero_' + ts0 + '@test.com');
  await throwawayPage.fill('#regPassword', 'senha1234forte');
  await throwawayPage.click('button:has-text("Criar conta")');
  await throwawayPage.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // --- 1. O link "Área do administrador" está no ecrã de login (não no formulário normal de criar conta), e abre uma janela própria. ---
  const pageUi = await ctxUi.newPage();
  await goToLoginScreen(pageUi);
  const linkVisibleOnLogin = await pageUi.locator('.login-switch:has-text("Área do administrador")').isVisible();
  console.log('O link "🔑 Área do administrador" está visível no ecrã de login:', linkVisibleOnLogin);
  await pageUi.click('.login-switch:has-text("Área do administrador")');
  const modalOpened = await pageUi.evaluate(() => document.getElementById('modalAdminRegister').classList.contains('active'));
  console.log('Abre a janela própria "Área do administrador":', modalOpened);
  const noAdminFieldsInNormalForm = await pageUi.evaluate(() => document.getElementById('regAdminCheck') === null && document.getElementById('regAdminSecret') === null);
  console.log('O formulário normal de "Criar conta" já não tem nenhum campo de administrador:', noAdminFieldsInNormalForm);

  // --- 2. Registo NORMAL (pelo formulário de sempre) nunca fica admin por causa disto. ---
  const normalPage = await ctxNormal.newPage();
  await goToLoginScreen(normalPage);
  await normalPage.click('.login-switch');
  await normalPage.waitForSelector('#registerFormBox', { state: 'visible' });
  const tsN = Date.now();
  await normalPage.fill('#regName', 'Admin Test Normal');
  await normalPage.fill('#regUsername', 'adminsecn_' + tsN);
  await normalPage.fill('#regPhone', '+3512' + tsN.toString().slice(-8));
  await normalPage.selectOption('#regCountry', 'Portugal');
  await normalPage.fill('#regEmail', 'adminsecn_' + tsN + '@test.com');
  await normalPage.fill('#regPassword', 'senha1234forte');
  await normalPage.click('button:has-text("Criar conta")');
  await normalPage.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const normalIsAdmin = await normalPage.evaluate(() => APP.user.isAdmin);
  console.log('Conta registada pelo formulário normal NÃO fica administradora:', normalIsAdmin === false);

  // --- 3. Área do administrador com a senha ERRADA: a conta nem chega a ser criada. ---
  const wrongPage = await ctxWrong.newPage();
  await goToLoginScreen(wrongPage);
  await wrongPage.click('.login-switch:has-text("Área do administrador")');
  await wrongPage.waitForSelector('#modalAdminRegister.active');
  const wrongInfo = await fillAdminRegisterForm(wrongPage, 'Admin Test Wrong', 'adminsecw_');
  await wrongPage.fill('#adminRegSecret', 'senha-completamente-errada');
  await wrongPage.click('#modalAdminRegister button:has-text("Criar conta de administrador")');
  await wrongPage.waitForTimeout(600);
  const wrongStillOnLoginScreen = await wrongPage.evaluate(() => document.getElementById('mainApp').style.display !== 'flex');
  const wrongShowsError = await wrongPage.evaluate(() => document.getElementById('adminRegisterError').textContent.length > 0);
  console.log('Senha de administrador ERRADA recusa o registo (conta não é criada):', wrongStillOnLoginScreen && wrongShowsError);

  // Confirma a sério no servidor que a conta nunca chegou a existir (não dá para entrar com essa senha de conta).
  const loginAttempt = await wrongPage.evaluate(async (phone) => {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: 'senha1234forte', deviceId: 'x', deviceName: 'x' }) });
    return r.status;
  }, wrongInfo.phone);
  console.log('A conta rejeitada realmente nunca foi criada no servidor (login por esse telefone falha):', loginAttempt === 401);

  // --- 4. Área do administrador com a senha CERTA: fica marcado como administrador, mesmo não sendo o primeiro utilizador. ---
  const adminPage = await ctxAdmin.newPage();
  await goToLoginScreen(adminPage);
  await adminPage.click('.login-switch:has-text("Área do administrador")');
  await adminPage.waitForSelector('#modalAdminRegister.active');
  await fillAdminRegisterForm(adminPage, 'Admin Test Correct', 'adminsecc_');
  await adminPage.fill('#adminRegSecret', ADMIN_SECRET);
  await adminPage.click('#modalAdminRegister button:has-text("Criar conta de administrador")');
  await adminPage.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const correctIsAdmin = await adminPage.evaluate(() => APP.user.isAdmin);
  console.log('Senha de administrador CERTA marca a conta como administradora (mesmo não sendo a primeira conta do servidor):', correctIsAdmin === true);
  const adminBtnVisible = await adminPage.evaluate(() => document.getElementById('adminBtn').style.display !== 'none');
  console.log('O botão de administrador fica visível na app para essa conta:', adminBtnVisible);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
