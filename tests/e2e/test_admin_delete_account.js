// The FIRST account ever registered on a fresh server (no MONGO_URI/ADMIN_PHONE
// set) becomes the admin (see isAdminPhone). This test relies on being run
// against a freshly-restarted server so "Admin Test" really is first.
const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3517' + ts.toString().slice(-8);
  await page.fill('#regName', name);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxAdmin = await browser.newContext();
  const ctxVictim = await browser.newContext();
  const admin = await register(ctxAdmin, 'Admin Test', 'admintest_');
  const victim = await register(ctxVictim, 'Vitima Esqueceu Senha', 'victim_');

  const isAdmin = await admin.page.evaluate(() => APP.user.isAdmin);
  console.log('A primeira conta registada neste servidor é admin:', isAdmin);
  const victimIsNotAdmin = await victim.page.evaluate(() => APP.user.isAdmin === false);
  console.log('A conta seguinte NÃO é admin:', victimIsNotAdmin);

  // --- Non-admin cannot call the admin delete endpoint directly ---
  const forbiddenRes = await victim.page.evaluate(async (targetPhone) => {
    const r = await fetch('/api/admin/delete-account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token }, body: JSON.stringify({ phone: targetPhone }) });
    return { status: r.status, body: await r.json() };
  }, admin.phone);
  console.log('Uma conta não-admin não consegue apagar contas (403):', forbiddenRes.status === 403);

  // --- Admin panel shows the delete button, but not for the admin's own row ---
  await admin.page.evaluate(() => openAdminModal());
  await admin.page.waitForSelector('#modalAdmin.active', { timeout: 3000 });
  await admin.page.waitForTimeout(300);
  const victimRowHasDeleteBtn = await admin.page.evaluate((phone) => {
    const rows = [...document.querySelectorAll('#adminUsersBody tr')];
    const row = rows.find(r => r.textContent.includes(phone));
    return !!row && !!row.querySelector('button');
  }, victim.phone);
  console.log('A linha da vítima tem um botão de apagar:', victimRowHasDeleteBtn);
  const adminRowHasNoDeleteBtn = await admin.page.evaluate((phone) => {
    const rows = [...document.querySelectorAll('#adminUsersBody tr')];
    const row = rows.find(r => r.textContent.includes(phone));
    return !!row && !row.querySelector('button');
  }, admin.phone);
  console.log('A própria linha do admin NÃO tem botão de apagar (proteção):', adminRowHasNoDeleteBtn);

  // --- Admin deletes the victim's account via the UI flow ---
  admin.page.on('dialog', d => d.accept());
  await admin.page.evaluate(({ phone, name }) => adminDeleteAccount(phone, name), { phone: victim.phone, name: 'Vitima Esqueceu Senha' });
  await admin.page.waitForTimeout(500);
  const victimGoneFromTable = await admin.page.evaluate((phone) => !document.getElementById('adminUsersBody').textContent.includes(phone), victim.phone);
  console.log('A conta da vítima desaparece da tabela depois de apagada:', victimGoneFromTable);

  // --- Old credentials no longer work; the phone/username are free again ---
  const oldLoginRes = await admin.page.evaluate(async (phone) => {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: 'senha1234forte', deviceId: 'x', deviceName: 'x' }) });
    return { status: r.status };
  }, victim.phone);
  console.log('As credenciais antigas da vítima deixam de funcionar:', oldLoginRes.status === 401);

  // The victim's own live session gets force-logged-out.
  await victim.page.waitForTimeout(300);
  const victimForcedOut = await victim.page.evaluate(() => document.getElementById('loginScreen').classList.contains('hidden') === false);
  console.log('A sessão da vítima é encerrada em tempo real quando o admin apaga a conta:', victimForcedOut);

  // --- Admin cannot delete their own account through this endpoint ---
  const selfDeleteRes = await admin.page.evaluate(async (phone) => {
    const r = await fetch('/api/admin/delete-account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token }, body: JSON.stringify({ phone }) });
    return { status: r.status, body: await r.json() };
  }, admin.phone);
  console.log('O admin não consegue apagar a própria conta por este endpoint:', selfDeleteRes.status === 400);

  // --- Deleting a nonexistent phone gives a clear error, not a crash ---
  const nonexistentRes = await admin.page.evaluate(async () => {
    const r = await fetch('/api/admin/delete-account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token }, body: JSON.stringify({ phone: '+351000000000' }) });
    return { status: r.status, body: await r.json() };
  });
  console.log('Apagar um telefone que não existe dá um erro claro (404):', nonexistentRes.status === 404);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
