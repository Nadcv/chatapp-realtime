const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Blocked List Test');
  await page.fill('#regUsername', 'blocklist_' + ts);
  await page.fill('#regPhone', '+3515' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'blocklist' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.onlineContacts.push({ phone: '+351977777777', name: 'Contacto Chato', username: 'chato', online: false });
    APP.chats.push({ id: 'dm_blockme', type: 'user', name: 'Contacto Chato', phone: '+351977777777' });
    renderChatList();
  });

  // --- No blocked accounts yet ---
  await page.click('button[onclick="openContactsFeaturesModal()"]');
  await page.waitForSelector('#modalContactsFeatures.active');
  await page.click('button:has-text("Contas bloqueadas")');
  await page.waitForSelector('#modalBlockedUsers.active');
  const emptyStateShown = await page.evaluate(() => document.getElementById('blockedUsersList').innerText.includes('Não bloqueaste ninguém'));
  console.log('Estado vazio claro quando não há ninguém bloqueado:', emptyStateShown);
  await page.click('#modalBlockedUsers button:has-text("Fechar")');

  // --- Block the contact from within the chat (existing flow) ---
  await page.click('.chat-item:has-text("Contacto Chato")');
  await page.waitForTimeout(300);
  await page.click('button[onclick="openChatMoreModal()"]');
  await page.waitForSelector('#modalChatMore.active');
  const initialBtnLabel = await page.evaluate(() => document.getElementById('blockUserBtn').querySelector('span').textContent);
  console.log('Botão no menu mostra "Bloquear" antes de bloquear:', initialBtnLabel === 'Bloquear');
  await page.click('#blockUserBtn');
  await page.waitForSelector('#modalBlockUser.active');
  await page.click('#blockUserToggleBtn');
  await page.waitForTimeout(400);

  // --- The chat-more menu button label now says "Desbloquear" ---
  const labelAfterBlock = await page.evaluate(() => document.getElementById('blockUserBtn').querySelector('span').textContent);
  console.log('Depois de bloquear, o botão do menu passa a mostrar "Desbloquear":', labelAfterBlock === 'Desbloquear');

  // --- The dedicated blocked-accounts list now shows this contact, with a real name ---
  await page.click('button[onclick="openContactsFeaturesModal()"]');
  await page.waitForSelector('#modalContactsFeatures.active');
  await page.click('button:has-text("Contas bloqueadas")');
  await page.waitForSelector('#modalBlockedUsers.active');
  const listShowsContact = await page.evaluate(() => document.getElementById('blockedUsersList').innerText.includes('Contacto Chato'));
  console.log('A lista de contas bloqueadas mostra o nome do contacto:', listShowsContact);

  // --- Unblock directly from this list (no need to reopen the chat) ---
  await page.click('#blockedUsersList button:has-text("Desbloquear")');
  await page.waitForTimeout(400);
  const removedLive = await page.evaluate(() => !document.getElementById('blockedUsersList').innerText.includes('Contacto Chato'));
  console.log('Desbloquear na lista remove-o logo dali, sem reabrir a conversa:', removedLive);
  const backToEmptyState = await page.evaluate(() => document.getElementById('blockedUsersList').innerText.includes('Não bloqueaste ninguém'));
  console.log('Fica vazio de novo depois de desbloquear o único bloqueado:', backToEmptyState);

  // --- The chat-more button label reverts to "Bloquear" too ---
  await page.click('#modalBlockedUsers button:has-text("Fechar")');
  await page.click('.chat-item:has-text("Contacto Chato")');
  await page.waitForTimeout(300);
  await page.click('button[onclick="openChatMoreModal()"]');
  await page.waitForSelector('#modalChatMore.active');
  const labelAfterUnblock = await page.evaluate(() => document.getElementById('blockUserBtn').querySelector('span').textContent);
  console.log('O botão do menu volta a mostrar "Bloquear" depois de desbloquear:', labelAfterUnblock === 'Bloquear');

  // --- Unblocking with an unknown phone (not a contact anymore) falls back to showing the number ---
  await page.evaluate(() => { APP.blockedUsers = new Set(['+351900000123']); renderBlockedUsersList(); });
  const fallbackToPhone = await page.evaluate(() => document.getElementById('blockedUsersList').innerText.includes('+351900000123'));
  console.log('Mostra o número quando a pessoa já não é um contacto reconhecido:', fallbackToPhone);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
