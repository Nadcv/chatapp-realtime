const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Folders Test');
  await page.fill('#regUsername', 'folderstest_' + ts);
  await page.fill('#regPhone', '+3512' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'folderstest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  // Initial state: only "Tudo" and "+" chips before creating any folder.
  const initialTabs = await page.evaluate(() => document.getElementById('folderTabs').innerText.trim());
  console.log('Initial folder bar shows only Tudo/+:', initialTabs === 'Tudo\n+' || initialTabs === 'Tudo+' || initialTabs.replace(/\s+/g, '') === 'Tudo+');

  // Push a few fake chats to organize.
  await page.evaluate(() => {
    APP.chats.push(
      { id: 'fold_chat_a', name: 'Chat Trabalho A', phone: '+351000000201', type: 'user' },
      { id: 'fold_chat_b', name: 'Chat Trabalho B', phone: '+351000000202', type: 'user' },
      { id: 'fold_chat_c', name: 'Chat Pessoal C', phone: '+351000000203', type: 'user' }
    );
    renderChatList();
  });

  // Open the folders modal from the chat-more menu path (via the exposed function directly,
  // same as clicking "Pastas" inside "⋯ Mais desta conversa" would do) without a chat open yet.
  await page.evaluate(() => openChatFoldersModal());
  await page.waitForSelector('#modalChatFolders.active', { timeout: 3000 });
  const emptyListText = await page.evaluate(() => document.getElementById('chatFoldersList').innerText);
  console.log('Shows empty-state message with no folders yet:', emptyListText.includes('Ainda não tens pastas'));

  await page.fill('#newFolderNameInput', 'Trabalho');
  await page.click('#modalChatFolders button:has-text("Criar")');
  await page.waitForTimeout(300);

  const foldersAfterCreate = await page.evaluate(() => APP.folders.map(f => f.name));
  console.log('Folder "Trabalho" was created and synced back from server:', foldersAfterCreate.includes('Trabalho'));

  const tabsAfterCreate = await page.evaluate(() => document.getElementById('folderTabs').innerText);
  console.log('New folder appears as a chip in the tab bar:', tabsAfterCreate.includes('Trabalho'));

  await page.click('#modalChatFolders button:has-text("Fechar")');
  await page.waitForTimeout(100);

  // Open a chat and add it to the folder via the checkbox.
  await page.click('.chat-item:has-text("Chat Trabalho A")');
  await page.waitForTimeout(200);
  await page.evaluate(() => openChatFoldersModal());
  await page.waitForTimeout(200);
  const folderId = await page.evaluate(() => APP.folders.find(f => f.name === 'Trabalho').id);
  await page.check(`#chatFoldersList input[type="checkbox"]`);
  await page.waitForTimeout(300);

  const chatInFolder = await page.evaluate((fid) => APP.folders.find(f => f.id === fid).chatIds.includes('fold_chat_a'), folderId);
  console.log('Checking the box adds the open chat to the folder (persisted server-side):', chatInFolder);

  await page.click('#modalChatFolders button:has-text("Fechar")');
  await page.waitForTimeout(100);

  // Add a second chat to the same folder directly via the API (simulating opening it and checking the box).
  await page.evaluate((fid) => {
    APP.currentChatId = 'fold_chat_b';
    socket.emit('set_chat_folder', { folderId: fid, chatId: 'fold_chat_b', inFolder: true });
  }, folderId);
  await page.waitForTimeout(300);
  await page.evaluate(() => { APP.currentChatId = null; }); // volta ao estado sem conversa aberta

  // Filter by the "Trabalho" folder tab: only the two assigned chats should show.
  await page.click('#folderTabs button:has-text("Trabalho")');
  await page.waitForTimeout(200);
  const visibleNamesInFolder = await page.evaluate(() => [...document.querySelectorAll('#chatList .chat-item h4')].map(h => h.textContent.trim()));
  console.log('Folder filter shows exactly the 2 chats added to it:', visibleNamesInFolder.some(n => n.includes('Chat Trabalho A')) && visibleNamesInFolder.some(n => n.includes('Chat Trabalho B')));
  console.log('Folder filter excludes the chat NOT added to it:', !visibleNamesInFolder.some(n => n.includes('Chat Pessoal C')));

  // Switching back to "Tudo" shows everything again.
  await page.click('#folderTabs button:has-text("Tudo")');
  await page.waitForTimeout(200);
  const visibleNamesAll = await page.evaluate(() => [...document.querySelectorAll('#chatList .chat-item h4')].map(h => h.textContent.trim()));
  console.log('"Tudo" tab shows the previously-excluded chat again:', visibleNamesAll.some(n => n.includes('Chat Pessoal C')));

  // Removing a chat from the folder via unchecking.
  await page.click('.chat-item:has-text("Chat Trabalho A")');
  await page.waitForTimeout(200);
  await page.evaluate(() => openChatFoldersModal());
  await page.waitForTimeout(200);
  await page.uncheck('#chatFoldersList input[type="checkbox"]');
  await page.waitForTimeout(300);
  const chatRemovedFromFolder = await page.evaluate((fid) => !APP.folders.find(f => f.id === fid).chatIds.includes('fold_chat_a'), folderId);
  console.log('Unchecking removes the chat from the folder:', chatRemovedFromFolder);
  await page.click('#modalChatFolders button:has-text("Fechar")');

  // XSS safety: a folder name with HTML must render escaped in both the tab bar and the modal list.
  await page.evaluate(() => openChatFoldersModal());
  await page.fill('#newFolderNameInput', '<img src=x onerror=alert(1)>');
  await page.click('#modalChatFolders button:has-text("Criar")');
  await page.waitForTimeout(300);
  const tabsHtml = await page.evaluate(() => document.getElementById('folderTabs').innerHTML);
  const modalHtml = await page.evaluate(() => document.getElementById('chatFoldersList').innerHTML);
  console.log('Folder name with HTML is escaped in the tab bar:', !tabsHtml.includes('<img src=x onerror'));
  console.log('Folder name with HTML is escaped in the modal list:', !modalHtml.includes('<img src=x onerror'));
  await page.click('#modalChatFolders button:has-text("Fechar")');

  // Deleting a folder removes its chip and switches back to "Tudo" if it was active.
  await page.click('#folderTabs button:has-text("Trabalho")');
  await page.waitForTimeout(200);
  page.on('dialog', d => d.accept());
  await page.evaluate((fid) => openChatFoldersModal(), folderId);
  await page.waitForTimeout(200);
  const deleteButtons = await page.$$('#chatFoldersList button[title="Apagar pasta"]');
  await deleteButtons[0].click();
  await page.waitForTimeout(300);
  const tabsAfterDelete = await page.evaluate(() => document.getElementById('folderTabs').innerText);
  console.log('Deleting the active folder removes its chip and resets to "Tudo":', !tabsAfterDelete.includes('Trabalho'));
  const activeFolderReset = await page.evaluate(() => APP.activeFolderId === null);
  console.log('Active folder resets to null (shows all chats) after deleting the active one:', activeFolderReset);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
