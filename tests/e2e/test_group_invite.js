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
  const ctxC = await browser.newContext();

  const a = await register(ctxA, 'Invite Admin', 'ginv_a_');
  const b = await register(ctxB, 'Invite Guest', 'ginv_b_');
  const c = await register(ctxC, 'Invite Stranger', 'ginv_c_'); // never gets the link

  const groupName = 'Grupo Privado ' + Date.now();
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  await a.page.fill('#groupName', groupName);
  await a.page.check('#groupPrivateInput');
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await a.page.waitForTimeout(600);

  // --- Creator sees the private group; a bystander who was never invited does NOT ---
  const aSeesGroup = await a.page.evaluate((name) => document.body.innerText.includes(name), groupName);
  console.log('Quem criou o grupo privado vê-o na lista:', aSeesGroup);
  await c.page.waitForTimeout(400);
  const cSeesGroup = await c.page.evaluate((name) => document.body.innerText.includes(name), groupName);
  console.log('Um estranho (nunca convidado) NÃO vê o grupo privado:', !cSeesGroup);

  // --- Creator opens "Gerir grupo" and gets an invite link + QR ---
  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);
  await a.page.click('button[onclick="openChatMoreModal()"]');
  await a.page.waitForSelector('#modalChatMore.active');
  await a.page.click('#manageGroupBtn');
  await a.page.waitForSelector('#modalManageGroup.active');
  await a.page.waitForTimeout(500);
  const inviteUrl = await a.page.evaluate(() => document.querySelector('#groupInviteContent input')?.value || null);
  console.log('É gerado um link de convite para o grupo privado:', !!inviteUrl && inviteUrl.includes('joinGroup='));
  const hasQr = await a.page.evaluate(() => !!document.querySelector('#groupInviteContent img')?.src?.startsWith('data:image'));
  console.log('É mostrado um QR code (gerado no servidor) junto do link:', hasQr);

  const inviteToken = new URL(inviteUrl).searchParams.get('joinGroup');

  // --- Stranger who was never invited still cannot send messages / join_room into the private group id directly ---
  const strangerBlocked = await c.page.evaluate((groupId) => new Promise((resolve) => {
    let historyReceived = false;
    socket.once('room_history', (data) => { if (data.chatId === groupId) historyReceived = true; });
    socket.emit('join_room', { chatId: groupId });
    setTimeout(() => resolve(!historyReceived), 600);
  }), (await a.page.evaluate(() => APP.currentChatId)));
  console.log('Um estranho não consegue entrar na sala do grupo privado só por adivinhar o id:', strangerBlocked);

  // --- B (guest) opens the invite link directly (simulating clicking it while already logged in) ---
  await b.page.goto(`http://localhost:3000/?joinGroup=${inviteToken}`);
  await b.page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await b.page.waitForTimeout(1200);
  const bJoinedAndOpened = await b.page.evaluate((name) => APP.currentChatId && document.getElementById('chatName').textContent === name, groupName);
  console.log('B abre o link de convite e entra automaticamente no grupo (já com sessão ativa):', bJoinedAndOpened);
  const bSeesGroupAfterReload = await b.page.evaluate((name) => document.body.innerText.includes(name), groupName);
  console.log('O grupo privado passa a aparecer na lista de conversas de B:', bSeesGroupAfterReload);

  // --- A (admin) can now see B in "Gerir grupo" even though B is not a contact of A ---
  await a.page.click('#modalManageGroup button:has-text("Fechar")');
  await a.page.waitForTimeout(200);
  await a.page.click('button[onclick="openChatMoreModal()"]');
  await a.page.waitForSelector('#modalChatMore.active');
  await a.page.click('#manageGroupBtn');
  await a.page.waitForSelector('#modalManageGroup.active');
  await a.page.waitForTimeout(400);
  const rosterShowsB = await a.page.evaluate(() => document.getElementById('manageGroupList').innerText.includes('Invite Guest'));
  console.log('O administrador vê o novo membro na gestão do grupo, mesmo sem ser seu contacto:', rosterShowsB);

  // --- B can send messages in the private group now ---
  await b.page.fill('#messageInput', 'Olá, entrei pelo convite!');
  await b.page.press('#messageInput', 'Enter');
  await a.page.waitForTimeout(500);
  const aReceivedMsg = await a.page.evaluate(() => document.getElementById('chatMessages').innerText.includes('Olá, entrei pelo convite!'));
  console.log('A mensagem de B (que entrou por convite) chega a A normalmente:', aReceivedMsg);

  // --- A regenerates the invite link — the OLD token must stop working ---
  await a.page.click('button:has-text("Gerar novo link")');
  await a.page.waitForTimeout(500);
  const newInviteUrl = await a.page.evaluate(() => document.querySelector('#groupInviteContent input')?.value || null);
  console.log('Gerar novo link produz um token diferente do anterior:', newInviteUrl && newInviteUrl !== inviteUrl);

  const oldTokenNowRejected = await c.page.evaluate(async (inviteToken) => {
    const res = await fetch('/api/group-invite/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': APP.token },
      body: JSON.stringify({ token: APP.token, inviteToken })
    });
    return res.status;
  }, inviteToken);
  console.log('O link antigo (já substituído) deixa de funcionar:', oldTokenNowRejected === 404);

  // --- Kicking a member removes them from the private group (memberPhones cleanup) ---
  a.page.once('dialog', d => d.accept());
  await a.page.evaluate(() => {
    const btn = [...document.querySelectorAll('#manageGroupList button')].find(b => b.title === 'Remover do grupo');
    btn?.click();
  });
  await a.page.waitForTimeout(800);
  // Nota: o cabeçalho da conversa ainda aberta em B pode continuar a mostrar o nome antigo
  // (fechar automaticamente o ecrã de uma conversa da qual se foi expulso já é um
  // comportamento anterior a esta funcionalidade, também presente nos grupos abertos —
  // fora do âmbito aqui). O que importa verificar é a lista de conversas em si.
  const bLostAccess = await b.page.evaluate((name) => {
    const stillInSidebar = [...document.querySelectorAll('#chatList h4')].some(el => el.textContent.includes(name));
    const stillInState = APP.chats.some(c => c.name === name);
    return !stillInSidebar && !stillInState;
  }, groupName);
  console.log('Depois de removido, o grupo privado desaparece da lista de B ao vivo:', bLostAccess);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
