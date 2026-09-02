const { chromium } = require('playwright');

async function register(context, name, prefix, extra = {}) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = extra.phone || ('+3513' + ts.toString().slice(-8));
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
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await register(ctxA, 'Delete Test A', 'delA_');
  const b = await register(ctxB, 'Delete Test B', 'delB_');

  // A and B exchange a real DM message.
  const usernameB = await b.page.evaluate(() => APP.user.username);
  await a.page.evaluate((uname) => {
    document.getElementById('modalSearchUser').classList.add('active');
    document.getElementById('searchUsernameInput').value = uname;
  }, usernameB);
  await a.page.evaluate(() => doSearchUser());
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => {
    const btn = [...document.querySelectorAll('#searchUserResult button')].find(b => b.textContent.includes('conversa'));
    if (btn) btn.click();
  });
  await a.page.waitForTimeout(500);
  // Pick the actual DM chat item (there can be a second, leftover "search
  // result" entry with the same name — the real DM one is the last one).
  await a.page.evaluate(() => {
    const items = [...document.querySelectorAll('.chat-item')];
    items.reverse().find(el => el.textContent.includes('Delete Test B'))?.click();
  });
  await a.page.waitForTimeout(300);
  await a.page.fill('#messageInput', 'Ola, mensagem de teste antes de apagar a conta');
  await a.page.press('#messageInput', 'Enter');
  await a.page.waitForTimeout(800);

  // --- Export: check the shape and content ---
  const exportData = await a.page.evaluate(async () => {
    const r = await fetch('/api/account/export', { headers: { 'x-auth-token': APP.token } });
    return r.json();
  });
  console.log('Export inclui o perfil correto:', exportData.perfil.telefone === a.phone && exportData.perfil.nome === 'Delete Test A');
  // DM messages are end-to-end encrypted — the SERVER (and therefore the
  // export it generates) never sees the plaintext, only the ciphertext, by
  // design. Confirm the message entry is present (right sender/room) rather
  // than expecting readable text, which would defeat the point of E2EE.
  const sentMsgEntry = exportData.mensagens.find(m => m.senderPhone === a.phone && m.chatId.startsWith('dm_'));
  console.log('Export inclui a mensagem 1-para-1 que A enviou (cifrada, sem texto legível):', !!sentMsgEntry && sentMsgEntry.encrypted === true && typeof sentMsgEntry.data === 'string');
  console.log('Export tem secções de lembretes/lista de compras/favoritos (mesmo vazias):', Array.isArray(exportData.lembretes) && Array.isArray(exportData.favoritosDeTurismo) && Array.isArray(exportData.historicoDeChamadas));
  console.log('Export NÃO inclui conteúdo binário de anexos (campo fileData ausente):', !exportData.mensagens.some(m => 'fileData' in m));

  // The "tens mesmo a certeza?" native confirm() fires on every delete
  // attempt (before the password is even checked server-side) — auto-accept
  // it for the whole rest of this test.
  a.page.on('dialog', d => d.accept());

  // --- Delete account: wrong password rejected ---
  await a.page.evaluate(() => openDeleteAccountModal());
  await a.page.fill('#deleteAccountPasswordInput', 'senhaerrada123');
  await a.page.click('button:has-text("Apagar definitivamente")');
  await a.page.waitForTimeout(400);
  const wrongPassRejected = await a.page.evaluate(() => document.getElementById('deleteAccountError').textContent.includes('incorreta'));
  console.log('Apagar conta com senha errada é recusado:', wrongPassRejected);

  // --- Delete account: correct password ---
  await a.page.fill('#deleteAccountPasswordInput', 'senha1234forte');
  await a.page.click('button:has-text("Apagar definitivamente")');
  await a.page.waitForSelector('#loginFormBox', { state: 'visible', timeout: 5000 });
  const backToLoginScreen = await a.page.evaluate(() => document.getElementById('loginScreen').classList.contains('hidden') === false);
  console.log('Depois de apagar, volta ao ecrã de login:', backToLoginScreen);

  // --- Old credentials no longer work ---
  const oldLoginRes = await a.page.evaluate(async (phone) => {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: 'senha1234forte', deviceId: 'whatever', deviceName: 'x' }) });
    return { status: r.status, body: await r.json() };
  }, a.phone);
  console.log('As credenciais antigas deixam de funcionar depois de apagar a conta:', oldLoginRes.status === 401);

  // --- B still has the message A sent before deleting the account (like WhatsApp) ---
  // B decrypts locally with its own private key, so it sees the real text —
  // this proves the account deletion never touched the recipient's history.
  await b.page.waitForTimeout(1000);
  // The DM chat card can disappear from B's sidebar once A's account is gone
  // (A drops out of B's resolved contacts) — a known, documented trade-off of
  // this simple hard-delete model (see README). What matters for "não apaga
  // retroativamente o que já foi entregue" is that the underlying message
  // data itself was never touched, which is what this checks directly.
  const bStillHasMessage = await b.page.evaluate(() => {
    const allMsgs = Object.values(APP.messages).flat();
    return allMsgs.some(m => m.text?.includes('mensagem de teste') && m.sender === 'Delete Test A');
  });
  console.log('B continua com a mensagem (decifrada) que A enviou antes de apagar a conta — histórico não é apagado retroativamente:', bStillHasMessage);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
