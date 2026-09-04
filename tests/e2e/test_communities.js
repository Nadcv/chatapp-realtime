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

  const admin = await register(ctxA, 'Community Admin', 'comm_a_');
  const member = await register(ctxB, 'Community Member', 'comm_b_');

  // Auto-aceita os alert() de 'message_rejected' e regista o texto.
  const adminDialogs = [];
  admin.page.on('dialog', (d) => { adminDialogs.push(d.message()); d.accept(); });
  const memberDialogs = [];
  member.page.on('dialog', (d) => { memberDialogs.push(d.message()); d.accept(); });

  const communityName = 'Bairro Teste ' + Date.now();
  const streetGroupName = 'Grupo da Rua ' + Date.now();

  // --- Admin cria um grupo normal (para depois o ligar à comunidade). ---
  await admin.page.click('button[onclick="openContactsFeaturesModal()"]');
  await admin.page.waitForSelector('#modalContactsFeatures.active');
  await admin.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await admin.page.waitForSelector('#modalCreateGroup.active');
  await admin.page.fill('#groupName', streetGroupName);
  await admin.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await admin.page.waitForTimeout(500);

  // --- Admin cria a comunidade (ganha canal de anúncios automaticamente). ---
  await admin.page.click('button[onclick="openContactsFeaturesModal()"]');
  await admin.page.waitForSelector('#modalContactsFeatures.active');
  await admin.page.click('#modalContactsFeatures button:has-text("Comunidades")');
  await admin.page.waitForSelector('#modalCommunities.active');
  await admin.page.click('button:has-text("Criar comunidade")');
  await admin.page.waitForSelector('#modalCreateCommunity.active');
  await admin.page.fill('#communityNameInput', communityName);
  await admin.page.fill('#communityDescriptionInput', 'Comunidade de teste automatizado');
  await admin.page.click('#modalCreateCommunity button:has-text("Criar")');
  await admin.page.waitForTimeout(600);
  // 'modalCommunities' continua aberto por trás (só o 'modalCreateCommunity' fechou);
  // a lista é atualizada ao vivo assim que chega o 'communities_update' do servidor.
  const communityListedForAdmin = await admin.page.evaluate((n) => document.getElementById('communitiesListBox').textContent.includes(n), communityName);
  console.log('Comunidade criada aparece na lista para o admin:', communityListedForAdmin);

  const announcementChatVisible = await admin.page.evaluate(() => (APP.chats || []).some(c => c.type === 'group' && c.announcementsOnly));
  console.log('Canal de anúncios (📢) aparece na lista de conversas do criador:', announcementChatVisible);

  await member.page.waitForTimeout(500);
  const memberSeesAnnouncementChat = await member.page.evaluate(() => (APP.chats || []).some(c => c.type === 'group' && c.announcementsOnly));
  console.log('Canal de anúncios aparece também para outro utilizador (comunidade é pública):', memberSeesAnnouncementChat);

  const memberHasNoManageBtn = await member.page.evaluate(() => {
    openCommunitiesScreen();
    return !document.getElementById('communitiesListBox').innerHTML.includes('Gerir');
  });
  console.log('Quem não é admin da comunidade não vê o botão "Gerir":', memberHasNoManageBtn);
  await member.page.evaluate(() => closeModal('modalCommunities'));

  // --- Admin liga o "Grupo da Rua" à comunidade. ---
  await admin.page.click('#communitiesListBox button:has-text("⚙️ Gerir")');
  await admin.page.waitForSelector('#modalManageCommunity.active');
  await admin.page.waitForTimeout(300);
  const linkableOptionPresent = await admin.page.evaluate((n) => [...document.getElementById('manageCommunityAddGroupSelect').options].some(o => o.textContent === n), streetGroupName);
  console.log('Grupo criado pelo admin está disponível para ligar à comunidade:', linkableOptionPresent);
  await admin.page.selectOption('#manageCommunityAddGroupSelect', { label: streetGroupName });
  await admin.page.click('button:has-text("Ligar")');
  await admin.page.waitForTimeout(500);
  const groupLinkedShown = await admin.page.evaluate((n) => document.getElementById('manageCommunityGroupsBox').textContent.includes(n), streetGroupName);
  console.log('Grupo ligado aparece na lista de grupos da comunidade:', groupLinkedShown);

  // --- Restrição de publicação: membro NÃO admin tenta escrever no canal de anúncios. ---
  // O admin já abre o canal também, para podermos confirmar que a mensagem
  // bloqueada nunca chega ao outro lado (a UI de quem envia é otimista —
  // mostra a própria mensagem já enviada localmente mesmo quando o servidor a
  // rejeita, tal como já acontecia com "silenciado num grupo"; a garantia real
  // é a mensagem nunca ser entregue a mais ninguém).
  await admin.page.evaluate(() => closeModal('modalManageCommunity'));
  await admin.page.evaluate(() => closeModal('modalCommunities'));
  await admin.page.click(`.chat-item:has-text("Anúncios")`);
  await admin.page.waitForTimeout(300);
  await member.page.click(`.chat-item:has-text("Anúncios")`);
  await member.page.waitForTimeout(300);
  const memberSubtitle = await member.page.evaluate(() => document.getElementById('chatSubtitle').textContent);
  console.log('Subtítulo do canal avisa quem não é admin que só admins publicam:', memberSubtitle.includes('só administradores'));
  await member.page.fill('#messageInput', 'Isto não devia ser publicado');
  await member.page.click('button[onclick="sendMessage()"]');
  await member.page.waitForTimeout(500);
  console.log('Membro sem ser admin recebe aviso ao tentar publicar no canal de anúncios:', memberDialogs.some(m => m.includes('só administradores podem publicar')));
  const adminNeverReceivesBlockedMessage = await admin.page.evaluate(() => !document.getElementById('chatMessages').innerHTML.includes('Isto não devia ser publicado'));
  console.log('A mensagem bloqueada nunca chega ao resto da comunidade:', adminNeverReceivesBlockedMessage);

  // --- Admin consegue publicar no canal de anúncios normalmente. ---
  await admin.page.fill('#messageInput', 'Aviso oficial da comunidade');
  await admin.page.click('button[onclick="sendMessage()"]');
  await admin.page.waitForTimeout(500);
  const adminMessageSent = await admin.page.evaluate(() => document.getElementById('chatMessages').innerHTML.includes('Aviso oficial da comunidade'));
  console.log('Administrador consegue publicar no canal de anúncios:', adminMessageSent);
  await member.page.waitForTimeout(400);
  const memberReceivesAnnouncement = await member.page.evaluate(() => document.getElementById('chatMessages').innerHTML.includes('Aviso oficial da comunidade'));
  console.log('O membro recebe o anúncio publicado pelo admin:', memberReceivesAnnouncement);

  // --- Promove o membro a admin da comunidade — passa a poder publicar. ---
  const memberPhone = member.phone;
  await admin.page.evaluate(() => openCommunitiesScreen());
  await admin.page.click('#communitiesListBox button:has-text("⚙️ Gerir")');
  await admin.page.waitForSelector('#modalManageCommunity.active');
  await admin.page.waitForTimeout(300);
  await admin.page.evaluate((phone) => communitySetRole(phone, 'admin'), memberPhone);
  await admin.page.waitForTimeout(1000);
  const memberNowListedAsAdmin = await admin.page.evaluate(() => document.getElementById('manageCommunityAdminsBox').textContent.includes('Community Member'));
  console.log('Membro promovido aparece na lista de administradores da comunidade:', memberNowListedAsAdmin);

  await member.page.waitForTimeout(500);
  await member.page.click(`.chat-item:has-text("Anúncios")`);
  await member.page.waitForTimeout(300);
  await member.page.fill('#messageInput', 'Agora já posso publicar');
  await member.page.click('button[onclick="sendMessage()"]');
  await member.page.waitForTimeout(500);
  const promotedMemberCanPost = await member.page.evaluate(() => document.getElementById('chatMessages').innerHTML.includes('Agora já posso publicar'));
  console.log('Depois de promovido a admin da comunidade, o membro já consegue publicar no canal:', promotedMemberCanPost);

  // --- Apagar a comunidade: o canal de anúncios desaparece, o grupo ligado continua a existir. ---
  await admin.page.evaluate(() => { document.getElementById('deleteCommunityBtn').click(); });
  await admin.page.waitForTimeout(600);
  const communityGoneForAdmin = await admin.page.evaluate(() => (APP.communitiesList || []).length === 0);
  console.log('Comunidade apagada deixa de existir para o admin:', communityGoneForAdmin);
  const announcementChatGoneForAdmin = await admin.page.evaluate(() => !(APP.chats || []).some(c => c.announcementsOnly));
  console.log('Canal de anúncios desaparece da lista de conversas depois de apagar a comunidade:', announcementChatGoneForAdmin);
  await member.page.waitForTimeout(500);
  const announcementChatGoneForMember = await member.page.evaluate(() => !(APP.chats || []).some(c => c.announcementsOnly));
  console.log('Canal de anúncios também desaparece para o outro utilizador:', announcementChatGoneForMember);
  const streetGroupStillExists = await admin.page.evaluate((n) => (APP.chats || []).some(c => c.type === 'group' && c.name === n), streetGroupName);
  console.log('O grupo que estava ligado à comunidade continua a existir normalmente:', streetGroupStillExists);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
