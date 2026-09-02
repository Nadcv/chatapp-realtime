const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  pageA.on('pageerror', err => console.log('PAGE EXCEPTION A:', err.message));

  async function register(page, name, prefix) {
    await page.goto('http://localhost:3000');
    await page.click('.login-switch');
    const ts = Date.now() + Math.floor(Math.random() * 100000);
    await page.fill('#regName', name);
    await page.fill('#regUsername', prefix + ts);
    await page.fill('#regPhone', '+3510' + ts.toString().slice(-8));
    await page.selectOption('#regCountry', 'Portugal');
    await page.fill('#regEmail', prefix + ts + '@test.com');
    await page.fill('#regPassword', 'senha1234forte');
    await page.click('button:has-text("Criar conta")');
    await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  }
  await register(pageA, 'Topics A', 'topA_');
  await register(pageB, 'Topics B', 'topB_');

  // Real group both join, with a mix of untagged and tagged prior messages.
  const groupName = 'Grupo Topicos ' + Date.now();
  await pageA.evaluate((name) => { socket.emit('create_group', { name }); }, groupName);
  await pageA.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  await pageB.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  const groupId = await pageA.evaluate((name) => APP.groupsList.find(g => g.name === name).id, groupName);
  await pageA.evaluate((gid) => { APP.currentChatId = gid; socket.emit('join_room', { chatId: gid }); }, groupId);
  await pageB.evaluate((gid) => { APP.currentChatId = gid; socket.emit('join_room', { chatId: gid }); }, groupId);
  await pageA.waitForTimeout(300);
  await pageA.evaluate(() => { openChat(APP.currentChatId); });
  await pageA.waitForTimeout(200);

  // --- Chip bar hidden for a non-group chat (Gemini), shown for the group ---
  await pageA.evaluate(() => openChat('gemini_assistant'));
  await pageA.waitForTimeout(200);
  const hiddenForAi = await pageA.evaluate(() => document.getElementById('topicChipsBar').style.display === 'none');
  console.log('Barra de tópicos escondida numa conversa que não é grupo:', hiddenForAi);

  await pageA.evaluate((gid) => openChat(gid), groupId);
  await pageA.waitForTimeout(200);
  const shownForGroup = await pageA.evaluate(() => document.getElementById('topicChipsBar').style.display === 'flex');
  console.log('Barra de tópicos aparece num grupo:', shownForGroup);
  const onlyTudoChipInitially = await pageA.evaluate(() => document.getElementById('topicChipsBar').textContent.includes('Tudo') && !document.getElementById('topicChipsBar').textContent.includes('Logística'));
  console.log('Só mostra "Tudo" e "Novo tópico" quando não há mensagens com tópico ainda:', onlyTudoChipInitially);

  // --- Send an untagged message first (default "Tudo" behaviour unaffected) ---
  await pageA.fill('#messageInput', 'Mensagem geral sem topico');
  await pageA.press('#messageInput', 'Enter');
  await pageA.waitForTimeout(300);

  // --- Create a new topic and send a message into it ---
  await pageA.evaluate(() => {
    window.prompt = () => 'Logística';
    promptNewTopic();
  });
  await pageA.waitForTimeout(200);
  const emptyTopicState = await pageA.evaluate(() => document.getElementById('chatMessages').textContent.includes('Ainda não há mensagens no tópico'));
  console.log('Ao criar um tópico novo (ainda vazio), mostra o estado vazio certo:', emptyTopicState);

  await pageA.fill('#messageInput', 'Precisamos de reservar o autocarro');
  await pageA.press('#messageInput', 'Enter');
  await pageA.waitForTimeout(500);

  const chipAppeared = await pageA.evaluate(() => document.getElementById('topicChipsBar').textContent.includes('Logística'));
  console.log('O chip do novo tópico aparece depois da primeira mensagem nele:', chipAppeared);
  const msgTaggedLocally = await pageA.evaluate(() => APP.messages[APP.currentChatId].some(m => m.text === 'Precisamos de reservar o autocarro' && m.topic === 'Logística'));
  console.log('A mensagem enviada fica marcada com o tópico ativo:', msgTaggedLocally);

  // --- Switch back to "Tudo": both messages visible ---
  await pageA.evaluate(() => selectTopic(null));
  await pageA.waitForTimeout(200);
  const bothVisibleInTudo = await pageA.evaluate(() => {
    const t = document.getElementById('chatMessages').textContent;
    return t.includes('Mensagem geral sem topico') && t.includes('Precisamos de reservar o autocarro');
  });
  console.log('Em "Tudo" vêem-se as mensagens de todos os tópicos (e sem tópico):', bothVisibleInTudo);
  const topicBadgeShownInTudo = await pageA.evaluate(() => document.getElementById('chatMessages').textContent.includes('🗂️ Logística'));
  console.log('Em "Tudo", a mensagem do tópico mostra a etiqueta do tópico:', topicBadgeShownInTudo);

  // --- Filter to just "Logística": only that message shows ---
  await pageA.evaluate(() => selectTopic(encodeURIComponent('Logística')));
  await pageA.waitForTimeout(200);
  const onlyLogisticaShown = await pageA.evaluate(() => {
    const t = document.getElementById('chatMessages').textContent;
    return t.includes('Precisamos de reservar o autocarro') && !t.includes('Mensagem geral sem topico');
  });
  console.log('Filtrar por "Logística" esconde as mensagens sem esse tópico:', onlyLogisticaShown);

  // --- B receives the topic field too (not just a client-side illusion) ---
  await pageB.waitForTimeout(500);
  const bSeesTopic = await pageB.evaluate(() => (APP.messages[APP.currentChatId] || []).some(m => m.text === 'Precisamos de reservar o autocarro' && m.topic === 'Logística'));
  console.log('B (outro socket real) recebe o tópico da mensagem via receive_message:', bSeesTopic);

  // --- XSS safety in topic name ---
  await pageA.evaluate(() => selectTopic(null));
  await pageA.evaluate(() => {
    window.prompt = () => '<img src=x onerror=alert(1)>';
    promptNewTopic();
  });
  await pageA.fill('#messageInput', 'mensagem em topico malicioso');
  await pageA.press('#messageInput', 'Enter');
  await pageA.waitForTimeout(400);
  await pageA.evaluate(() => selectTopic(null));
  await pageA.waitForTimeout(200);
  const xssSafeChip = await pageA.evaluate(() => !document.getElementById('topicChipsBar').innerHTML.includes('<img src=x onerror'));
  const xssSafeBadge = await pageA.evaluate(() => !document.getElementById('chatMessages').innerHTML.includes('<img src=x onerror'));
  console.log('XSS-safe: nome malicioso de tópico é escapado no chip:', xssSafeChip);
  console.log('XSS-safe: nome malicioso de tópico é escapado na etiqueta da mensagem:', xssSafeBadge);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
