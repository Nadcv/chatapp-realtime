const { chromium } = require('playwright');

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
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  const a = await register(ctxA, 'Calendar Admin', 'gcal_a_');
  const b = await register(ctxB, 'Calendar Member', 'gcal_b_');

  const aDialogs = [];
  a.page.on('dialog', (d) => { aDialogs.push(d.message()); d.accept(); });

  const groupName = 'Grupo Calendario ' + Date.now();
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  await a.page.fill('#groupName', groupName);
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await a.page.waitForTimeout(500);

  // --- O botão "Calendário" só aparece para grupos, nunca para DMs. ---
  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);
  const calendarBtnVisibleForGroup = await a.page.evaluate(() => document.getElementById('groupCalendarBtn').style.display === 'flex');
  console.log('Botão "Calendário" aparece para um grupo:', calendarBtnVisibleForGroup);

  await a.page.evaluate(() => {
    APP.chats.push({ id: 'fakedm_calendar_test', type: 'user', name: 'Alguém', phone: '+000' });
    APP.messages['fakedm_calendar_test'] = [];
  });
  await a.page.evaluate(() => openChat('fakedm_calendar_test'));
  await a.page.waitForTimeout(200);
  const calendarBtnHiddenForDm = await a.page.evaluate(() => document.getElementById('groupCalendarBtn').style.display === 'none');
  console.log('Botão "Calendário" fica escondido numa conversa 1-para-1:', calendarBtnHiddenForDm);

  // --- A abre o calendário do grupo (vazio) e adiciona um evento. ---
  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);
  await a.page.click('button[onclick="openChatMoreModal()"]');
  await a.page.waitForSelector('#modalChatMore.active');
  await a.page.click('#groupCalendarBtn');
  await a.page.waitForSelector('#modalGroupCalendar.active');
  await a.page.waitForTimeout(300);
  const emptyStateShown = await a.page.evaluate(() => document.getElementById('groupCalendarList').textContent.includes('Ainda não há nenhum evento'));
  console.log('Estado vazio mostrado quando ainda não há eventos:', emptyStateShown);

  // Validação: sem título/data não deixa avançar.
  await a.page.click('button:has-text("➕ Novo evento")');
  await a.page.waitForSelector('#modalAddGroupEvent.active');
  await a.page.click('#modalAddGroupEvent button:has-text("Adicionar")');
  await a.page.waitForTimeout(200);
  console.log('Pede um título antes de adicionar o evento:', aDialogs.some(m => m.includes('título')));

  const futureDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await a.page.fill('#groupEventTitleInput', 'Jantar de equipa');
  await a.page.fill('#groupEventDateInput', futureDate);
  await a.page.fill('#groupEventDescriptionInput', 'Traz uma sobremesa');
  await a.page.click('#modalAddGroupEvent button:has-text("Adicionar")');
  await a.page.waitForTimeout(500);
  const eventListedForA = await a.page.evaluate(() => document.getElementById('groupCalendarList').textContent.includes('Jantar de equipa'));
  console.log('Evento adicionado aparece na lista do criador:', eventListedForA);
  const descriptionShown = await a.page.evaluate(() => document.getElementById('groupCalendarList').textContent.includes('Traz uma sobremesa'));
  console.log('Descrição do evento é mostrada:', descriptionShown);
  const creatorCanDelete = await a.page.evaluate(() => document.getElementById('groupCalendarList').innerHTML.includes('deleteGroupEvent'));
  console.log('Quem criou o evento vê o botão de apagar:', creatorCanDelete);

  // --- B (membro comum, não admin nem criador do evento) também vê o evento, mas sem poder apagá-lo. ---
  await b.page.click(`.chat-item:has-text("${groupName}")`);
  await b.page.waitForTimeout(300);
  await b.page.click('button[onclick="openChatMoreModal()"]');
  await b.page.waitForSelector('#modalChatMore.active');
  await b.page.click('#groupCalendarBtn');
  await b.page.waitForSelector('#modalGroupCalendar.active');
  await b.page.waitForTimeout(500);
  const eventListedForB = await b.page.evaluate(() => document.getElementById('groupCalendarList').textContent.includes('Jantar de equipa'));
  console.log('O evento aparece também para outro membro do grupo:', eventListedForB);
  const memberCannotDelete = await b.page.evaluate(() => !document.getElementById('groupCalendarList').innerHTML.includes('deleteGroupEvent'));
  console.log('Um membro comum (não criador nem admin) NÃO vê o botão de apagar:', memberCannotDelete);

  // --- A apaga o evento — desaparece ao vivo dos dois lados. ---
  await a.page.click('button[onclick*="deleteGroupEvent"]');
  await a.page.waitForTimeout(500);
  const eventGoneForA = await a.page.evaluate(() => !document.getElementById('groupCalendarList').textContent.includes('Jantar de equipa'));
  console.log('Depois de apagado, o evento desaparece da lista do criador:', eventGoneForA);
  await b.page.waitForTimeout(500);
  const eventGoneForB = await b.page.evaluate(() => !document.getElementById('groupCalendarList').textContent.includes('Jantar de equipa'));
  console.log('E desaparece ao vivo também para o outro membro (sem recarregar):', eventGoneForB);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
