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

// Reproduz uma versão do clássico "xeque-mate do pastor" (scholar's mate) —
// mas como este xadrez simplificado não deteta xeque/xeque-mate (ver
// server.js), o jogo só termina quando o rei é mesmo CAPTURADO, não só
// ameaçado. Por isso a sequência continua um pouco mais do que o mate real,
// até a dama capturar o rei a sério. Índices: linha*8+coluna, linha 0 = topo
// (peças de X/brancas), linha 7 = pretas — ver initChessBoard().
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  const a = await register(ctxA, 'Xadrez A', 'chess_a_');
  const b = await register(ctxB, 'Xadrez B', 'chess_b_');

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
  await a.page.click('button:has-text("Xadrez")');
  await a.page.waitForTimeout(400);

  const pieceCount = await a.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game)?.game.board.filter(Boolean).length);
  console.log('Tabuleiro inicial tem as 32 peças (16 de cada lado):', pieceCount === 32);

  await b.page.waitForSelector('.chat-item:has-text("Xadrez A")', { timeout: 8000 });
  await b.page.click('.chat-item:has-text("Xadrez A")');
  await b.page.waitForTimeout(500);

  async function clickCell(page, index) {
    await page.click(`#chatMessages div[data-cell="${index}"]`);
    await page.waitForTimeout(200);
  }
  async function move(page, from, to) { await clickCell(page, from); await clickCell(page, to); }
  async function currentGame(page) { return page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game)?.game); }

  // 1. B tenta um movimento ilegal de peão para o lado (sem captura) fora da sua vez — nem sequer é a vez de B ainda, mas o clique é ignorado de qualquer forma (sem peça própria selecionável). Confirma primeiro que só quem tem a vez consegue jogar.
  await move(b.page, 52, 53); // peão preto e7 -> f7 (lado), tentado antes da vez de B
  let game = await currentGame(a.page);
  console.log('B não consegue jogar fora da sua vez (o peão continua em 52):', game.board[52] !== null && game.turn === 'X');

  // 2. A: peão e2-e4 (movimento inicial de 2 casas).
  await move(a.page, 12, 28);
  game = await currentGame(b.page);
  console.log('Peão anda 2 casas na jogada de abertura (e2-e4) e passa a vez:', game.board[12] === null && game.board[28] !== null && game.turn === 'O');

  // 3. B tenta um movimento de peão lateral ilegal (52->53) — 53 já tem o
  // próprio peão f7 de B (não está vazia); a jogada devia ser recusada e as
  // duas casas devem continuar exatamente como estavam antes da tentativa.
  await move(b.page, 52, 53);
  game = await currentGame(b.page);
  console.log('Movimento lateral de peão (ilegal) é recusado:', game.board[52]?.owner === 1 && game.board[53]?.owner === 1 && game.turn === 'O');

  // 4. B: peão e7-e5 (resposta simétrica).
  await move(b.page, 52, 36);
  // 5. A: bispo f1-c4 (diagonal, caminho livre depois do peão ter saído da frente).
  await move(a.page, 5, 26);
  game = await currentGame(b.page);
  console.log('Bispo anda em diagonal com o caminho livre (f1-c4):', game.board[5] === null && game.board[26]?.type === 'b');

  // 6. B: cavalo b8-c6.
  await move(b.page, 57, 42);
  // 7. A: dama d1-h5 (diagonal longa, caminho livre).
  await move(a.page, 3, 39);
  game = await currentGame(b.page);
  console.log('Dama anda em diagonal longa com o caminho livre (d1-h5):', game.board[3] === null && game.board[39]?.type === 'q');

  // 8. B: cavalo g8-f6.
  await move(b.page, 62, 45);
  // 9. A: dama captura o peão f7 (Qxf7) — não é o rei, o jogo continua.
  await move(a.page, 39, 53);
  game = await currentGame(a.page);
  console.log('Dama captura o peão f7 (peça capturada, jogo continua sem vencedor):', game.board[53]?.type === 'q' && game.winner === null);

  // 10. B: torre a8-b8 (jogada qualquer, não defende o rei).
  await move(b.page, 56, 57);
  // 11. A: dama captura o rei em e8 (Qxe8) — fim do jogo simplificado (sem xeque-mate, ganha-se ao capturar o rei mesmo).
  await move(a.page, 53, 60);
  game = await currentGame(a.page);
  console.log('Dama captura o rei preto — o jogo termina com X a vencer:', game.board[60]?.type === 'q' && game.winner === 'X');
  const boardHtmlA = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('A vê a mensagem de vitória:', boardHtmlA.includes('Ganhaste'));
  const boardHtmlB = await b.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('B vê a mensagem de derrota:', boardHtmlB.includes('ganhou'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
