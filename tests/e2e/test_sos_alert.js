const { chromium } = require('playwright');

// Testa o botão de "SOS/Emergência": escolher contactos de confiança (só
// entre contactos reais), disparar o alerta com localização, e confirmar
// que chega ao outro lado mesmo que essa pessoa NUNCA tenha aberto essa
// conversa antes (o cenário mais realista de um alerta de emergência — a
// pessoa pode nunca ter falado contigo antes de a escolheres como confiança).
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  await ctxA.grantPermissions(['geolocation']);
  await ctxA.setGeolocation({ latitude: 38.7169, longitude: -9.1399 }); // Lisboa
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();

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

  const a = await register(ctxA, 'SOS Sender', 'sos_a_');
  const b = await register(ctxB, 'SOS Trusted', 'sos_b_');
  const c = await register(ctxC, 'SOS Lonely', 'sos_c_');

  const aDialogs = [];
  a.page.on('dialog', (d) => { aDialogs.push(d.message()); d.accept(); });
  const cDialogs = [];
  c.page.on('dialog', (d) => { cDialogs.push(d.message()); d.accept(); });

  // --- A encontra B pela pesquisa e "Inicia conversa" — B passa a ser CONTACTO real de A
  // (mas A NUNCA passa a ser contacto de B por este caminho — só unilateral). ---
  const bUsername = await b.page.evaluate(() => APP.user.username);
  await a.page.evaluate(() => openSearchUserModal());
  await a.page.fill('#searchUsernameInput', bUsername);
  await a.page.evaluate(() => doSearchUser());
  await a.page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await a.page.click('button:has-text("Iniciar conversa")');
  await a.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });

  const bIsAContactBeforeSos = await b.page.evaluate((aPhone) => (APP.onlineContacts || []).some(x => x.phone === aPhone), a.phone);
  console.log('Antes do SOS, B ainda NÃO tem A como contacto (é unilateral):', !bIsAContactBeforeSos);

  // --- A escolhe B como contacto de confiança. ---
  await a.page.click('button[onclick="openMoreFeaturesModal()"]');
  await a.page.waitForSelector('#modalMoreFeatures.active');
  await a.page.click('button[onclick*="openSosModal"]');
  await a.page.waitForSelector('#modalSos.active');
  const bListedAsTrustable = await a.page.evaluate((name) => document.getElementById('sosTrustedContactsBox').textContent.includes(name), 'SOS Trusted');
  console.log('B (contacto real de A) aparece na lista de possíveis contactos de confiança:', bListedAsTrustable);
  await a.page.check('.sos-trusted-checkbox');
  await a.page.click('button:has-text("Guardar contactos de confiança")');
  await a.page.waitForTimeout(400);
  const savedStatusText = await a.page.evaluate(() => document.getElementById('sosStatus').textContent);
  console.log('Confirma que guardou 1 contacto de confiança:', savedStatusText.includes('1 contacto'));

  // --- A dispara o alerta de SOS (com localização mockada). ---
  await a.page.click('#sosTriggerBtn');
  await a.page.waitForTimeout(1200);
  console.log('Pede confirmação antes de disparar o alerta:', aDialogs.some(m => m.includes('Enviar um alerta de SOS')));
  const aResultText = await a.page.evaluate(() => document.getElementById('sosStatus').textContent);
  console.log('Confirma no ecrã de A que o alerta foi enviado a 1 contacto:', aResultText.includes('enviado a 1'));

  // --- B recebe o alerta mesmo NUNCA tendo aberto essa conversa antes. ---
  await b.page.waitForTimeout(800);
  const bannerText = await b.page.evaluate(() => document.body.innerText);
  console.log('Aparece um banner de emergência no ecrã de B com o nome de A:', bannerText.includes('SOS Sender') && bannerText.includes('alerta de emergência'));
  const mapsHref = await b.page.evaluate(() => {
    const links = [...document.querySelectorAll('a')].filter(a => a.href.includes('google.com/maps'));
    return links.length ? links[links.length - 1].href : null;
  });
  console.log('O link "Ver no mapa" aponta para as coordenadas certas:', mapsHref && mapsHref.includes('38.71') && mapsHref.includes('-9.13'));

  const bNowHasAAsContact = await b.page.evaluate((aPhone) => (APP.onlineContacts || []).some(x => x.phone === aPhone), a.phone);
  console.log('Depois do SOS, B passou a ter A como contacto automaticamente:', bNowHasAAsContact);

  // Abre a conversa com A (deve já existir na lista de B) e confirma o estilo da mensagem de alerta.
  await b.page.click('.chat-item:has-text("SOS Sender")');
  await b.page.waitForTimeout(300);
  const alertBubbleHtml = await b.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('A mensagem de alerta aparece com o estilo especial de emergência na conversa:', alertBubbleHtml.includes('Alerta de emergência') && alertBubbleHtml.includes('#c0392b'));

  // --- C nunca configurou contactos de confiança — tentar disparar dá um aviso claro. ---
  await c.page.click('button[onclick="openMoreFeaturesModal()"]');
  await c.page.waitForSelector('#modalMoreFeatures.active');
  await c.page.click('button[onclick*="openSosModal"]');
  await c.page.waitForSelector('#modalSos.active');
  await c.page.click('#sosTriggerBtn');
  await c.page.waitForTimeout(300);
  console.log('Sem contactos de confiança configurados, mostra um aviso claro em vez de disparar:', cDialogs.some(m => m.includes('Escolhe pelo menos um')));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
