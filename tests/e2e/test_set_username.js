// Contas registadas antes de o nome de utilizador existir/ser obrigatório
// ficam sem username, e por isso nunca aparecem em "🔍 Procurar utilizador"
// (pesquisa exata por @username, ver server.js socket 'search_user') — foi
// exatamente isto que um utilizador reportou ("não encontro outros
// utilizadores"). A correção é o novo socket 'set_username' (perfil > "🔖
// Nome de utilizador"), que deixa qualquer conta definir/mudar o seu
// username. Não há forma pública de criar uma conta SEM username (o
// registo continua a exigi-lo), por isso este teste valida o mecanismo
// mudando um username já existente para outro — o mesmo código que serve
// para "definir pela primeira vez" (só difere por um `if` a menos).
const { chromium } = require('playwright');

async function fillRegisterForm(page, { name, username, phone, email }) {
  await page.fill('#regName', name);
  await page.fill('#regUsername', username);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', email);
  await page.fill('#regPassword', 'senha1234forte');
}

async function searchUser(page, username) {
  await page.evaluate(() => document.getElementById('modalSearchUser').classList.add('active'));
  await page.fill('#searchUsernameInput', username);
  await page.click('button:has-text("Procurar")');
  await page.waitForTimeout(500);
  const found = await page.evaluate(() => !document.getElementById('searchUserResult').innerHTML.includes('Não foi encontrado'));
  await page.evaluate(() => document.getElementById('modalSearchUser').classList.remove('active'));
  return found;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  pageA.on('dialog', d => d.accept());
  await pageA.goto('http://localhost:3000');
  await pageA.click('.login-switch');
  const ts = Date.now();
  const oldUsername = 'oldname_' + ts;
  const newUsername = 'newname_' + ts;
  await fillRegisterForm(pageA, { name: 'Dono do Username', username: oldUsername, phone: '+3519' + ts.toString().slice(-8), email: 'donousername' + ts + '@test.com' });
  await pageA.click('button:has-text("Criar conta")');
  await pageA.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto('http://localhost:3000');
  await pageB.click('.login-switch');
  const ts2 = Date.now() + 1;
  await fillRegisterForm(pageB, { name: 'Quem Procura', username: 'procura_' + ts2, phone: '+3519' + ts2.toString().slice(-8), email: 'procura' + ts2 + '@test.com' });
  await pageB.click('button:has-text("Criar conta")');
  await pageB.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  const foundBeforeChange = await searchUser(pageB, oldUsername);
  console.log('B encontra A pelo username antigo antes de qualquer mudança:', foundBeforeChange);

  // --- A tenta um username demasiado curto: recusado, mantém o antigo. ---
  await pageA.evaluate(() => document.getElementById('modalProfile').classList.add('active'));
  await pageA.fill('#profileUsernameInput', 'ab');
  await pageA.click('button[onclick="saveProfileUsername()"]');
  await pageA.waitForTimeout(400);
  const shortRejected = await pageA.evaluate((old) => document.getElementById('profileUsernameInput').value === old, oldUsername);
  console.log('Username demasiado curto (< 3 caracteres) é recusado, mantém o antigo:', shortRejected);

  // --- A tenta o username que B já tem: recusado, mantém o antigo. ---
  await pageA.fill('#profileUsernameInput', 'procura_' + ts2);
  await pageA.click('button[onclick="saveProfileUsername()"]');
  await pageA.waitForTimeout(400);
  const duplicateRejected = await pageA.evaluate((old) => document.getElementById('profileUsernameInput').value === old, oldUsername);
  console.log('Username já usado por outra conta é recusado, mantém o antigo:', duplicateRejected);

  // --- A muda mesmo de username. ---
  await pageA.fill('#profileUsernameInput', newUsername);
  await pageA.click('button[onclick="saveProfileUsername()"]');
  await pageA.waitForTimeout(400);
  const changedOk = await pageA.evaluate((n) => document.getElementById('profileUsernameInput').value === n, newUsername);
  console.log('A muda de username com sucesso:', changedOk);

  // --- B já não encontra A pelo username antigo. ---
  const foundOldAfterChange = await searchUser(pageB, oldUsername);
  console.log('Depois da mudança, o username ANTIGO deixa de encontrar A:', !foundOldAfterChange);

  // --- B encontra A pelo username novo. ---
  const foundNewAfterChange = await searchUser(pageB, newUsername);
  console.log('Depois da mudança, o username NOVO encontra A:', foundNewAfterChange);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
