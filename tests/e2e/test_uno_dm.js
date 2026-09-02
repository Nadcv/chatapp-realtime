const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3519' + ts.toString().slice(-8);
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
  const a = await register(ctxA, 'Uno A', 'uno_a_');
  const b = await register(ctxB, 'Uno B', 'uno_b_');
  a.page.on('pageerror', err => console.log('A PAGE EXCEPTION:', err.message));
  b.page.on('pageerror', err => console.log('B PAGE EXCEPTION:', err.message));

  // Um jogo em tempo real só funciona entre contactos de verdade — o servidor
  // recusa entrar na sala (join_room) e recusa a mensagem que cria o jogo se
  // A e B não forem contactos um do outro (isDmRoomAllowedForPhone em
  // server.js). Em vez de fabricar a conversa só do lado do cliente, A
  // procura B pelo nome de utilizador (fluxo real de "Procurar utilizador"),
  // que trata o add_contact dos dois lados e abre a conversa automaticamente.
  await a.page.click('button[title="Grupos, chamadas e contactos"]');
  await a.page.click('#modalContactsFeatures button[onclick*="openSearchUserModal"]');
  await a.page.waitForSelector('#modalSearchUser.active');
  await a.page.fill('#searchUsernameInput', b.username);
  await a.page.click('button:has-text("Procurar")');
  await a.page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await a.page.click('#searchUserResult button:has-text("Iniciar conversa")');
  await a.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });
  await a.page.waitForTimeout(300);

  // O UNO cria o jogo por um caminho próprio no servidor (start_uno), que ao
  // contrário do send_message não junta A e B automaticamente como
  // contactos um do outro — por isso B também tem de procurar A e abrir a
  // conversa (o que faz o socket de B entrar mesmo na sala) antes de A
  // começar o jogo, senão a mensagem nunca chega a B.
  await b.page.click('button[title="Grupos, chamadas e contactos"]');
  await b.page.click('#modalContactsFeatures button[onclick*="openSearchUserModal"]');
  await b.page.waitForSelector('#modalSearchUser.active');
  await b.page.fill('#searchUsernameInput', a.username);
  await b.page.click('button:has-text("Procurar")');
  await b.page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await b.page.click('#searchUserResult button:has-text("Iniciar conversa")');
  await b.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });
  await b.page.waitForTimeout(300);

  await a.page.click('#gamesBtn');
  await a.page.waitForSelector('#modalGameChooser.active');
  await a.page.click('button:has-text("UNO")');
  await a.page.waitForTimeout(500);

  const aHand = await a.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game)?.game?.myHand);
  console.log('A got own 7-card hand:', Array.isArray(aHand) && aHand.length === 7);

  // B já estava na sala quando A começou o jogo, por isso vê-o ao vivo, sem
  // precisar de reabrir a conversa.
  const bGame = await b.page.evaluate(() => APP.messages[APP.currentChatId]?.find(m => m.game)?.game);
  console.log('B sees the game with own hand:', Array.isArray(bGame?.myHand) && bGame.myHand.length === 7);
  console.log('B CANNOT see A hand (privacy):', bGame && !('hands' in bGame));
  console.log('B sees handCounts (public info):', bGame?.handCounts && Object.keys(bGame.handCounts).length === 2);

  // Try to play a card as A (whoever's turn it is). Force turn to A for determinism.
  const messageId = await a.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game)?.id);

  // Play through several turns automatically until someone wins or we hit a safety cap,
  // always drawing when no playable card exists.
  let winner = null;
  for (let round = 0; round < 60 && !winner; round++) {
    const state = await a.page.evaluate((mid) => {
      const msg = APP.messages[APP.currentChatId]?.find(m => m.id === mid);
      return msg ? { turnIndex: msg.game.turnIndex, players: msg.game.players, winner: msg.game.winner } : null;
    }, messageId);
    if (!state) break;
    if (state.winner) { winner = state.winner; break; }
    const activePage = state.players[state.turnIndex] === a.phone ? a.page : b.page;
    const played = await activePage.evaluate((mid) => {
      const msg = APP.messages[APP.currentChatId]?.find(m => m.id === mid);
      if (!msg?.game?.myHand) return false;
      const idx = msg.game.myHand.findIndex(c => c.color === 'wild' ? false : (c.color === msg.game.currentColor || c.value === msg.game.discardTop.value));
      if (idx === -1) {
        socket.emit('draw_uno_card', { chatId: APP.currentChatId, messageId: mid });
        return 'drew';
      }
      socket.emit('play_uno_card', { chatId: APP.currentChatId, messageId: mid, cardIndex: idx });
      return 'played';
    }, messageId);
    await a.page.waitForTimeout(150);
    await b.page.waitForTimeout(150);
  }

  const finalGame = await a.page.evaluate((mid) => APP.messages[APP.currentChatId]?.find(m => m.id === mid)?.game, messageId);
  console.log('Game progressed (turnIndex or winner changed from start):', finalGame && (finalGame.winner || finalGame.discardCount > 1));
  console.log('Final discard count > 1 (moves happened):', finalGame?.discardCount > 1);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
