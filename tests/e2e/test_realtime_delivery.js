const { chromium } = require('playwright');

async function registerUser(browser, label) {
  const page = await browser.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION (${label}):`, err.message));
  page.on('console', m => { if (m.type() === 'error') console.log(`CONSOLE ERROR (${label}):`, m.text()); });
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  await page.fill('#regName', label);
  await page.fill('#regUsername', 'rt_' + label.toLowerCase() + '_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'rt_' + label.toLowerCase() + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const phone = await page.evaluate(() => APP.user.phone);
  const username = await page.evaluate(() => APP.user.username);
  return { page, phone, username };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const alice = await registerUser(browser, 'Alice');
  const bob = await registerUser(browser, 'Bob');

  // Alice finds Bob via the real "pesquisar utilizador" UI flow (not a raw socket.emit shortcut)
  // and starts a conversation exactly as a real user would.
  await alice.page.click('button:has-text("🔍 Pesquisar utilizador")').catch(async () => {
    // botão pode ter outro texto/seletor — tenta abrir o modal diretamente
    await alice.page.evaluate(() => openSearchUserModal());
  });
  await alice.page.waitForSelector('#modalSearchUser.active', { timeout: 3000 }).catch(() => {});
  await alice.page.fill('#searchUsernameInput', bob.username);
  await alice.page.click('button:has-text("Procurar")').catch(() => alice.page.evaluate(() => doSearchUser()));
  await alice.page.waitForTimeout(500);
  const foundBob = await alice.page.evaluate(() => document.getElementById('searchUserResult').innerText.includes('Iniciar conversa'));
  console.log('Alice finds Bob via real user search:', foundBob);
  await alice.page.click('button:has-text("Iniciar conversa")');
  await alice.page.waitForTimeout(800); // espera contacts_update + rebuildChatsFromServer + join_room

  // Bob does the same to have Alice in his own contact list (mirrors what any real user would do next).
  await bob.page.evaluate(() => openSearchUserModal());
  await bob.page.fill('#searchUsernameInput', alice.username);
  await bob.page.evaluate(() => doSearchUser());
  await bob.page.waitForTimeout(500);
  await bob.page.click('button:has-text("Iniciar conversa")');
  await bob.page.waitForTimeout(800);

  const aliceHasBobJoined = await alice.page.evaluate((bobPhone) => {
    const chat = APP.chats.find(c => c.phone === bobPhone);
    return { found: !!chat, joined: chat ? APP.joinedRooms.has(chat.id) : false, chatId: chat?.id };
  }, bob.phone);
  console.log('Alice has Bob as a real chat entry:', aliceHasBobJoined.found);
  console.log('Alice\'s client believes it joined the room (APP.joinedRooms):', aliceHasBobJoined.joined);

  const bobHasAliceJoined = await bob.page.evaluate((alicePhone) => {
    const chat = APP.chats.find(c => c.phone === alicePhone);
    return { found: !!chat, joined: chat ? APP.joinedRooms.has(chat.id) : false, chatId: chat?.id };
  }, alice.phone);
  console.log('Bob has Alice as a real chat entry:', bobHasAliceJoined.found);
  console.log('Bob\'s client believes it joined the room (APP.joinedRooms):', bobHasAliceJoined.joined);

  // Open both chats (as a real user would before chatting).
  await alice.page.click('.chat-item:has-text("Bob")');
  await alice.page.waitForTimeout(300);
  await bob.page.click('.chat-item:has-text("Alice")');
  await bob.page.waitForTimeout(300);

  // THE KEY TEST: Alice sends a message. Does Bob's page receive it live (WITHOUT reload/re-click)?
  await alice.page.fill('#messageInput', 'MENSAGEM_TESTE_TEMPO_REAL');
  await alice.page.press('#messageInput', 'Enter');

  // Wait up to 5s polling for live delivery, WITHOUT reloading or re-clicking the chat.
  let liveDelivered = false;
  for (let i = 0; i < 25; i++) {
    liveDelivered = await bob.page.evaluate(() => document.getElementById('chatMessages')?.innerText.includes('MENSAGEM_TESTE_TEMPO_REAL'));
    if (liveDelivered) break;
    await bob.page.waitForTimeout(200);
  }
  console.log('Bob receives the message LIVE, without any reload/reopen:', liveDelivered);

  if (!liveDelivered) {
    // Diagnostics: did the server even accept join_room for this DM chat?
    const aliceChatId = aliceHasBobJoined.chatId;
    console.log('--- DIAGNOSTICS ---');
    console.log('Alice chatId used:', aliceChatId, '| Bob chatId used:', bobHasAliceJoined.chatId, '| match:', aliceChatId === bobHasAliceJoined.chatId);
    const bobMsgs = await bob.page.evaluate((chatId) => (APP.messages[chatId] || []), aliceChatId);
    console.log('Bob\'s in-memory messages for that chat (without reload):', JSON.stringify(bobMsgs, null, 2));
    console.log('Bob\'s currentChatId:', await bob.page.evaluate(() => APP.currentChatId), '| expected:', aliceChatId);
    console.log('chatMessages full innerText:', await bob.page.evaluate(() => document.getElementById('chatMessages')?.innerText));
  }

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
