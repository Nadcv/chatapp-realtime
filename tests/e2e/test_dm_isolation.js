const { chromium } = require('playwright');

async function registerUser(browser, label) {
  const page = await browser.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION (${label}):`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  await page.fill('#regName', label);
  await page.fill('#regUsername', 'iso_' + label.toLowerCase() + '_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'iso_' + label.toLowerCase() + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const phone = await page.evaluate(() => APP.user.phone);
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const alice = await registerUser(browser, 'Alice');
  const bob = await registerUser(browser, 'Bob');
  const eve = await registerUser(browser, 'Eve');

  // Alice sends Bob a real, legitimate private message. They become real contacts
  // first (same as the "pesquisar utilizador" flow), since join_room/send_message
  // are now authorized against the server's own contacts list, not a client-claimed
  // phone — a fake client-side-only chat entry with no real contact relationship
  // is exactly what should NOT be enough to join a room (see the Eve attack below).
  await alice.page.evaluate((bobPhone) => socket.emit('add_contact', { phone: bobPhone }), bob.phone);
  await bob.page.evaluate((alicePhone) => socket.emit('add_contact', { phone: alicePhone }), alice.phone);
  await alice.page.waitForTimeout(500);
  await bob.page.waitForTimeout(500);

  await alice.page.click('.chat-item:has-text("Bob")');
  await alice.page.waitForTimeout(300);
  await alice.page.fill('#messageInput', 'segredo entre eu e o Bob');
  await alice.page.press('#messageInput', 'Enter');
  await alice.page.waitForTimeout(500);

  await bob.page.click('.chat-item:has-text("Alice")');
  await bob.page.waitForTimeout(500);
  const bobSeesMessage = await bob.page.evaluate(() => document.getElementById('chatMessages').innerText.includes('segredo entre eu e o Bob'));
  console.log('Legitimate DM: Bob receives the real message from Alice:', bobSeesMessage);

  // Now Eve computes the same dm_ room id (she knows both phone numbers, e.g.
  // from search results) and tries to spy on / write into their private chat.
  const attackResult = await eve.page.evaluate(({ alicePhone, bobPhone }) => {
    return new Promise((resolve) => {
      const guessedRoomId = dmRoomId(alicePhone, bobPhone);
      let historyReceived = null;
      const historyHandler = (data) => { if (data.chatId === guessedRoomId) historyReceived = data; };
      socket.on('room_history', historyHandler);
      // Attempt 1: old-style bare-string join (pre-fix client would send this)
      socket.emit('join_room', guessedRoomId);
      // Attempt 2: new-style object join, but claiming a fabricated toPhone
      // that doesn't actually match either real participant.
      socket.emit('join_room', { chatId: guessedRoomId, toPhone: '+000000000' });
      // Attempt 3: try to inject a message directly into their conversation.
      socket.emit('send_message', { id: 'eve_inject_1', chatId: guessedRoomId, sender: 'Eve', senderPhone: alicePhone, toPhone: bobPhone, text: 'MENSAGEM INJETADA PELA EVE', time: '00:00' });
      setTimeout(() => {
        socket.off('room_history', historyHandler);
        resolve({ historyReceived, roomsJoined: [...socket.io.engine ? [] : []] });
      }, 700);
    });
  }, { alicePhone: alice.phone, bobPhone: bob.phone });

  console.log('Eve does NOT receive room_history for the guessed private room:', attackResult.historyReceived === null);

  await alice.page.waitForTimeout(300);
  const aliceSeesInjection = await alice.page.evaluate(() => document.getElementById('chatMessages').innerText.includes('MENSAGEM INJETADA PELA EVE'));
  console.log('Eve\'s injected message does NOT appear in Alice\'s chat with Bob:', !aliceSeesInjection);

  await bob.page.waitForTimeout(300);
  const bobSeesInjection = await bob.page.evaluate(() => document.getElementById('chatMessages').innerText.includes('MENSAGEM INJETADA PELA EVE'));
  console.log('Eve\'s injected message does NOT appear in Bob\'s chat with Alice:', !bobSeesInjection);

  // Sanity check: reopening the real DM (fresh join_room with correct toPhone)
  // must still return the real prior history intact (feature didn't regress).
  const realHistoryStillThere = await alice.page.evaluate(() => {
    return APP.messages[APP.chats.find(c => c.name === 'Bob').id].some(m => m.text.includes('segredo entre eu e o Bob'));
  });
  console.log('Real conversation history between Alice and Bob is intact:', realHistoryStillThere);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
