const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) console.log(name, 'NAVIGATED TO:', frame.url()); });
  page.on('crash', () => console.log(name, 'PAGE CRASHED'));
  page.on('close', () => console.log(name, 'PAGE CLOSED'));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  const phone = '+3516' + ts.toString().slice(-8);
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
  const a = await register(await browser.newContext(), 'Grp A', 'grp_a_');
  const b = await register(await browser.newContext(), 'Grp B', 'grp_b_');
  const c = await register(await browser.newContext(), 'Grp C', 'grp_c_');
  const d = await register(await browser.newContext(), 'Grp D', 'grp_d_'); // spectator, not a player
  [a, b, c, d].forEach(p => p.page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message)));
  console.log('phones:', a.phone, b.phone, c.phone, d.phone);

  const ts = Date.now();
  const groupName = 'Grupo UNO ' + ts;
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  console.log('modalContactsFeatures active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  console.log('modalCreateGroup active');
  await a.page.fill('#groupName', groupName);
  const filledValue = await a.page.inputValue('#groupName');
  console.log('groupName input value:', JSON.stringify(filledValue));
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await a.page.waitForTimeout(1000);
  const aGroupsListNow = await a.page.evaluate(() => (typeof APP !== "undefined" ? APP.groupsList?.map(g => g.name) : 'NO APP'));
  console.log('A groupsList right after clicking Criar Grupo:', JSON.stringify(aGroupsListNow));

  // Groups broadcast to everyone (io.emit('groups_update', ...)) — give all
  // four clients time to receive it and add it to their own chat list.
  // O ficheiro JSON local de mensagens/grupos acumulou muitos dados ao longo
  // de toda a sessão de testes (sem Mongo ligado, cada saveMessagesLocal()
  // regrava tudo) — por isso um timeout curto ficou instável aqui; 15s dá
  // margem de sobra sem mascarar uma falha real.
  for (const [label, p] of [['A', a], ['B', b], ['C', c], ['D', d]]) {
    await p.page.waitForFunction((name) => typeof APP !== "undefined" && APP.chats.some(ch => ch.name === name), groupName, { timeout: 15000 });
    console.log(label, 'sees the group');
  }

  // A needs B and C as contacts so they show up in the UNO group-player picker.
  await a.page.evaluate(({ bPhone, cPhone }) => {
    APP.chats.push({ id: dmRoomId(APP.user.phone, bPhone), name: 'Grp B', phone: bPhone, type: 'user' });
    APP.chats.push({ id: dmRoomId(APP.user.phone, cPhone), name: 'Grp C', phone: cPhone, type: 'user' });
  }, { bPhone: b.phone, cPhone: c.phone });

  for (const p of [a, b, c, d]) {
    await p.page.click(`.chat-item:has-text("${groupName}")`);
    await p.page.waitForTimeout(200);
  }

  await a.page.click('#gamesBtn');
  await a.page.waitForSelector('#modalGameChooser.active');
  // Jogo do Galo passou a suportar grupos também (escolhe-se o adversário,
  // tal como já acontecia com as Damas) — deixou de fazer sentido escondê-lo.
  const ticTacToeVisible = await a.page.evaluate(() => document.getElementById('gameChooserTicTacToeBtn').style.display !== 'none');
  console.log('Jogo do Galo continua visível num grupo (agora escolhe-se o adversário):', ticTacToeVisible);
  await a.page.click('button:has-text("UNO")');
  await a.page.waitForSelector('#modalUnoGroupPicker.active');
  await a.page.check(`#unoGroupMemberPicker input[value="${b.phone}"]`);
  await a.page.check(`#unoGroupMemberPicker input[value="${c.phone}"]`);
  await a.page.click('button:has-text("Começar jogo")');
  await a.page.waitForTimeout(700);

  const messageId = await a.page.evaluate(() => APP.messages[APP.currentChatId]?.find(m => m.game)?.id);
  console.log('Group UNO game created:', !!messageId);

  const aHand = await a.page.evaluate((mid) => APP.messages[APP.currentChatId]?.find(m => m.id === mid)?.game?.myHand, messageId);
  const bHand = await b.page.evaluate((mid) => APP.messages[APP.currentChatId]?.find(m => m.id === mid)?.game?.myHand, messageId);
  const cHand = await c.page.evaluate((mid) => APP.messages[APP.currentChatId]?.find(m => m.id === mid)?.game?.myHand, messageId);
  const dHand = await d.page.evaluate((mid) => APP.messages[APP.currentChatId]?.find(m => m.id === mid)?.game?.myHand, messageId);
  console.log('A(creator), B, C all have their own 7-card hand:', [aHand, bHand, cHand].every(h => Array.isArray(h) && h.length === 7));
  console.log('D (not a player, just a group spectator) has NO hand:', dHand === undefined || dHand === null);

  const playersList = await a.page.evaluate((mid) => APP.messages[APP.currentChatId]?.find(m => m.id === mid)?.game?.players, messageId);
  console.log('3 players registered:', playersList?.length === 3);

  // Force a reconnect on B mid-game and confirm B's hand comes back correctly
  // via the sanitized room_history (not empty, not someone else's hand size).
  await b.page.evaluate(() => new Promise((resolve) => {
    socket.once('connect', () => setTimeout(resolve, 700));
    socket.disconnect();
    socket.connect();
  }));
  await b.page.waitForTimeout(400);
  const bHandAfterReconnect = await b.page.evaluate((mid) => APP.messages[APP.currentChatId]?.find(m => m.id === mid)?.game?.myHand, messageId);
  console.log('B keeps own hand after reconnect (room_history sanitization):', Array.isArray(bHandAfterReconnect) && bHandAfterReconnect.length === 7);
  const bSeesNoRawHandsField = await b.page.evaluate((mid) => !('hands' in (APP.messages[APP.currentChatId]?.find(m => m.id === mid)?.game || {})), messageId);
  console.log('B never receives the raw "hands" map (privacy holds after reconnect):', bSeesNoRawHandsField);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
