const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  pageA.on('console', msg => { if (msg.type() === 'error') console.log('PAGE A ERROR:', msg.text()); });
  pageB.on('console', msg => { if (msg.type() === 'error') console.log('PAGE B ERROR:', msg.text()); });
  pageA.on('dialog', d => { console.log('DIALOG:', d.message()); d.accept(); });

  async function registerAndLogin(page, name, username, phone, email, password) {
    await page.goto('http://localhost:3000');
    await page.click('.login-switch');
    await page.fill('#regName', name);
    await page.fill('#regUsername', username);
    await page.fill('#regPhone', phone);
    await page.selectOption('#regCountry', 'Portugal');
    await page.fill('#regEmail', email);
    await page.fill('#regPassword', password);
    await page.click('button:has-text("Criar conta")');
    await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  }

  const ts = Date.now();
  await registerAndLogin(pageA, 'Alice Teste', 'alice_bc_' + ts, '+3519' + ts.toString().slice(-8), 'alicebc' + ts + '@test.com', 'senha123');
  await registerAndLogin(pageB, 'Bob Teste', 'bob_bc_' + ts, '+3518' + ts.toString().slice(-8), 'bobbc' + ts + '@test.com', 'senha123');

  await pageA.waitForTimeout(1500);

  // Alice adds Bob as a contact (search by username) — agora dentro do menu
  // "Grupos, chamadas e contactos" (consolidação de cabeçalho, ver README).
  await pageA.click('button[title="Grupos, chamadas e contactos"]');
  await pageA.click('#modalContactsFeatures button[onclick*="openSearchUserModal"]');
  await pageA.waitForSelector('#modalSearchUser.active');
  await pageA.fill('#searchUsernameInput', 'bob_bc_' + ts);
  await pageA.click('button:has-text("Procurar")');
  await pageA.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await pageA.click('#searchUserResult button:has-text("Iniciar conversa")');
  await pageA.waitForTimeout(1000);

  const chatsDebug = await pageA.evaluate(() => APP.chats.map(c => ({ id: c.id, type: c.type, name: c.name })));
  console.log('Alice APP.chats:', JSON.stringify(chatsDebug));

  // Open broadcast screen — mesma consolidação de menu.
  await pageA.click('button[title="Grupos, chamadas e contactos"]');
  await pageA.click('#modalContactsFeatures button[onclick*="openBroadcastScreen"]');
  await pageA.waitForSelector('#broadcastScreen.active');
  console.log('Broadcast screen opened OK');

  await pageA.click('text=➕ Nova lista');
  await pageA.waitForSelector('#modalBroadcastEdit.active');
  await pageA.fill('#broadcastName', 'Amigos Teste');

  // Check contact picker has Bob
  const pickerText = await pageA.textContent('#broadcastMemberPicker');
  console.log('Picker contains Bob?', pickerText.includes('Bob Teste'));

  const checkbox = await pageA.$('#broadcastMemberPicker input[type=checkbox]');
  if (checkbox) await checkbox.check();
  else console.log('NO CHECKBOX FOUND');

  await pageA.click('#modalBroadcastEdit button:has-text("Guardar")');
  await pageA.waitForTimeout(1000);

  const listText = await pageA.textContent('#broadcastList');
  console.log('List after save:', listText.replace(/\s+/g, ' ').trim());

  // Send a broadcast message
  await pageA.click('#broadcastList .chat-item');
  await pageA.waitForSelector('#modalBroadcastSend.active');
  await pageA.fill('#broadcastSendText', 'Ola pessoal, mensagem de teste da lista!');
  await pageA.click('#modalBroadcastSend button:has-text("Enviar")');

  await pageA.waitForTimeout(1500);

  // Check Bob received it as a normal private message
  await pageB.waitForTimeout(1000);
  await pageB.click('text=Alice Teste');
  await pageB.waitForTimeout(1000);
  const msgsB = await pageB.textContent('#chatMessages').catch(() => '');
  console.log('Bob chat with Alice contains broadcast text?', (msgsB || '').includes('mensagem de teste da lista'));

  // Delete list (broadcastScreen already open in background)
  await pageA.click('#broadcastList button[title="Apagar"]');
  await pageA.waitForTimeout(300);
  // confirm dialog
  await pageA.waitForTimeout(500);
  const listAfterDelete = await pageA.textContent('#broadcastList');
  console.log('List after delete:', listAfterDelete.replace(/\s+/g, ' ').trim());

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
