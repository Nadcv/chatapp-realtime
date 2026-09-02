const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3512' + ts.toString().slice(-8);
  const username = prefix + ts;
  await page.fill('#regName', name);
  await page.fill('#regUsername', username);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone, username };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  const a = await register(ctxA, 'Galo A', 'galo_a_');
  const b = await register(ctxB, 'Galo B', 'galo_b_');

  // Um jogo em tempo real só funciona entre contactos de verdade — o servidor
  // recusa silenciosamente a mensagem que cria o jogo se A e B não forem
  // contactos um do outro (isDmRoomAllowedForPhone em server.js). Em vez de
  // fabricar a conversa só do lado do cliente, A procura B pelo nome de
  // utilizador (fluxo real de "Procurar utilizador"), que trata o add_contact
  // dos dois lados e abre a conversa automaticamente.
  await a.page.click('button[title="Grupos, chamadas e contactos"]');
  await a.page.click('#modalContactsFeatures button[onclick*="openSearchUserModal"]');
  await a.page.waitForSelector('#modalSearchUser.active');
  await a.page.fill('#searchUsernameInput', b.username);
  await a.page.click('button:has-text("Procurar")');
  await a.page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await a.page.click('#searchUserResult button:has-text("Iniciar conversa")');
  await a.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });
  await a.page.waitForTimeout(300);
  const gameBtnVisible = await a.page.locator('#gamesBtn').evaluate(el => getComputedStyle(el).display !== 'none');
  console.log('Game button visible in a 1-to-1 chat:', gameBtnVisible);

  await a.page.click('#gamesBtn');
  await a.page.waitForSelector('#modalGameChooser.active');
  await a.page.click('#gameChooserTicTacToeBtn');
  await a.page.waitForTimeout(400);

  const boardHtmlA = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('Board rendered on A (9 cells):', (boardHtmlA.match(/data-cell="/g) || []).length === 9);
  console.log('A sees "A tua vez" (X starts, A created it):', boardHtmlA.includes('A tua vez'));

  await b.page.waitForSelector('.chat-item:has-text("Galo A")', { timeout: 8000 });
  await b.page.click('.chat-item:has-text("Galo A")');
  await b.page.waitForTimeout(500);
  const boardHtmlB = await b.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('Board visible on B via room_history (9 cells with data-cell):', (boardHtmlB.match(/data-cell="/g) || []).length === 9);
  console.log('B sees "Vez de Galo A" (not their turn yet):', boardHtmlB.includes('Vez de'));

  // B tries to move out-of-turn — should be silently rejected by the server (no cell is clickable for B yet).
  const clickableCellsB = await b.page.locator('#chatMessages div[onclick^="moveGame"]').count();
  console.log('B has 0 clickable cells (not their turn):', clickableCellsB === 0);

  // A (X) plays a winning diagonal: 0, 4, 8. B (O) plays 1, 2 in between (non-blocking).
  async function clickCell(page, boardIndex) {
    await page.click(`#chatMessages div[data-cell="${boardIndex}"]`);
  }

  await clickCell(a.page, 0); // X at 0
  await a.page.waitForTimeout(300);
  await clickCell(b.page, 1); // O at 1
  await a.page.waitForTimeout(300);
  await clickCell(a.page, 4); // X at 4
  await a.page.waitForTimeout(300);
  await clickCell(b.page, 2); // O at 2
  await a.page.waitForTimeout(300);
  await clickCell(a.page, 8); // X at 8 -> wins diagonal 0-4-8
  await a.page.waitForTimeout(400);

  const finalA = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  const finalB = await b.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('A (winner) sees "Ganhaste!":', finalA.includes('Ganhaste'));
  console.log('B (loser) sees "Galo A ganhou!":', finalB.includes('ganhou'));
  console.log('No more clickable cells after game over (A):', (await a.page.locator('#chatMessages div[onclick^="moveGame"]').count()) === 0);
  console.log('No more clickable cells after game over (B):', (await b.page.locator('#chatMessages div[onclick^="moveGame"]').count()) === 0);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
