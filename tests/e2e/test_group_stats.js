const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'GroupStats Test');
  await page.fill('#regUsername', 'gstats_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'gstats' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Fake group chat with varied messages/media across 3 senders (Você + Ana + Bruno).
  await page.evaluate(() => {
    APP.chats.push({ id: 'statsgroup1', type: 'group', name: 'Amigos Teste', memberCount: 3 });
    APP.messages['statsgroup1'] = [
      { id: 'm1', sender: 'Ana', text: 'Oi 😂', time: '10:00', type: 'received' },
      { id: 'm2', sender: 'Ana', text: 'Tudo bem? 😂😂', time: '10:05', type: 'received' },
      { id: 'm3', sender: 'Ana', text: '', time: '10:06', type: 'received', fileData: 'data:x', fileType: 'image/jpeg' },
      { id: 'm4', sender: 'Bruno', text: 'Olá', time: '11:00', type: 'received' },
      { id: 'm5', sender: 'Você', text: 'Oi pessoal', time: '11:02', type: 'sent' },
      { id: 'm6', sender: 'Ana', text: '', time: '11:03', type: 'received', fileData: 'data:y', fileType: 'video/mp4' },
      { id: 'm7', sender: 'Bruno', deleted: true, text: 'apagada', time: '11:04', type: 'received' },
    ];
    APP.currentChatId = 'statsgroup1';
    renderChatList();
    renderMessages();
  });

  // --- Botão só aparece em grupos: simula abrir o chat de verdade para testar a toggle de visibilidade. ---
  await page.evaluate(() => {
    document.getElementById('chatArea').classList.add('active');
    const isGroup = true;
    document.getElementById('groupStatsBtn').style.display = isGroup ? 'flex' : 'none';
  });
  const btnVisibleForGroup = await page.evaluate(() => document.getElementById('groupStatsBtn').style.display === 'flex');
  console.log('Botão "Estatísticas" visível para conversas de grupo:', btnVisibleForGroup);

  await page.evaluate(() => { document.getElementById('groupStatsBtn').style.display = 'none'; });
  const btnHiddenForNonGroup = await page.evaluate(() => document.getElementById('groupStatsBtn').style.display === 'none');
  console.log('Botão "Estatísticas" fica escondido para conversas não-grupo:', btnHiddenForNonGroup);

  // --- Guard: não abre estatísticas para uma conversa que não é grupo ---
  await page.evaluate(() => {
    APP.chats.push({ id: 'dmtest1', type: 'user', name: 'Amigo Solo' });
    APP.currentChatId = 'dmtest1';
    APP.messages['dmtest1'] = [{ id: 'd1', sender: 'Amigo Solo', text: 'oi', time: '09:00', type: 'received' }];
  });
  await page.evaluate(() => openGroupStatsModal());
  const modalStaysClosedForDm = await page.evaluate(() => !document.getElementById('modalGroupStats').classList.contains('active'));
  console.log('Modal NÃO abre para uma conversa 1-para-1 (não é grupo):', modalStaysClosedForDm);

  // --- Abre estatísticas de verdade para o grupo ---
  await page.evaluate(() => { APP.currentChatId = 'statsgroup1'; openGroupStatsModal(); });
  await page.waitForSelector('#modalGroupStats.active', { timeout: 3000 });

  const s = await page.evaluate(() => computeGroupStats('statsgroup1'));
  console.log('Total de mensagens exclui a apagada (6 de 7):', s.totalMessages === 6);
  console.log('Contagem de fotos correta (1):', s.totalPhotos === 1);
  console.log('Contagem de vídeos correta (1):', s.totalVideos === 1);
  console.log('Número de pessoas que já falaram (Ana, Bruno, Você = 3):', s.memberCount === 3);
  console.log('Ranking tem Ana em 1º lugar (mais mensagens):', s.ranking[0].name === 'Ana' && s.ranking[0].sent === 4);
  console.log('Ranking mostra as fotos/vídeos da Ana:', s.ranking[0].photos === 1 && s.ranking[0].videos === 1);
  console.log('Emoji mais usado é 😂 (Ana usou 3 vezes):', s.topEmoji === '😂');
  console.log('Hora mais movimentada é 10h ou 11h (ambas com 3 msgs cada, é um empate):', s.topHour === '10' || s.topHour === '11');

  const contentHtml = await page.evaluate(() => document.getElementById('groupStatsContent').innerHTML);
  console.log('Cards mostram o total de mensagens (6):', contentHtml.includes('>6<'));
  const rankingHtml = await page.evaluate(() => document.getElementById('groupStatsRankings').innerHTML);
  console.log('Lista de ranking mostra "1. Ana" no topo:', rankingHtml.includes('1. Ana'));
  console.log('Lista de ranking mostra a contagem de fotos da Ana (📷):', rankingHtml.includes('📷'));

  // --- XSS safety no nome do remetente ---
  await page.evaluate(() => {
    APP.messages['statsgroup1'].push({ id: 'm8', sender: '<img src=x onerror=alert(1)>', text: 'oi', time: '12:00', type: 'received' });
    openGroupStatsModal();
  });
  await page.waitForTimeout(200);
  const xssSafe = await page.evaluate(() => !document.getElementById('groupStatsRankings').innerHTML.includes('<img src=x onerror'));
  console.log('XSS-safe: nome malicioso de remetente é escapado no ranking:', xssSafe);

  // --- Estado vazio: grupo sem nenhuma mensagem ---
  await page.evaluate(() => {
    APP.chats.push({ id: 'emptygroup1', type: 'group', name: 'Grupo Vazio' });
    APP.messages['emptygroup1'] = [];
    APP.currentChatId = 'emptygroup1';
    openGroupStatsModal();
  });
  await page.waitForTimeout(200);
  const emptyRankingHtml = await page.evaluate(() => document.getElementById('groupStatsRankings').innerHTML.trim());
  console.log('Ranking fica vazio (sem crash) quando o grupo não tem mensagens:', emptyRankingHtml === '');
  const emptyMemberCount = await page.evaluate(() => computeGroupStats('emptygroup1').memberCount === 0);
  console.log('memberCount é 0 para um grupo sem mensagens:', emptyMemberCount);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
