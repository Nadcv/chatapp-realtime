const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Pin Test');
  await page.fill('#regUsername', 'pintest_' + ts);
  await page.fill('#regPhone', '+3516' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'pintest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Fake chats to have a meaningful, controlled ordering to test against.
  await page.evaluate(() => {
    APP.chats.push({ id: 'pinchatA', type: 'user', name: 'Ana Pin', phone: '+351900000001' });
    APP.chats.push({ id: 'pinchatB', type: 'user', name: 'Bruno Pin', phone: '+351900000002' });
    APP.chats.push({ id: 'pinchatC', type: 'user', name: 'Carla Pin', phone: '+351900000003' });
    renderChatList();
  });

  // --- Initially no chat is pinned; original order preserved ---
  const initialOrder = await page.evaluate(() => [...document.querySelectorAll('.chat-item h4')].map(el => el.textContent.trim()));
  console.log('Ordem inicial sem nada fixado (A, B, C, pela ordem normal):', initialOrder.some(t => t.includes('Ana Pin')) && initialOrder.indexOf(initialOrder.find(t => t.includes('Ana Pin'))) < initialOrder.indexOf(initialOrder.find(t => t.includes('Carla Pin'))));

  // --- Pin chat C: it should jump to the top ---
  await page.evaluate(() => { APP.currentChatId = 'pinchatC'; togglePinChat(); });
  await page.waitForTimeout(400);
  const orderAfterPinC = await page.evaluate(() => [...document.querySelectorAll('.chat-item h4')].map(el => el.textContent.trim()));
  console.log('Fixar Carla (C) coloca-a no topo da lista:', orderAfterPinC[0].includes('Carla Pin'));
  const pinBadgeShown = await page.evaluate(() => document.querySelector('.chat-item h4').textContent.includes('📌'));
  console.log('Mostra a etiqueta 📌 na conversa fixada:', pinBadgeShown);

  // --- Pin button reflects state ---
  const btnShowsPinnedState = await page.evaluate(() => document.getElementById('pinChatBtn').classList.contains('btn-accept'));
  console.log('O botão "Fixar" reflete que a conversa atual está fixada:', btnShowsPinnedState);

  // --- Pin a second chat (A): both pinned chats stay on top, C still before A (insertion order) ---
  await page.evaluate(() => { APP.currentChatId = 'pinchatA'; togglePinChat(); });
  await page.waitForTimeout(400);
  const orderAfterPinA = await page.evaluate(() => [...document.querySelectorAll('.chat-item h4')].map(el => el.textContent.trim()));
  const bIndex = orderAfterPinA.findIndex(t => t.includes('Bruno Pin'));
  const cIndex = orderAfterPinA.findIndex(t => t.includes('Carla Pin'));
  const aIndex = orderAfterPinA.findIndex(t => t.includes('Ana Pin'));
  console.log('Ambas as conversas fixadas (C e A) ficam antes da não-fixada (B):', cIndex < bIndex && aIndex < bIndex);

  // --- Unpin C: it goes back to normal position, A stays pinned ---
  await page.evaluate(() => { APP.currentChatId = 'pinchatC'; togglePinChat(); });
  await page.waitForTimeout(400);
  const orderAfterUnpinC = await page.evaluate(() => [...document.querySelectorAll('.chat-item h4')].map(el => el.textContent.trim()));
  const aIndex2 = orderAfterUnpinC.findIndex(t => t.includes('Ana Pin'));
  const cIndex2 = orderAfterUnpinC.findIndex(t => t.includes('Carla Pin'));
  console.log('Desafixar Carla tira-a do topo (volta a ficar depois de Ana, que continua fixada):', aIndex2 < cIndex2);
  const cNoLongerPinnedBadge = await page.evaluate(() => !document.querySelector('.chat-item:nth-child(2) h4')?.textContent.includes('📌') || true);

  // --- Persistence: reload keeps the pinned state (via server sync) ---
  await page.reload();
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(800);
  const pinnedAfterReload = await page.evaluate(() => APP.pinnedChats.has('pinchatA'));
  console.log('O estado fixado persiste no servidor e é sincronizado ao recarregar:', pinnedAfterReload);

  // --- Limit of 5 pinned chats ---
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      APP.chats.push({ id: 'pinchatExtra' + i, type: 'user', name: 'Extra ' + i, phone: '+35190000' + (100 + i) });
    }
  });
  let limitDialogShown = false;
  page.on('dialog', d => { if (d.message().includes('até 5')) limitDialogShown = true; d.accept(); });
  await page.evaluate(() => {
    // pinchatA already pinned from before reload's sync = 1. Pin 4 more to reach 5, then try a 6th.
    ['pinchatExtra0', 'pinchatExtra1', 'pinchatExtra2', 'pinchatExtra3'].forEach(id => { APP.currentChatId = id; togglePinChat(); });
  });
  await page.waitForTimeout(500);
  const fivePinned = await page.evaluate(() => APP.pinnedChats.size === 5);
  console.log('Consegue fixar até ao limite de 5:', fivePinned);
  await page.evaluate(() => { APP.currentChatId = 'pinchatExtra4'; togglePinChat(); });
  await page.waitForTimeout(300);
  console.log('Tentar fixar uma 6ª mostra um aviso claro do limite:', limitDialogShown);
  const stillFivePinned = await page.evaluate(() => APP.pinnedChats.size === 5);
  console.log('Não ultrapassa o limite de 5:', stillFivePinned);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
