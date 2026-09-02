const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3519' + ts.toString().slice(-8);
  const username = prefix + ts;
  await page.fill('#regName', name);
  await page.fill('#regUsername', username);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone, username };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  const a = await register(ctxA, 'Forward A', 'fwd_a_');
  const b = await register(ctxB, 'Forward B', 'fwd_b_');

  // A finds B by username (the real "start a DM with someone not yet a contact" flow) —
  // pushing a fake entry straight into APP.chats doesn't survive the next real
  // groups_update/contacts_update event, which rebuilds APP.chats from scratch.
  await a.page.evaluate((uname) => {
    document.getElementById('modalSearchUser').classList.add('active');
    document.getElementById('searchUsernameInput').value = uname;
  }, b.username);
  await a.page.evaluate(() => doSearchUser());
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => {
    const btn = [...document.querySelectorAll('#searchUserResult button')].find(b => b.textContent.includes('conversa'));
    btn?.click();
  });
  await a.page.waitForTimeout(700);
  await a.page.fill('#messageInput', 'Mensagem original a encaminhar');
  await a.page.press('#messageInput', 'Enter');
  await a.page.waitForTimeout(400);

  // A creates a group too, as a second forward target.
  const groupName = 'Grupo Forward ' + Date.now();
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  await a.page.fill('#groupName', groupName);
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await a.page.waitForTimeout(600);

  // --- Poll messages must NOT show a forward button ---
  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);
  await a.page.click('#pollBtn');
  await a.page.waitForSelector('#modalCreatePoll.active');
  await a.page.fill('#pollQuestionInput', 'Pergunta?');
  const opts = a.page.locator('.poll-option-input');
  await opts.nth(0).fill('A');
  await opts.nth(1).fill('B');
  await a.page.click('#modalCreatePoll button:has-text("Criar")');
  await a.page.waitForTimeout(400);
  const pollHasNoForwardBtn = await a.page.evaluate(() => {
    const pollMsgEl = [...document.querySelectorAll('.message')].find(m => m.querySelector('[onclick^="votePoll"]'));
    return pollMsgEl ? !pollMsgEl.querySelector('button[title="Encaminhar"]') : false;
  });
  console.log('Uma enquete NÃO tem botão de encaminhar:', pollHasNoForwardBtn);

  // --- Go back to the DM and forward the text message ---
  await a.page.click('.chat-item:has-text("Forward B")');
  await a.page.waitForTimeout(300);
  const originalMsgId = await a.page.evaluate(() => {
    const msgs = APP.messages[APP.currentChatId] || [];
    return msgs.find(m => m.text === 'Mensagem original a encaminhar')?.id;
  });
  const forwardBtnVisible = await a.page.evaluate((id) => !!document.querySelector(`[data-msg-id="${id}"] button[title="Encaminhar"]`), originalMsgId);
  console.log('A mensagem de texto normal TEM botão de encaminhar:', forwardBtnVisible);

  await a.page.evaluate((id) => openForwardMessageModal(id), originalMsgId);
  await a.page.waitForSelector('#modalForwardMessage.active');
  const pickerListsGroup = await a.page.evaluate((name) => document.getElementById('forwardTargetPicker').innerText.includes(name), groupName);
  console.log('O seletor de destino inclui o grupo criado:', pickerListsGroup);
  const pickerListsSelf = await a.page.evaluate(() => document.getElementById('forwardTargetPicker').innerText.includes('Forward B'));
  console.log('O seletor de destino inclui a própria conversa atual (reencaminhar de volta é permitido):', pickerListsSelf);

  // Check the group checkbox and confirm.
  await a.page.evaluate((name) => {
    const label = [...document.querySelectorAll('#forwardTargetPicker label')].find(l => l.textContent.includes(name));
    label.querySelector('input').checked = true;
  }, groupName);
  let forwardAlertMsg = '';
  a.page.once('dialog', d => { forwardAlertMsg = d.message(); d.accept(); });
  await a.page.click('#modalForwardMessage button:has-text("Encaminhar")');
  await a.page.waitForTimeout(500);
  console.log('Mostra uma confirmação depois de encaminhar:', forwardAlertMsg.includes('1 conversa'));

  // --- The group now has the forwarded message, marked as such ---
  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);
  const groupHasForwardedMsg = await a.page.evaluate(() => document.getElementById('chatMessages').innerText.includes('Mensagem original a encaminhar'));
  console.log('A mensagem encaminhada chega ao grupo escolhido:', groupHasForwardedMsg);
  const groupShowsForwardedLabel = await a.page.evaluate(() => document.getElementById('chatMessages').innerText.includes('Encaminhada'));
  console.log('Aparece a etiqueta "↪️ Encaminhada":', groupShowsForwardedLabel);

  // --- The ORIGINAL message in the DM must not itself be mutated/marked ---
  await a.page.click('.chat-item:has-text("Forward B")');
  await a.page.waitForTimeout(300);
  const originalStillNotForwarded = await a.page.evaluate((id) => {
    const msg = (APP.messages[APP.currentChatId] || []).find(m => m.id === id);
    return !msg.forwarded;
  }, originalMsgId);
  console.log('A mensagem original em si não fica marcada como encaminhada:', originalStillNotForwarded);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
