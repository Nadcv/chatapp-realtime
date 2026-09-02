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

  const a = await register(ctxA, 'RSVP A', 'rsvpa_');
  const b = await register(ctxB, 'RSVP B', 'rsvpb_');

  const groupName = 'Grupo RSVP ' + Date.now();
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  await a.page.fill('#groupName', groupName);
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await a.page.waitForTimeout(600);

  await b.page.waitForTimeout(300);
  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);
  await b.page.click(`.chat-item:has-text("${groupName}")`);
  await b.page.waitForTimeout(300);

  // --- RSVP quick-start ---
  const rsvpBtnVisible = await a.page.evaluate(() => getComputedStyle(document.getElementById('rsvpBtn')).display !== 'none');
  console.log('RSVP button is visible in a group chat:', rsvpBtnVisible);

  await a.page.click('#rsvpBtn');
  await a.page.waitForSelector('#modalCreatePoll.active');
  const rsvpPlaceholder = await a.page.evaluate(() => document.getElementById('pollQuestionInput').placeholder);
  console.log('RSVP quick-start shows an event-oriented placeholder:', rsvpPlaceholder.includes('evento'));
  const rsvpOptionValues = await a.page.evaluate(() => [...document.querySelectorAll('.poll-option-input')].map(el => el.value));
  console.log('RSVP quick-start pre-fills Vou/Não vou/Talvez options:', rsvpOptionValues.join('|').includes('Vou') && rsvpOptionValues.join('|').includes('Não vou') && rsvpOptionValues.join('|').includes('Talvez'));

  await a.page.fill('#pollQuestionInput', 'Festa de sábado');
  await a.page.click('#modalCreatePoll button:has-text("Criar")');
  await a.page.waitForTimeout(600);

  const aRsvpMsg = await a.page.evaluate(() => {
    const chat = APP.chats.find(c => c.type === 'group');
    return APP.messages[chat.id].find(m => m.poll?.question === 'Festa de sábado');
  });
  console.log('RSVP event created as a real poll message with 3 options:', aRsvpMsg && aRsvpMsg.poll.options.length === 3);
  console.log('RSVP poll has no expiry by default:', aRsvpMsg && aRsvpMsg.poll.expiresAt === null);

  await b.page.waitForTimeout(500);
  const bSeesRsvp = await b.page.evaluate(() => {
    const chat = APP.chats.find(c => c.type === 'group');
    return (APP.messages[chat.id] || []).some(m => m.poll?.question === 'Festa de sábado');
  });
  console.log('B receives the RSVP poll in the group:', bSeesRsvp);

  // B votes "Vou" (index 0).
  const groupChatId = await a.page.evaluate(() => APP.chats.find(c => c.type === 'group').id);
  await b.page.evaluate((chatId) => { APP.currentChatId = chatId; renderMessages(); }, groupChatId);
  await b.page.waitForTimeout(200);
  const bMsgId = await b.page.evaluate((chatId) => APP.messages[chatId].find(m => m.poll?.question === 'Festa de sábado').id, groupChatId);
  await b.page.evaluate((msgId) => votePoll(msgId, 0), bMsgId);
  await b.page.waitForTimeout(400);

  await a.page.evaluate((chatId) => { APP.currentChatId = chatId; renderMessages(); }, groupChatId);
  await a.page.waitForTimeout(400);
  const aSeesVoteLive = await a.page.evaluate((msgId) => {
    const msg = APP.messages[APP.currentChatId].find(m => m.id === msgId);
    return msg.poll.options[0].votes.length === 1;
  }, bMsgId);
  console.log('A sees B\'s RSVP vote live (poll_updated broadcast):', aSeesVoteLive);

  // --- Poll expiry ---
  await a.page.click('#pollBtn');
  await a.page.waitForSelector('#modalCreatePoll.active');
  const defaultExpiryReset = await a.page.evaluate(() => document.getElementById('pollExpirySelect').value === '0');
  console.log('Poll expiry select resets to "Nunca" for a fresh regular poll:', defaultExpiryReset);
  await a.page.fill('#pollQuestionInput', 'Enquete com prazo curtinho');
  const optionInputs = await a.page.$$('.poll-option-input');
  await optionInputs[0].fill('Opção A');
  await optionInputs[1].fill('Opção B');
  // Use "1 hora" then override expiresAt client-side to something already in the past,
  // to deterministically test the "already expired" rendering/voting-block without waiting.
  await a.page.selectOption('#pollExpirySelect', '3600000');
  await a.page.click('#modalCreatePoll button:has-text("Criar")');
  await a.page.waitForTimeout(500);

  const expiryMsgId = await a.page.evaluate((chatId) => APP.messages[chatId].find(m => m.poll?.question === 'Enquete com prazo curtinho').id, groupChatId);
  const hasFutureExpiry = await a.page.evaluate((msgId) => {
    const msg = APP.messages[APP.currentChatId].find(m => m.id === msgId);
    return msg.poll.expiresAt > Date.now();
  }, expiryMsgId);
  console.log('A poll created with "1 hora" gets a future expiresAt timestamp:', hasFutureExpiry);

  const activeExpiryLine = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML.includes('Encerra em'));
  console.log('An active timed poll shows "Encerra em Xh" in the bubble:', activeExpiryLine);

  // Force it into the past to test the "expired" rendering + vote-blocking deterministically.
  await a.page.evaluate((msgId) => {
    const msg = APP.messages[APP.currentChatId].find(m => m.id === msgId);
    msg.poll.expiresAt = Date.now() - 1000;
    renderMessages();
  }, expiryMsgId);
  await a.page.waitForTimeout(200);
  const expiredLabelShown = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML.includes('Votação encerrada'));
  console.log('An expired poll shows "Votação encerrada" instead of the countdown:', expiredLabelShown);

  const votesBeforeAttempt = await a.page.evaluate((msgId) => APP.messages[APP.currentChatId].find(m => m.id === msgId).poll.options[0].votes.length, expiryMsgId);
  await a.page.evaluate((msgId) => votePoll(msgId, 0), expiryMsgId);
  await a.page.waitForTimeout(400);
  const votesAfterAttempt = await a.page.evaluate((msgId) => APP.messages[APP.currentChatId].find(m => m.id === msgId).poll.options[0].votes.length, expiryMsgId);
  console.log('Client-side: clicking to vote on an expired poll is a no-op (votePoll returns early):', votesBeforeAttempt === votesAfterAttempt);

  // Server-side enforcement: A sends a message whose poll.expiresAt is ALREADY in the past
  // according to the SERVER's own stored copy, then A tries to vote on it via a raw socket
  // emit. Checked from B's side (B genuinely joined the room and receives the broadcasts;
  // A's own socket never gets its own send_message echoed back via receive_message).
  const expiredMsgId = 'mexpired' + Date.now();
  await b.page.evaluate((chatId) => { APP.currentChatId = chatId; }, groupChatId);
  await a.page.evaluate(({ chatId, msgId }) => {
    const poll = { question: 'Já encerrada de verdade', options: [{ text: 'X', votes: [] }, { text: 'Y', votes: [] }], expiresAt: Date.now() - 5000 };
    socket.emit('send_message', { id: msgId, chatId, sender: APP.user.name, senderPhone: APP.user.phone, text: '', time: '00:00', poll });
  }, { chatId: groupChatId, msgId: expiredMsgId });
  await b.page.waitForTimeout(500);
  await a.page.evaluate(({ chatId, msgId }) => {
    socket.emit('vote_poll', { chatId, messageId: msgId, optionIndex: 1 });
  }, { chatId: groupChatId, msgId: expiredMsgId });
  await b.page.waitForTimeout(500);
  const serverRejectsExpiredVote = await b.page.evaluate((msgId) => {
    const msg = (APP.messages[APP.currentChatId] || []).find(m => m.id === msgId);
    return !!msg && msg.poll.options[1].votes.length === 0;
  }, expiredMsgId);
  console.log('Server-side: a raw vote_poll emit on a poll that is genuinely expired server-side is rejected:', serverRejectsExpiredVote);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
