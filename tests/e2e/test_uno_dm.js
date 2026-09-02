const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3519' + ts.toString().slice(-8);
  await page.fill('#regName', name);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await register(ctxA, 'Uno A', 'uno_a_');
  const b = await register(ctxB, 'Uno B', 'uno_b_');
  a.page.on('pageerror', err => console.log('A PAGE EXCEPTION:', err.message));
  b.page.on('pageerror', err => console.log('B PAGE EXCEPTION:', err.message));

  await a.page.evaluate((bPhone) => {
    const chatId = dmRoomId(APP.user.phone, bPhone);
    APP.chats.push({ id: chatId, name: 'Uno B', phone: bPhone, type: 'user' });
    renderChatList();
  }, b.phone);
  await b.page.evaluate((aPhone) => {
    const chatId = dmRoomId(aPhone, APP.user.phone);
    APP.chats.push({ id: chatId, name: 'Uno A', phone: aPhone, type: 'user' });
    renderChatList();
  }, a.phone);

  await a.page.click('.chat-item:has-text("Uno B")');
  await a.page.waitForTimeout(300);
  await a.page.click('#gamesBtn');
  await a.page.waitForSelector('#modalGameChooser.active');
  await a.page.click('button:has-text("UNO")');
  await a.page.waitForTimeout(500);

  const aHand = await a.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game)?.game?.myHand);
  console.log('A got own 7-card hand:', Array.isArray(aHand) && aHand.length === 7);

  await b.page.click('.chat-item:has-text("Uno A")');
  await b.page.waitForTimeout(500);
  const bGame = await b.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game)?.game);
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
