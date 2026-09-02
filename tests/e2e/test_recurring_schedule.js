const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Recurring Test');
  await page.fill('#regUsername', 'recur_' + ts);
  await page.fill('#regPhone', '+3511' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'recur' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.chats.push({ id: 'recurchat', type: 'user', name: 'Recur Contact', phone: '+351944444444' });
    renderChatList();
  });
  await page.click('.chat-item:has-text("Recur Contact")');
  await page.waitForTimeout(300);

  // --- Part 1: the UI form actually wires the recurrence dropdown into the emitted
  // payload. Uses the existing "+1 hora" quick-time button (safely in the future, no
  // need to fight the datetime-local input's minute-level precision) and intercepts
  // the socket.emit call itself, rather than waiting for real dispatch.
  await page.evaluate(() => { window.__capturedEmit = null; const origEmit = socket.emit.bind(socket); socket.emit = (event, ...args) => { if (event === 'schedule_message') window.__capturedEmit = args[0]; return origEmit(event, ...args); }; });
  await page.evaluate(() => openScheduleModal());
  await page.waitForSelector('#modalScheduleMessage.active');
  await page.fill('#scheduleMsgText', 'Bom dia! (mensagem diária)');
  await page.click('button:has-text("+1 hora")');
  await page.selectOption('#scheduleRecurrenceSelect', 'daily');
  let savedConfirmMsg = '';
  page.once('dialog', d => { savedConfirmMsg = d.message(); d.accept(); });
  await page.click('#modalScheduleMessage button:has-text("Agendar")');
  await page.waitForTimeout(300);
  const capturedPayload = await page.evaluate(() => window.__capturedEmit);
  console.log('O formulário envia recurrence="daily" ao agendar com essa opção escolhida:', capturedPayload?.recurrence === 'daily');
  console.log('Confirmação ao agendar menciona a repetição diária:', savedConfirmMsg.includes('repete todos os dias'));

  // --- Also confirm "Não repetir" sends recurrence=null (regression: default case) ---
  await page.evaluate(() => openScheduleModal());
  await page.fill('#scheduleMsgText', 'Mensagem sem repetir (form)');
  await page.click('button:has-text("+1 hora")');
  page.once('dialog', d => d.accept());
  await page.click('#modalScheduleMessage button:has-text("Agendar")');
  await page.waitForTimeout(300);
  const oneShotPayload = await page.evaluate(() => window.__capturedEmit);
  console.log('Por padrão ("Não repetir"), envia recurrence=null:', oneShotPayload?.recurrence === null);

  // --- Part 2: real dispatch + recurrence rescheduling, driven directly via socket.emit
  // (bypassing the datetime-local input, which only has minute-level precision and isn't
  // suited to a few-seconds-in-the-future test).
  const originalSendAt = await page.evaluate(() => {
    const sendAt = Date.now() + 3000;
    socket.emit('schedule_message', { chatId: 'recurchat', text: 'Bom dia recorrente de verdade', sendAt, recurrence: 'daily' });
    return sendAt;
  });
  await page.evaluate(() => {
    const sendAt = Date.now() + 3000;
    socket.emit('schedule_message', { chatId: 'recurchat', text: 'Mensagem única de verdade', sendAt, recurrence: null });
  });
  await page.waitForTimeout(500);

  console.log('A aguardar o ciclo de despacho do servidor (~25s)...');
  await page.waitForTimeout(26000);

  const bothSentToChat = await page.evaluate(() => {
    const msgs = APP.messages['recurchat'] || [];
    return {
      recurring: msgs.some(m => m.text.includes('recorrente de verdade')),
      oneShot: msgs.some(m => m.text.includes('única de verdade'))
    };
  });
  console.log('A mensagem diária foi mesmo enviada para a conversa:', bothSentToChat.recurring);
  console.log('A mensagem única também foi enviada para a conversa:', bothSentToChat.oneShot);

  await page.evaluate(() => socket.emit('get_scheduled_messages'));
  await page.waitForTimeout(500);
  const afterDispatch = await page.evaluate(() => ({
    stillHasRecurring: APP.scheduledMessages.some(s => s.text.includes('recorrente de verdade')),
    stillHasOneShot: APP.scheduledMessages.some(s => s.text.includes('única de verdade'))
  }));
  console.log('A mensagem recorrente CONTINUA na lista de agendadas (reagendada, não removida):', afterDispatch.stillHasRecurring);
  console.log('A mensagem de envio único foi removida da lista depois de disparar (comportamento antigo preservado):', !afterDispatch.stillHasOneShot);

  const newSendAt = await page.evaluate(() => APP.scheduledMessages.find(s => s.text.includes('recorrente de verdade'))?.sendAt);
  const roughlyOneDayLater = newSendAt > originalSendAt + 23 * 60 * 60 * 1000 && newSendAt < originalSendAt + 25 * 60 * 60 * 1000;
  console.log('O próximo horário calculado é cerca de 24h depois do anterior:', roughlyOneDayLater);

  // --- The recurring-list view shows the "🔁 Repete todos os dias" label ---
  await page.evaluate(() => openScheduledList());
  await page.waitForTimeout(400);
  const listShowsRecurrenceLabel = await page.evaluate(() => document.getElementById('scheduledListContent').innerText.includes('Repete todos os dias'));
  console.log('A lista de agendadas mostra a etiqueta "🔁 Repete todos os dias":', listShowsRecurrenceLabel);

  // --- Cancelling a recurring entry removes it entirely (stops all future occurrences) ---
  const cancelButtons = page.locator('#scheduledListContent button:has-text("Cancelar")');
  const count = await cancelButtons.count();
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const rowText = await cancelButtons.nth(i).locator('xpath=../..').innerText();
    if (rowText.includes('recorrente de verdade')) { await cancelButtons.nth(i).click(); clicked = true; break; }
  }
  await page.waitForTimeout(300);
  const cancelledForGood = clicked && await page.evaluate(() => !APP.scheduledMessages.some(s => s.text.includes('recorrente de verdade')));
  console.log('Cancelar uma mensagem recorrente remove-a por completo (não só a próxima ocorrência):', cancelledForGood);

  // --- XSS safety: a scheduled message with malicious text is escaped in the list ---
  await page.evaluate(() => {
    APP.scheduledMessages.push({ id: 'xsstest', chatId: 'recurchat', text: '<img src=x onerror=alert(1)>', sendAt: Date.now() + 999999, recurrence: null });
  });
  await page.evaluate(() => openScheduledList());
  await page.waitForTimeout(400);
  const xssSafe = await page.evaluate(() => !document.getElementById('scheduledListContent').innerHTML.includes('<img src=x'));
  console.log('XSS-safe: texto malicioso na lista de agendadas é escapado:', xssSafe);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
