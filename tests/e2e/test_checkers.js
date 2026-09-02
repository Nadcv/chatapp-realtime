const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3516' + ts.toString().slice(-8);
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

  const a = await register(ctxA, 'Damas A', 'damas_a_');
  const b = await register(ctxB, 'Damas B', 'damas_b_');

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

  await a.page.click('#gamesBtn');
  await a.page.waitForSelector('#modalGameChooser.active');
  await a.page.click('button:has-text("Damas")');
  await a.page.waitForTimeout(400);

  // Conta só as células do tabuleiro (data-cell), não a legenda por baixo —
  // essa também tem um 🔴 e um ⚪ de exemplo, que inflacionava a contagem.
  const pieceCounts = await a.page.evaluate(() => {
    const cells = [...document.querySelectorAll('#chatMessages [data-cell]')];
    return {
      red: cells.filter(c => c.textContent.includes('🔴') && !c.textContent.includes('👑')).length,
      white: cells.filter(c => c.textContent.includes('⚪') && !c.textContent.includes('👑')).length
    };
  });
  const boardHtmlA = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('Initial setup: 12 red pieces:', pieceCounts.red === 12);
  console.log('Initial setup: 12 white pieces:', pieceCounts.white === 12);
  console.log('A (creator) sees "A tua vez":', boardHtmlA.includes('A tua vez'));

  await b.page.waitForSelector('.chat-item:has-text("Damas A")', { timeout: 8000 });
  await b.page.click('.chat-item:has-text("Damas A")');
  await b.page.waitForTimeout(500);
  const boardHtmlB = await b.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('Board visible on B via room_history (64 cells):', (boardHtmlB.match(/data-cell="/g) || []).length === 64);
  console.log('B sees "Vez de Damas A" (not their turn):', boardHtmlB.includes('Vez de'));

  // Standard checkers indices: row*8+col, row0 at top. Red (owner 0) starts rows 0-2,
  // white (owner 1) rows 5-7. Red moves toward increasing rows.
  // A red piece at row2,col1 (index 17) can move to row3,col2 (index 26, empty) — a normal forward move.
  async function clickCell(page, index) {
    await page.click(`#chatMessages div[data-cell="${index}"]`);
    await page.waitForTimeout(200);
  }

  // A selects piece at 17 (row2,col1), then moves to 26 (row3,col2).
  await clickCell(a.page, 17);
  await clickCell(a.page, 26);
  await a.page.waitForTimeout(300);
  const afterMoveA = await a.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game).game);
  console.log('Piece moved from 17 to 26:', afterMoveA.board[17] === null && afterMoveA.board[26] !== null);
  console.log('Turn passed to O after A\'s move:', afterMoveA.turn === 'O');

  // B tries to move onto a square occupied by its own piece — must be rejected.
  // White piece at row5,col2 (index 42) -> row6,col1 (index 49), which already
  // holds another white piece at game start.
  await clickCell(b.page, 42);
  await clickCell(b.page, 49);
  await b.page.waitForTimeout(300);
  const afterInvalidB = await b.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game).game);
  console.log('Move onto an occupied square rejected (piece still at 42):', afterInvalidB.board[42] !== null);
  console.log('Turn still O after invalid move (rejected silently):', afterInvalidB.turn === 'O');

  // B makes a valid forward move: white at row5,col4 (index 44) -> row4,col3 (index 35, empty).
  await clickCell(b.page, 44);
  await clickCell(b.page, 35);
  await a.page.waitForTimeout(300);
  const afterValidB = await a.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game).game);
  console.log('Valid white move applied, seen on A side:', afterValidB.board[44] === null && afterValidB.board[35] !== null);
  console.log('Turn back to X after valid O move:', afterValidB.turn === 'X');

  // Now it's A's (red's) turn again. Try an invalid BACKWARD move for a normal
  // (non-king) piece into a genuinely empty square: red at 26 (row3,col2) back
  // to 17 (row2,col1), which A vacated earlier — empty, but wrong direction.
  await clickCell(a.page, 26);
  await clickCell(a.page, 17);
  await a.page.waitForTimeout(300);
  const afterBackward = await a.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game).game);
  console.log('Backward move into an empty square rejected (piece still at 26):', afterBackward.board[26] !== null);
  console.log('Empty square 17 stays empty (move truly rejected, not applied):', afterBackward.board[17] === null);
  console.log('Turn still X (backward move did not consume the turn):', afterBackward.turn === 'X');

  // Now test a valid capture: A's piece at 26 (row3,col2, red) jumps over B's
  // piece at 35 (row4,col3), landing at row5,col4 = index 44 (empty, since B
  // moved that piece away earlier). dr=+2,dc=+2 — valid diagonal jump forward for red.
  await clickCell(a.page, 26);
  await clickCell(a.page, 44);
  await a.page.waitForTimeout(300);
  const afterCapture = await a.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game).game);
  console.log('Capture move: red landed at 44:', afterCapture.board[44] !== null && afterCapture.board[44].owner === 0);
  console.log('Capture move: jumped white piece at 35 removed:', afterCapture.board[35] === null);
  console.log('Origin 26 now empty after capture:', afterCapture.board[26] === null);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
