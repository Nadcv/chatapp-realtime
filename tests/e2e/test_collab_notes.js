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

  const a = await register(ctxA, 'Notes Admin', 'note_a_');
  const b = await register(ctxB, 'Notes Member', 'note_b_');

  const groupName = 'Grupo Notas ' + Date.now();
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  await a.page.fill('#groupName', groupName);
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await a.page.waitForTimeout(500);

  // --- A escreve na nota partilhada do grupo. ---
  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);
  await a.page.click('button[onclick="openChatMoreModal()"]');
  await a.page.waitForSelector('#modalChatMore.active');
  await a.page.click('button[onclick*="openCollabNoteModal"]');
  await a.page.waitForSelector('#modalCollabNote.active');
  await a.page.waitForTimeout(300);
  const emptyAtStart = await a.page.evaluate(() => document.getElementById('collabNoteTextarea').value === '');
  console.log('A nota começa vazia:', emptyAtStart);
  await a.page.fill('#collabNoteTextarea', 'Lista de compras: pão, leite');
  await a.page.waitForTimeout(800); // espera o debounce (500ms) + o round-trip

  // --- B abre a mesma nota e já vê o que A escreveu. ---
  await b.page.click(`.chat-item:has-text("${groupName}")`);
  await b.page.waitForTimeout(300);
  await b.page.click('button[onclick="openChatMoreModal()"]');
  await b.page.waitForSelector('#modalChatMore.active');
  await b.page.click('button[onclick*="openCollabNoteModal"]');
  await b.page.waitForSelector('#modalCollabNote.active');
  await b.page.waitForTimeout(400);
  const bSeesAText = await b.page.evaluate(() => document.getElementById('collabNoteTextarea').value);
  console.log('B abre a nota e vê o que A escreveu:', bSeesAText === 'Lista de compras: pão, leite');
  const statusShowsAuthor = await b.page.evaluate(() => document.getElementById('collabNoteStatus').textContent.includes('Notes Admin'));
  console.log('Mostra quem foi a última pessoa a editar:', statusShowsAuthor);

  // --- A tem o textarea focado — uma atualização de B não lhe deve saltar o cursor. ---
  await a.page.click('#collabNoteTextarea');
  await a.page.evaluate(() => document.getElementById('collabNoteTextarea').setSelectionRange(999, 999));
  await b.page.fill('#collabNoteTextarea', 'Lista de compras: pão, leite, ovos');
  await b.page.waitForTimeout(800);
  const aTextUnchangedWhileFocused = await a.page.evaluate(() => document.getElementById('collabNoteTextarea').value);
  console.log('Enquanto A está a escrever, o texto de A não é substituído pela atualização de B:', aTextUnchangedWhileFocused === 'Lista de compras: pão, leite');

  // --- Ao sair do campo (blur), A recebe finalmente a atualização pendente de B. ---
  await a.page.evaluate(() => document.getElementById('collabNoteTextarea').blur());
  await a.page.waitForTimeout(300);
  const aTextUpdatedAfterBlur = await a.page.evaluate(() => document.getElementById('collabNoteTextarea').value);
  console.log('Depois de sair do campo, A recebe a versão mais recente de B:', aTextUpdatedAfterBlur === 'Lista de compras: pão, leite, ovos');

  // --- Funciona também numa conversa 1-para-1 (não é exclusivo de grupos). ---
  await a.page.evaluate(() => closeModal('modalCollabNote'));
  await a.page.evaluate(() => {
    APP.chats.push({ id: 'fakedm_notes_test', type: 'user', name: 'Alguém', phone: '+000' });
    APP.messages['fakedm_notes_test'] = [];
  });
  await a.page.evaluate(() => openChat('fakedm_notes_test'));
  await a.page.waitForTimeout(200);
  await a.page.click('button[onclick="openChatMoreModal()"]');
  await a.page.waitForSelector('#modalChatMore.active');
  const collabBtnVisibleInDm = await a.page.evaluate(() => {
    const btn = [...document.querySelectorAll('#modalChatMore button')].find(b => (b.getAttribute('onclick') || '').includes('openCollabNoteModal'));
    return !!btn && getComputedStyle(btn).display !== 'none';
  });
  console.log('O botão de notas partilhadas também aparece numa conversa 1-para-1:', collabBtnVisibleInDm);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
