const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 10000);
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
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();

  const a = await register(ctxA, 'Checkers A', 'chka_');
  const b = await register(ctxB, 'Checkers B', 'chkb_');
  const c = await register(ctxC, 'Checkers Spectator', 'chkc_');

  // A creates a group.
  const groupName = 'Grupo Damas ' + Date.now();
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  await a.page.fill('#groupName', groupName);
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await a.page.waitForTimeout(600);

  // B and C also see the group (open groups, visible to everyone).
  await b.page.waitForTimeout(300);
  await c.page.waitForTimeout(300);

  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);
  await b.page.click(`.chat-item:has-text("${groupName}")`);
  await b.page.waitForTimeout(300);
  await c.page.click(`.chat-item:has-text("${groupName}")`);
  await c.page.waitForTimeout(300);

  // A must first have B as a contact (via a search) for the opponent picker to list B.
  await a.page.evaluate((phoneB) => {
    APP.chats.push({ id: 'dm_placeholder', type: 'user', phone: phoneB, name: 'Checkers B', online: true });
  }, b.phone);
  // Actually use the real add_contact flow via username search to be realistic.
  await a.page.evaluate(() => { APP.chats = APP.chats.filter(c => c.id !== 'dm_placeholder'); });
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

  // Open game chooser from within the group and verify checkers/tic-tac-toe are visible (not hidden).
  await a.page.evaluate(() => {
    const chat = APP.chats.find(c => c.name === document.querySelector('.chat-item.active h4')?.textContent) || APP.chats.find(c => c.type === 'group');
    APP.currentChatId = chat.id;
    openGameChooserModal();
  });
  await a.page.waitForSelector('#modalGameChooser.active', { timeout: 3000 });
  const checkersVisible = await a.page.evaluate(() => document.getElementById('gameChooserCheckersBtn').style.display !== 'none');
  const tictactoeVisible = await a.page.evaluate(() => document.getElementById('gameChooserTicTacToeBtn').style.display !== 'none');
  console.log('Checkers button is visible in a group game chooser:', checkersVisible);
  console.log('Tic-tac-toe button is visible in a group game chooser:', tictactoeVisible);

  // Start checkers -> should open the opponent picker (group flow), not start directly.
  await a.page.evaluate(() => startCheckers());
  await a.page.waitForSelector('#modalOpponentPicker.active', { timeout: 3000 });
  const pickerListsB = await a.page.evaluate(() => document.getElementById('opponentPickerList').textContent.includes('Checkers B'));
  console.log('Opponent picker lists B as a contact to challenge:', pickerListsB);

  // Confirm starting the game with B as opponent.
  await a.page.evaluate((phoneB) => confirmStartGameWithOpponent(phoneB), b.phone);
  await a.page.waitForTimeout(600);
  const modalClosedAfterStart = await a.page.evaluate(() => !document.getElementById('modalOpponentPicker').classList.contains('active'));
  console.log('Opponent picker closes after starting the game:', modalClosedAfterStart);

  const aMsgs = await a.page.evaluate(() => {
    const chat = APP.chats.find(c => c.type === 'group');
    return APP.messages[chat.id];
  });
  const gameMsg = aMsgs.find(m => m.game?.type === 'checkers');
  console.log('A checkers game message was created in the group:', !!gameMsg);
  console.log('Game players are A and B (not the whole group):', gameMsg && gameMsg.game.players.includes(a.phone) && gameMsg.game.players.includes(b.phone) && gameMsg.game.players.length === 2);

  const groupChatId = (await a.page.evaluate(() => APP.chats.find(c => c.type === 'group').id));

  // B should receive the game via room_history/receive_message.
  await b.page.waitForTimeout(500);
  const bHasGame = await b.page.evaluate((chatId) => (APP.messages[chatId] || []).some(m => m.game?.type === 'checkers'), groupChatId);
  console.log('B receives the checkers game message in the group:', bHasGame);

  // C (spectator, not a player) should also see the message but with a "só a ver" status and no clickable cells.
  await c.page.waitForTimeout(500);
  await c.page.evaluate((chatId) => { APP.currentChatId = chatId; renderMessages(); }, groupChatId);
  await c.page.waitForTimeout(300);
  const cSeesSpectatorStatus = await c.page.evaluate(() => document.getElementById('chatMessages').innerHTML.includes('só a ver'));
  console.log('Spectator (C) sees "só a ver" status on the shared game:', cSeesSpectatorStatus);
  const cHasNoClickableCells = await c.page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-cell]')];
    return cells.length > 0 && cells.every(el => !el.getAttribute('onclick'));
  });
  console.log('Spectator has no clickable cells (cannot move pieces):', cHasNoClickableCells);

  // A (player, X, goes first) should have clickable dark cells with their own pieces.
  await a.page.evaluate((chatId) => { APP.currentChatId = chatId; renderMessages(); }, groupChatId);
  await a.page.waitForTimeout(300);
  const aHasClickableCells = await a.page.evaluate(() => [...document.querySelectorAll('[data-cell]')].some(el => el.getAttribute('onclick')));
  console.log('Player A (first turn) has at least one clickable cell:', aHasClickableCells);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
