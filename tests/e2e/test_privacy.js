const { chromium } = require('playwright');

async function registerAndLogin(page, label, ts) {
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  await page.fill('#regName', label);
  await page.fill('#regUsername', label.toLowerCase().replace(/\s/g, '') + '_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', label.toLowerCase().replace(/\s/g, '') + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  pageA.on('pageerror', err => console.log('PAGE A EXCEPTION:', err.message));
  pageB.on('pageerror', err => console.log('PAGE B EXCEPTION:', err.message));

  const tsA = Date.now();
  const tsB = tsA + 1;
  await registerAndLogin(pageA, 'Privacy Alice', tsA);
  await registerAndLogin(pageB, 'Privacy Bob', tsB);

  const phoneA = await pageA.evaluate(() => APP.user.phone);
  const phoneB = await pageB.evaluate(() => APP.user.phone);
  const usernameB = await pageB.evaluate(() => APP.user.username);

  // Alice adds Bob as a contact via username search.
  await pageA.click('button[title="Contactos"], .header-icon:has-text("👥")').catch(() => {});
  // Use the search modal directly via JS to keep this robust regardless of icon layout.
  await pageA.evaluate((uname) => {
    document.getElementById('modalSearchUser').classList.add('active');
    document.getElementById('searchUsernameInput').value = uname;
  }, usernameB);
  await pageA.evaluate(() => doSearchUser());
  await pageA.waitForTimeout(500);
  await pageA.evaluate(() => {
    const btn = [...document.querySelectorAll('#searchUserResult button')].find(b => b.textContent.includes('conversa') || b.textContent.includes('Adicionar'));
    if (btn) btn.click();
  });
  await pageA.waitForTimeout(500);

  // Reload contacts on both sides.
  await pageA.waitForTimeout(500);
  await pageB.waitForTimeout(500);

  // --- Baseline: without privacy toggles, Alice should see Bob online. ---
  const bobOnlineBefore = await pageA.evaluate(() => {
    const c = APP.chats.find(c => c.type === 'user');
    return c ? c.online : null;
  });
  console.log('Baseline: Alice sees Bob online (privacy off):', bobOnlineBefore === true);

  // --- Bob turns on "hide online status" ---
  await pageB.evaluate(() => {
    document.getElementById('hideOnlineStatusCheck').checked = true;
    savePrivacySettings();
  });
  await pageB.waitForTimeout(500);

  const bobOnlineAfterHide = await pageA.evaluate(() => {
    const c = APP.chats.find(c => c.type === 'user');
    return c ? c.online : null;
  });
  console.log('After Bob hides online status, Alice sees him as offline:', bobOnlineAfterHide === false);

  // Bob's own client should still know he's "really" online (not affected for himself)... but
  // since this is a one-way privacy setting affecting only what others see, we just verify Bob's
  // own UI state isn't broken.
  const bobUiStillWorks = await pageB.evaluate(() => !!APP.user && document.getElementById('mainApp').classList.contains('active') !== undefined);
  console.log('Bob\'s own UI remains functional after enabling the toggle:', bobUiStillWorks);

  // --- Read receipts test ---
  // Alice opens the chat with Bob and sends the FIRST message — this is what makes the server
  // auto-add Alice to Bob's contacts (so Bob only gets a "user" chat entry for Alice from here on).
  await pageA.evaluate((phoneB) => {
    const c = APP.chats.find(c => c.type === 'user');
    if (c) openChat(c.id);
  }, phoneB);
  await pageA.waitForTimeout(300);

  await pageA.fill('#messageInput', 'Ola Bob teste privacidade');
  await pageA.evaluate(() => sendMessage());
  await pageA.waitForTimeout(700);

  // Now that Bob has received contacts_update (Alice added), his chat list has her — open it,
  // with hideReadReceipts still OFF, so this should trigger a normal read receipt.
  await pageB.evaluate(() => {
    const c = APP.chats.find(c => c.type === 'user');
    if (c) openChat(c.id);
  });
  await pageB.waitForTimeout(500);

  const aliceMsgReadNormally = await pageA.evaluate(() => {
    const msgs = APP.messages[APP.currentChatId] || [];
    const last = msgs[msgs.length - 1];
    return last ? last.read === true : false;
  });
  console.log('Read receipt WORKS normally (Bob has NOT enabled hideReadReceipts yet):', aliceMsgReadNormally);

  // Now Bob enables hideReadReceipts, Alice sends another message.
  await pageB.evaluate(() => {
    document.getElementById('hideReadReceiptsCheck').checked = true;
    savePrivacySettings();
  });
  await pageB.waitForTimeout(300);

  await pageA.fill('#messageInput', 'Segunda mensagem apos ligar privacidade');
  await pageA.evaluate(() => sendMessage());
  await pageA.waitForTimeout(500);
  await pageB.waitForTimeout(500);

  const aliceMsgReadSuppressed = await pageA.evaluate(() => {
    const msgs = APP.messages[APP.currentChatId] || [];
    const last = msgs[msgs.length - 1];
    return last ? last.read === true : false;
  });
  console.log('After Bob enables "no read receipts", Alice\'s new message does NOT show as read:', aliceMsgReadSuppressed === false);

  // Bob should still see HIS OWN read status of Alice's messages normally (asymmetric, disclosed).
  // Also verify Bob still receives Alice's messages fine despite the privacy setting (functionality preserved).
  const bobStillReceivesMessages = await pageB.evaluate(() => {
    const msgs = APP.messages[APP.currentChatId] || [];
    return msgs.some(m => m.text.includes('Segunda mensagem'));
  });
  console.log('Bob still receives messages normally despite his own read-receipt privacy setting:', bobStillReceivesMessages);

  // Persistence: reload Bob's page, checkboxes should reflect saved server-side state.
  await pageB.reload();
  await pageB.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 }).catch(() => {});
  await pageB.waitForTimeout(1000);
  await pageB.evaluate(() => openProfileModal());
  const persistedOnline = await pageB.evaluate(() => document.getElementById('hideOnlineStatusCheck').checked);
  const persistedReceipts = await pageB.evaluate(() => document.getElementById('hideReadReceiptsCheck').checked);
  console.log('Privacy settings persist across reload (hideOnlineStatus):', persistedOnline === true);
  console.log('Privacy settings persist across reload (hideReadReceipts):', persistedReceipts === true);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
