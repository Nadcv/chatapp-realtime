const { chromium } = require('playwright');

async function registerUser(browser, label) {
  const page = await browser.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION (${label}):`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  await page.fill('#regName', label);
  await page.fill('#regUsername', 'stale_' + label.toLowerCase() + '_' + ts);
  await page.fill('#regPhone', '+3516' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'stale_' + label.toLowerCase() + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const phone = await page.evaluate(() => APP.user.phone);
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const alice = await registerUser(browser, 'Alice');
  const bob = await registerUser(browser, 'Bob'); // simula um telemóvel com a app em cache antiga

  await alice.page.evaluate((bobPhone) => socket.emit('add_contact', { phone: bobPhone }), bob.phone);
  await bob.page.evaluate((alicePhone) => socket.emit('add_contact', { phone: alicePhone }), alice.phone);
  await alice.page.waitForTimeout(500);
  await bob.page.waitForTimeout(500);

  // Bob's client is simulated as running OLD cached JS from before the DM-room
  // fix: it calls join_room with a bare string (no {chatId, toPhone} object),
  // exactly like the pre-fix client code did.
  const bobChatId = await bob.page.evaluate((alicePhone) => APP.chats.find(c => c.phone === alicePhone)?.id, alice.phone);
  await bob.page.evaluate((chatId) => {
    APP.joinedRooms.delete(chatId); // força a reentrar como se fosse a 1ª vez
    socket.emit('join_room', chatId); // formato ANTIGO — string simples, sem toPhone
  }, bobChatId);
  await bob.page.waitForTimeout(500);

  await alice.page.click('.chat-item:has-text("Bob")');
  await alice.page.waitForTimeout(200);
  await bob.page.click('.chat-item:has-text("Alice")');
  await bob.page.waitForTimeout(200);

  await alice.page.fill('#messageInput', 'mensagem para cliente antigo');
  await alice.page.press('#messageInput', 'Enter');

  let liveDelivered = false;
  for (let i = 0; i < 25; i++) {
    liveDelivered = await bob.page.evaluate((chatId) => (APP.messages[chatId] || []).some(m => m.text === 'mensagem para cliente antigo'), bobChatId);
    if (liveDelivered) break;
    await bob.page.waitForTimeout(200);
  }
  console.log('An old client (bare-string join_room, no toPhone) still receives messages live:', liveDelivered);

  // And a bare-string send_message (old client sending, e.g. before toPhone existed at all
  // in some hypothetical older build) must also still be accepted by the server.
  await bob.page.evaluate((chatId) => {
    socket.emit('send_message', { id: 'bob_old_msg_1', chatId, sender: 'Bob', text: 'resposta cliente antigo', time: '00:00' }); // sem toPhone
  }, bobChatId);
  await alice.page.waitForTimeout(500);
  const aliceReceivedOldStyleSend = await alice.page.evaluate((chatId) => (APP.messages[chatId] || []).some(m => m.text === 'resposta cliente antigo'), bobChatId);
  console.log('A send_message without toPhone (old client) is still delivered:', aliceReceivedOldStyleSend);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
