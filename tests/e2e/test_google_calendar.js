const { chromium } = require('playwright');

// Sincronização bidirecional do calendário de grupo com o Google Calendar
// (ver server.js, secção "GOOGLE CALENDAR"): liga a conta (OAuth2 completo,
// via mock_google_calendar_server.js na porta 3027, que simula
// accounts.google.com + oauth2.googleapis.com + www.googleapis.com/calendar/v3
// tudo num único servidor), ativa a sincronização num grupo, e confirma os
// dois sentidos — app cria evento → aparece na Google (via GET /__test/calendars
// do mock); alguém cria um evento diretamente na Google (via POST
// /__test/inject-event do mock) → aparece na app.
async function getMockCalendars() {
  const res = await fetch('http://127.0.0.1:3027/__test/calendars');
  return res.json();
}

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3518' + ts.toString().slice(-8);
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
  const ctx = await browser.newContext();
  const { page } = await register(ctx, 'Google Cal Tester', 'gcal_it_');

  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

  // --- Cria um grupo para testar a sincronização. ---
  const groupName = 'Grupo Google Calendar ' + Date.now();
  await page.click('button[onclick="openContactsFeaturesModal()"]');
  await page.waitForSelector('#modalContactsFeatures.active');
  await page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await page.waitForSelector('#modalCreateGroup.active');
  await page.fill('#groupName', groupName);
  await page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await page.waitForTimeout(500);
  await page.click(`.chat-item:has-text("${groupName}")`);
  await page.waitForTimeout(300);

  // --- Antes de ligar o Google: o calendário do grupo pede para ligar a conta primeiro. ---
  await page.click('button[onclick="openChatMoreModal()"]');
  await page.waitForSelector('#modalChatMore.active');
  await page.click('#groupCalendarBtn');
  await page.waitForSelector('#modalGroupCalendar.active');
  await page.waitForTimeout(300);
  const promptsToConnectFirst = await page.evaluate(() => document.getElementById('groupCalendarGoogleSyncBox').textContent.includes('Liga o Google Calendar'));
  console.log('Sem conta Google ligada, pede para ligar primeiro no perfil:', promptsToConnectFirst);
  await page.evaluate(() => closeModal('modalGroupCalendar'));

  // --- Liga a conta Google (fluxo OAuth2 completo através do mock). ---
  await page.click('#headerAvatar');
  await page.waitForSelector('#modalProfile.active');
  const showsConnectButton = await page.evaluate(() => document.getElementById('googleCalendarProfileBox').innerHTML.includes('connectGoogleCalendar'));
  console.log('Perfil mostra o botão para ligar o Google Calendar:', showsConnectButton);
  await page.click('button:has-text("🔗 Ligar ao Google Calendar")');
  // Navegação real: /api/google-calendar/connect -> mock (accounts.google.com)
  // -> /api/google-calendar/callback -> volta para "/". Espera terminar em "/".
  await page.waitForURL(/^http:\/\/localhost:3000\/(\?.*)?$/, { timeout: 8000 });
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(800);
  console.log('Depois do OAuth, a app mostra um aviso de sucesso:', dialogs.some(m => m.includes('ligada')));
  const urlCleanedUp = await page.evaluate(() => !location.search.includes('gcal'));
  console.log('O "?gcal=connected" é removido do URL depois de tratado:', urlCleanedUp);

  // A navegação para o OAuth e de volta recarrega a página inteira (perde-se
  // todo o estado JS, incluindo o modal aberto) — reabre o perfil para ver o
  // novo estado já refletido (ver 'google_calendar_get_status' em enterApp()).
  await page.click('#headerAvatar');
  await page.waitForSelector('#modalProfile.active');
  const showsConnectedState = await page.evaluate(() => document.getElementById('googleCalendarProfileBox').innerHTML.includes('disconnectGoogleCalendar'));
  console.log('Perfil passa a mostrar "Conta Google ligada" com opção de desligar:', showsConnectedState);
  await page.evaluate(() => closeModal('modalProfile'));

  // --- Ativa a sincronização deste grupo. ---
  await page.click(`.chat-item:has-text("${groupName}")`);
  await page.waitForTimeout(300);
  await page.click('button[onclick="openChatMoreModal()"]');
  await page.waitForSelector('#modalChatMore.active');
  await page.click('#groupCalendarBtn');
  await page.waitForSelector('#modalGroupCalendar.active');
  await page.waitForTimeout(300);
  await page.click('#groupCalendarSyncCheck');
  await page.waitForTimeout(500);
  const checkboxStaysChecked = await page.evaluate(() => document.getElementById('groupCalendarSyncCheck').checked);
  console.log('A caixa de sincronização fica marcada depois de ativar:', checkboxStaysChecked);

  let mockCalendars = await getMockCalendars();
  let calendarIds = Object.keys(mockCalendars);
  console.log('Ativar a sincronização cria um calendário dedicado na Google:', calendarIds.length === 1);
  const calendarId = calendarIds[0];
  console.log('O calendário dedicado tem o nome do grupo:', mockCalendars[calendarId]?.summary === `ChatApp: ${groupName}`);

  // --- Sentido app -> Google: criar um evento na app espelha-o no Google Calendar. ---
  const futureDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await page.click('button:has-text("➕ Novo evento")');
  await page.waitForSelector('#modalAddGroupEvent.active');
  await page.fill('#groupEventTitleInput', 'Reunião mensal');
  await page.fill('#groupEventDateInput', futureDate);
  await page.click('#modalAddGroupEvent button:has-text("Adicionar")');
  await page.waitForTimeout(500);
  mockCalendars = await getMockCalendars();
  const googleEvents = Object.values(mockCalendars[calendarId]?.events || {});
  console.log('Evento criado na app aparece no Google Calendar (mock):', googleEvents.some(e => e.summary === 'Reunião mensal'));

  // --- Sentido Google -> app: um evento criado diretamente na Google aparece na app. ---
  await fetch('http://127.0.0.1:3027/__test/inject-event', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ calendarId, summary: 'Criado direto na Google', date: futureDate })
  });
  // Reabrir o calendário do grupo dispara 'group_event_get', que puxa novidades da Google.
  await page.evaluate(() => closeModal('modalGroupCalendar'));
  await page.evaluate(() => openGroupCalendarModal());
  await page.waitForSelector('#modalGroupCalendar.active');
  await page.waitForTimeout(600);
  const googleCreatedEventShowsInApp = await page.evaluate(() => document.getElementById('groupCalendarList').textContent.includes('Criado direto na Google'));
  console.log('Evento criado diretamente na Google aparece na app depois de reabrir o calendário:', googleCreatedEventShowsInApp);

  // --- Apagar na app remove também do Google Calendar. ---
  // O id do evento é gerado dinamicamente, por isso apaga-se pelo texto do
  // cartão em vez de tentar montar um seletor CSS com o onclick exato.
  const deleteClicked = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#groupCalendarList > div')];
    const card = cards.find(c => c.textContent.includes('Reunião mensal'));
    const btn = card?.querySelector('button.btn-danger');
    if (btn) { btn.click(); return true; }
    return false;
  });
  await page.waitForTimeout(500);
  console.log('Conseguiu clicar em apagar o evento "Reunião mensal":', deleteClicked);
  mockCalendars = await getMockCalendars();
  const remainingEvents = Object.values(mockCalendars[calendarId]?.events || {});
  console.log('Depois de apagado na app, o evento desaparece também do Google Calendar (mock):', !remainingEvents.some(e => e.summary === 'Reunião mensal'));

  // --- Desligar a conta Google. ---
  await page.evaluate(() => closeModal('modalGroupCalendar'));
  await page.click('#headerAvatar');
  await page.waitForSelector('#modalProfile.active');
  await page.click('button:has-text("Desligar Google Calendar")');
  await page.waitForTimeout(300);
  const showsDisconnectedAgain = await page.evaluate(() => document.getElementById('googleCalendarProfileBox').innerHTML.includes('connectGoogleCalendar'));
  console.log('Depois de desligar, o perfil volta a mostrar o botão de ligar:', showsDisconnectedAgain);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
