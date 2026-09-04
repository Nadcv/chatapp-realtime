const { chromium } = require('playwright');

// Testa o sistema de "Conquistas/gamificação" — os badges são desbloqueados e
// persistidos no SERVIDOR (não recalculados do histórico local, ao contrário
// das "Minhas estatísticas"), por isso a maior parte destes cenários testa o
// mecanismo diretamente via socket.emit (o mesmo caminho que a UI real usa
// por baixo), o que evita ter de simular 100 mensagens ou 10 chamadas reais
// através da interface.
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Badge Tester');
  await page.fill('#regUsername', 'badges_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'badges' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  const noBadgesAtStart = await page.evaluate(() => (APP.badges || []).length === 0);
  console.log('Conta nova começa sem nenhuma conquista:', noBadgesAtStart);

  // --- 1. "Primeira conversa" — cria um grupo (público, torna-se conversa ativa) e envia uma mensagem real pela UI. ---
  const groupName = 'Grupo Badges ' + ts;
  await page.click('button[onclick="openContactsFeaturesModal()"]');
  await page.waitForSelector('#modalContactsFeatures.active');
  await page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await page.waitForSelector('#modalCreateGroup.active');
  await page.fill('#groupName', groupName);
  await page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await page.waitForTimeout(500);
  console.log('Conquista "Fundador" desbloqueada ao criar o primeiro grupo:', await page.evaluate(() => (APP.badges || []).includes('first_group')));

  await page.click(`.chat-item:has-text("${groupName}")`);
  await page.waitForTimeout(300);
  await page.fill('#messageInput', 'Primeira mensagem de teste');
  await page.click('button[onclick="sendMessage()"]');
  await page.waitForTimeout(500);
  console.log('Conquista "Primeira conversa" desbloqueada ao enviar a primeira mensagem:', await page.evaluate(() => (APP.badges || []).includes('first_message')));
  const toastAppeared = await page.evaluate(() => document.body.innerText.includes('Conquista desbloqueada'));
  console.log('Aparece um aviso (toast) na tela quando desbloqueia uma conquista:', toastAppeared);

  // --- 2. "Organizador" — cria uma comunidade. ---
  await page.click('button[onclick="openContactsFeaturesModal()"]');
  await page.click('#modalContactsFeatures button:has-text("Comunidades")');
  await page.waitForSelector('#modalCommunities.active');
  await page.click('button:has-text("Criar comunidade")');
  await page.waitForSelector('#modalCreateCommunity.active');
  await page.fill('#communityNameInput', 'Comunidade Badges ' + ts);
  await page.click('#modalCreateCommunity button:has-text("Criar")');
  await page.waitForTimeout(600);
  console.log('Conquista "Organizador" desbloqueada ao criar a primeira comunidade:', await page.evaluate(() => (APP.badges || []).includes('first_community')));
  await page.evaluate(() => { closeModal('modalCommunities'); });

  // --- 3. "Organizado" — regista uma despesa no grupo. ---
  await page.click(`.chat-item:has-text("${groupName}")`);
  await page.waitForTimeout(300);
  await page.evaluate(() => openAddExpenseForm());
  await page.waitForSelector('#modalAddExpense.active');
  await page.waitForTimeout(300);
  await page.fill('#expenseDescription', 'Despesa de teste');
  await page.fill('#expenseAmount', '10');
  await page.evaluate(() => submitExpense());
  await page.waitForTimeout(500);
  console.log('Conquista "Organizado" desbloqueada ao registar a primeira despesa:', await page.evaluate(() => (APP.badges || []).includes('first_expense')));

  // --- 4. "Jogador" — inicia um jogo (função direta, sem precisar de um adversário real). ---
  await page.evaluate(() => startNewGameMessage({ type: 'tictactoe', board: Array(9).fill(null), players: [APP.user.phone, '+000000000'], turn: 'X', winner: null }));
  await page.waitForTimeout(500);
  console.log('Conquista "Jogador" desbloqueada ao iniciar o primeiro jogo:', await page.evaluate(() => (APP.badges || []).includes('first_game')));

  // --- 5. Meta-badge "Colecionador" — ao atingir 5 conquistas normais, desbloqueia-se sozinho. ---
  // Nota: a mensagem real enviada pela UI usa a hora ATUAL do relógio do
  // ambiente — se por acaso for de madrugada, "Coruja" desbloqueia também
  // "de borla" aqui (comportamento correto, não um bug do teste), o que pode
  // adiantar o Colecionador para antes dos 5 marcos intencionais. Por isso a
  // verificação é a invariante em si (>=5 não-colecionador ⇔ colecionador
  // presente), nunca um número de conquistas fixo — o mesmo cuidado já usado
  // nesta suite para os GTFS que dependem da hora real (ver README).
  const badgesSoFar = await page.evaluate(() => APP.badges || []);
  const nonCollectorCount = badgesSoFar.filter(b => b !== 'collector').length;
  console.log('Pelo menos os 5 marcos intencionais já foram desbloqueados:', nonCollectorCount >= 5);
  console.log('Meta-conquista "Colecionador" aparece exatamente quando atinge 5+ conquistas normais:', (nonCollectorCount >= 5) === badgesSoFar.includes('collector'));

  // --- 6. "Primeira chamada" e "Sempre em linha" — via socket.emit direto (mesmo caminho do call_log_entry real). ---
  await page.evaluate(() => socket.emit('call_log_entry', { peerPhone: '+351900000001', peerName: 'Alguém', type: 'voice', direction: 'outgoing', status: 'answered', durationSec: 42 }));
  await page.waitForTimeout(400);
  console.log('Conquista "Primeira chamada" desbloqueada após uma chamada atendida:', await page.evaluate(() => (APP.badges || []).includes('first_call')));
  for (let i = 0; i < 9; i++) {
    await page.evaluate(() => socket.emit('call_log_entry', { peerPhone: '+351900000001', peerName: 'Alguém', type: 'voice', direction: 'outgoing', status: 'answered', durationSec: 10 }));
  }
  await page.waitForTimeout(500);
  console.log('Conquista "Sempre em linha" desbloqueada ao completar 10 chamadas:', await page.evaluate(() => (APP.badges || []).includes('calls_10')));

  // --- 7. Uma chamada perdida/recusada NÃO conta para as conquistas. ---
  const missedCallDoesNotCount = await page.evaluate(async () => {
    const before = (APP.badges || []).length;
    socket.emit('call_log_entry', { peerPhone: '+351900000002', peerName: 'Alguém', type: 'voice', direction: 'incoming', status: 'missed', durationSec: 0 });
    await new Promise(r => setTimeout(r, 400));
    return (APP.badges || []).length === before;
  });
  console.log('Uma chamada perdida/recusada não desbloqueia conquistas:', missedCallDoesNotCount);

  // --- 8. "Coruja" — mensagem fabricada com hora de madrugada (evita depender do relógio real). ---
  await page.evaluate(() => {
    socket.emit('send_message', { id: 'night_owl_test_' + Date.now(), chatId: APP.currentChatId, sender: APP.user.name, senderPhone: APP.user.phone, text: 'mensagem de madrugada', time: '02:30' });
  });
  await page.waitForTimeout(500);
  console.log('Conquista "Coruja" desbloqueada com uma mensagem às 2h30:', await page.evaluate(() => (APP.badges || []).includes('night_owl')));

  // --- 9. "Tagarela" — 100 mensagens (via socket.emit em loop, rápido e sem UI). ---
  await page.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      socket.emit('send_message', { id: 'bulk_' + Date.now() + '_' + i, chatId: APP.currentChatId, sender: APP.user.name, senderPhone: APP.user.phone, text: 'msg ' + i, time: '15:00' });
    }
    await new Promise(r => setTimeout(r, 1500));
  });
  console.log('Conquista "Tagarela" desbloqueada ao atingir 100 mensagens:', await page.evaluate(() => (APP.badges || []).includes('messages_100')));

  // --- 10. A grelha de conquistas em "Minhas estatísticas" mostra desbloqueadas vs. por desbloquear. ---
  await page.evaluate(() => openMyStatsModal());
  await page.waitForSelector('#modalMyStats.active');
  await page.waitForTimeout(200);
  const gridHtml = await page.evaluate(() => document.getElementById('myBadgesContent').innerHTML);
  console.log('A grelha mostra o título de uma conquista já desbloqueada ("Fundador"):', gridHtml.includes('Fundador'));
  console.log('A grelha também lista uma conquista ainda por desbloquear ("Fotógrafo", 50 fotos):', gridHtml.includes('Fotógrafo'));
  const photographerLocked = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#myBadgesContent > div')];
    const card = cards.find(c => c.textContent.includes('Fotógrafo'));
    return card ? card.style.opacity === '0.35' : null;
  });
  console.log('A conquista ainda não desbloqueada ("Fotógrafo") aparece esbatida (não a cores):', photographerLocked === true);

  // --- 11. Persiste depois de recarregar a página (não é recalculado do histórico local). ---
  await page.reload();
  await page.waitForTimeout(1000);
  const persistedAfterReload = await page.evaluate(() => (APP.badges || []).includes('first_group') && (APP.badges || []).includes('collector'));
  console.log('As conquistas persistem depois de recarregar a página (vêm do servidor):', persistedAfterReload);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
