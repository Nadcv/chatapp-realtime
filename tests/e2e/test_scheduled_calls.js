const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3511' + ts.toString().slice(-8);
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
  const a = await register(ctxA, 'Sched Call A', 'schedA_');
  const b = await register(ctxB, 'Sched Call B', 'schedB_');

  const usernameB = await b.page.evaluate(() => APP.user.username);
  await a.page.evaluate((uname) => {
    document.getElementById('modalSearchUser').classList.add('active');
    document.getElementById('searchUsernameInput').value = uname;
  }, usernameB);
  await a.page.evaluate(() => doSearchUser());
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => {
    const btn = [...document.querySelectorAll('#searchUserResult button')].find(b => b.textContent.includes('conversa'));
    if (btn) btn.click();
  });
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => {
    const items = [...document.querySelectorAll('.chat-item')];
    items.reverse().find(el => el.textContent.includes('Sched Call B'))?.click();
  });
  await a.page.waitForTimeout(300);
  const chatId = await a.page.evaluate(() => APP.currentChatId);

  // B needs to have joined the room too, for the live scheduled_call_due
  // delivery to reach it (server delivers by phone via deliverToPhone, which
  // works regardless of room-join — this join is just so B can see the DM
  // chat card normally, matching real usage).
  await b.page.evaluate((cid) => { socket.emit('join_room', { chatId: cid }); }, chatId);
  await b.page.waitForTimeout(300);

  // --- Estado vazio ---
  await a.page.evaluate(() => openScheduleCallModal());
  await a.page.waitForSelector('#modalScheduleCall.active', { timeout: 3000 });
  const emptyShown = await a.page.evaluate(() => document.getElementById('scheduledCallsList').textContent.includes('Ainda não há'));
  console.log('Estado vazio mostrado quando não há chamadas agendadas:', emptyShown);

  // --- Validação: sem data / data no passado ---
  page_dialog(a.page);
  await a.page.evaluate(() => submitScheduleCall());
  await a.page.waitForTimeout(200);
  await a.page.fill('#scheduleCallDatetimeInput', '2020-01-01T10:00');
  page_dialog(a.page);
  await a.page.evaluate(() => submitScheduleCall());
  await a.page.waitForTimeout(200);
  const noCallScheduledYet = await a.page.evaluate(() => (SCHEDULED_CALLS[APP.currentChatId] || []).length === 0);
  console.log('Nenhuma chamada foi agendada a partir das tentativas inválidas:', noCallScheduledYet);

  // --- Agendar de verdade ---
  await a.page.evaluate(() => {
    const d = new Date(Date.now() + 3600000);
    const pad = (n) => String(n).padStart(2, '0');
    document.getElementById('scheduleCallDatetimeInput').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  await a.page.selectOption('#scheduleCallTypeSelect', 'video');
  await a.page.evaluate(() => submitScheduleCall());
  await a.page.waitForTimeout(500);
  const scheduled = await a.page.evaluate(() => (SCHEDULED_CALLS[APP.currentChatId] || []).length === 1);
  console.log('Chamada agendada com sucesso e sincronizada do servidor:', scheduled);
  const listShowsIt = await a.page.evaluate(() => document.getElementById('scheduledCallsList').textContent.includes('🎥'));
  console.log('Lista mostra a chamada de vídeo agendada:', listShowsIt);

  // --- Cancelar ---
  const callId = await a.page.evaluate(() => SCHEDULED_CALLS[APP.currentChatId][0].id);
  await a.page.evaluate((id) => cancelScheduledCall(id), callId);
  await a.page.waitForTimeout(500);
  const cancelled = await a.page.evaluate(() => (SCHEDULED_CALLS[APP.currentChatId] || []).length === 0);
  console.log('Cancelar uma chamada agendada funciona:', cancelled);

  // --- Server-side firing: agenda para daqui a poucos segundos (o servidor
  // rejeita agendar no passado, tal como o cliente) e espera o intervalo
  // periódico de 20s apanhá-la como "vencida". ---
  await a.page.evaluate((data) => {
    socket.emit('schedule_call', { chatId: data.chatId, callType: 'voice', scheduledAt: Date.now() + 3000, toPhone: data.bPhone });
  }, { chatId, bPhone: b.phone });

  await a.page.waitForTimeout(25000); // dá tempo ao intervalo de 20s do servidor

  const aGotAlert = await a.page.evaluate(() => document.getElementById('modalScheduledCallAlert').classList.contains('active'));
  console.log('A (quem agendou) recebe o alerta de "hora da chamada":', aGotAlert);
  const bGotAlert = await b.page.evaluate(() => document.getElementById('modalScheduledCallAlert').classList.contains('active'));
  console.log('B (a outra pessoa) TAMBÉM recebe o alerta (não só quem agendou):', bGotAlert);
  const alertMentionsVoice = await a.page.evaluate(() => document.getElementById('scheduledCallAlertText').textContent.includes('voz'));
  console.log('Alerta menciona corretamente "chamada de voz":', alertMentionsVoice);

  // --- Tap "Iniciar chamada" leva ao fluxo normal de startCall ---
  await a.page.evaluate(() => startScheduledCallNow());
  await a.page.waitForTimeout(500);
  const callScreenActive = await a.page.evaluate(() => document.getElementById('callScreen').classList.contains('active'));
  console.log('"Iniciar chamada" abre o ecrã de chamada normal (mesmo fluxo de sempre):', callScreenActive);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });

function page_dialog(page) {
  page.once('dialog', d => d.accept());
}
