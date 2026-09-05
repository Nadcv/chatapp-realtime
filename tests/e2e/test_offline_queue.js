const { chromium } = require('playwright');

// Sem ligação (rede em baixo, socket a tentar reconectar), as mensagens que a
// pessoa manda não se podem perder nem parecer "enviadas" quando não foram.
// Este teste simula a queda com socket.disconnect() — o mesmo evento
// 'disconnect' que uma queda de rede a sério dispara. (context.setOffline()
// do Playwright NÃO serve para simular isto: neste ambiente o WebSocket já
// aberto do socket.io continua "connected" mesmo depois de cortar a rede a
// nível do browser — o corte só bloqueia ligações NOVAS, confirmado com um
// script de diagnóstico à parte). Confirma o banner "Sem ligação", o relógio
// 🕓 em vez do "✓" enquanto pendente, que a lógica de restaurar a fila do
// localStorage (usada num recarregar real da página) traz a mensagem
// pendente de volta, e que ao reconectar ela é mesmo enviada — chegando à
// outra pessoa e trocando o 🕓 por "✓".
async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3517' + ts.toString().slice(-8);
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

  const a = await register(ctxA, 'Offline A', 'offa_');
  const b = await register(ctxB, 'Offline B', 'offb_');

  await a.page.click('button[title="Grupos, chamadas e contactos"]');
  await a.page.click('#modalContactsFeatures button[onclick*="openSearchUserModal"]');
  await a.page.waitForSelector('#modalSearchUser.active');
  await a.page.fill('#searchUsernameInput', b.username);
  await a.page.click('button:has-text("Procurar")');
  await a.page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await a.page.click('#searchUserResult button:has-text("Iniciar conversa")');
  await a.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });
  await a.page.waitForTimeout(300);

  await b.page.click('button[title="Grupos, chamadas e contactos"]');
  await b.page.click('#modalContactsFeatures button[onclick*="openSearchUserModal"]');
  await b.page.waitForSelector('#modalSearchUser.active');
  await b.page.fill('#searchUsernameInput', a.username);
  await b.page.click('button:has-text("Procurar")');
  await b.page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await b.page.click('#searchUserResult button:has-text("Iniciar conversa")');
  await b.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });
  await b.page.waitForTimeout(300);

  const bannerHiddenBefore = await a.page.evaluate(() => document.getElementById('offlineBanner').style.display === 'none');
  console.log('O banner "Sem ligação" começa escondido (a conta acabou de entrar, com ligação):', bannerHiddenBefore);

  // --- Simula a queda de rede desligando o socket manualmente. ---
  await a.page.evaluate(() => socket.disconnect());
  await a.page.waitForTimeout(300);
  const bannerVisible = await a.page.evaluate(() => document.getElementById('offlineBanner').style.display === 'block');
  console.log('Ao perder a ligação, o banner "Sem ligação" aparece:', bannerVisible);

  await a.page.fill('#messageInput', 'mensagem enviada offline');
  await a.page.press('#messageInput', 'Enter');
  await a.page.waitForTimeout(300);

  const localMsgPending = await a.page.evaluate(() => {
    const msg = APP.messages[APP.currentChatId].find(m => m.text === 'mensagem enviada offline');
    return msg && msg.pending === true;
  });
  console.log('A mensagem aparece já na conversa, marcada como pendente:', localMsgPending);

  const showsClockIcon = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML.includes('🕓'));
  console.log('Mostra o relógio 🕓 em vez do "✓" enquanto está pendente:', showsClockIcon);

  const queuedInMemory = await a.page.evaluate(() => APP.offlineQueue.some(item => item.previewText === 'mensagem enviada offline'));
  console.log('A mensagem fica guardada na fila em memória:', queuedInMemory);

  await b.page.waitForTimeout(600);
  const bNeverReceivedYet = await b.page.evaluate(() => !APP.messages[APP.currentChatId]?.some(m => m.text === 'mensagem enviada offline'));
  console.log('B ainda NÃO recebeu nada (a mensagem não saiu de A de verdade):', bNeverReceivedYet);

  // --- Confirma que fica mesmo persistida em localStorage (não só em memória). ---
  const persistedRaw = await a.page.evaluate((phone) => localStorage.getItem('chatapp_offline_queue_' + phone), a.phone);
  const persisted = !!persistedRaw && JSON.parse(persistedRaw).some(item => item.previewText === 'mensagem enviada offline');
  console.log('A mensagem por enviar fica guardada em localStorage (sobrevive a recarregar a página):', persisted);

  // --- Simula o que um recarregar real da página faz: limpa o estado em
  // memória e usa as MESMAS funções que enterApp()/room_history chamam para
  // restaurar a fila a partir do localStorage. ---
  const restoredAfterSimulatedReload = await a.page.evaluate((chatId) => {
    APP.messages[chatId] = APP.messages[chatId].filter(m => m.text !== 'mensagem enviada offline');
    loadOfflineQueueFromStorage();
    appendPendingOfflineMessages(chatId);
    const msg = APP.messages[chatId].find(m => m.text === 'mensagem enviada offline');
    return !!msg && msg.pending === true;
  }, await a.page.evaluate(() => APP.currentChatId));
  console.log('E a lógica de restauro (a mesma usada num recarregar real) traz a mensagem de volta, ainda pendente:', restoredAfterSimulatedReload);
  await a.page.evaluate(() => renderMessages());
  const stillShowsAfterReload = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML.includes('mensagem enviada offline'));
  console.log('E continua visível na conversa:', stillShowsAfterReload);

  // --- Reconecta: a mensagem tem de ser enviada a sério e chegar a B. ---
  await a.page.evaluate(() => socket.connect());
  await a.page.waitForFunction(() => socket.connected, null, { timeout: 8000 });
  await a.page.waitForTimeout(600);

  const bannerHiddenAfterReconnect = await a.page.evaluate(() => document.getElementById('offlineBanner').style.display === 'none');
  console.log('O banner "Sem ligação" desaparece ao reconectar:', bannerHiddenAfterReconnect);

  const queueEmptiedAfterFlush = await a.page.evaluate(() => APP.offlineQueue.length === 0);
  console.log('A fila fica vazia depois de reconectar (mensagem enviada de verdade):', queueEmptiedAfterFlush);

  const localMsgNoLongerPending = await a.page.evaluate(() => {
    const msg = APP.messages[APP.currentChatId]?.find(m => m.text === 'mensagem enviada offline');
    return msg && msg.pending !== true;
  });
  console.log('A mensagem deixa de estar marcada como pendente:', localMsgNoLongerPending);

  await b.page.waitForFunction(() => APP.messages[APP.currentChatId]?.some(m => m.text === 'mensagem enviada offline'), null, { timeout: 8000 });
  console.log('B recebe mesmo a mensagem depois da ligação voltar:', true);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
