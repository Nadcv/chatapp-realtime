const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3517' + ts.toString().slice(-8);
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

  const a = await register(ctxA, 'Thread A', 'thread_a_');
  const b = await register(ctxB, 'Thread B', 'thread_b_');

  const groupName = 'Grupo Threads ' + Date.now();
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  await a.page.fill('#groupName', groupName);
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await a.page.waitForTimeout(600);

  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);
  await a.page.fill('#messageInput', 'Alguém sabe a que horas é o jantar de sábado?');
  await a.page.press('#messageInput', 'Enter');
  await a.page.waitForTimeout(400);

  await b.page.click(`.chat-item:has-text("${groupName}")`);
  await b.page.waitForTimeout(500);

  // --- B replies directly to A's message (thread reply, not a normal message) ---
  await b.page.hover('.message.received');
  await b.page.click('.message.received button[title="Responder"]');
  await b.page.waitForTimeout(150);
  const replyBarShows = await b.page.evaluate(() => document.getElementById('replyPreviewBar').style.display === 'flex');
  console.log('Ao responder, mostra a barra com a citação da mensagem original:', replyBarShows);
  await b.page.fill('#messageInput', 'Acho que é às 20h!');
  await b.page.press('#messageInput', 'Enter');
  await a.page.waitForTimeout(500);

  // --- A sees the reply quote inline, AND a "🧵 1 resposta" thread indicator under the original ---
  const inlineQuoteShown = await a.page.evaluate(() => document.getElementById('chatMessages').innerText.includes('Acho que é às 20h!') && document.getElementById('chatMessages').innerText.includes('Alguém sabe a que horas'));
  console.log('A vê a resposta com a citação em linha na conversa:', inlineQuoteShown);
  const threadBadgeShown = await a.page.evaluate(() => document.getElementById('chatMessages').innerText.includes('🧵 1 resposta'));
  console.log('Aparece a etiqueta "🧵 1 resposta" por baixo da mensagem original:', threadBadgeShown);

  // --- A opens the thread view — sees original + the one reply ---
  const originalMsgId = await a.page.evaluate(() => {
    const el = [...document.querySelectorAll('.message')].find(m => m.innerText.includes('Alguém sabe a que horas'));
    return el?.dataset.msgId;
  });
  await a.page.evaluate((id) => openThread(id), originalMsgId);
  await a.page.waitForSelector('#modalThread.active');
  const threadShowsOriginal = await a.page.evaluate(() => document.getElementById('threadOriginal').innerText.includes('Alguém sabe a que horas'));
  console.log('A vista da thread mostra a mensagem original no topo:', threadShowsOriginal);
  const threadShowsReply = await a.page.evaluate(() => document.getElementById('threadReplies').innerText.includes('Acho que é às 20h!'));
  console.log('A vista da thread mostra a resposta de B:', threadShowsReply);

  // --- A replies from WITHIN the thread view ---
  await a.page.fill('#threadReplyInput', 'Perfeito, aviso o resto do grupo!');
  await a.page.click('#modalThread button:has-text("Enviar")');
  await a.page.waitForTimeout(500);
  const threadNowShowsBothReplies = await a.page.evaluate(() => {
    const t = document.getElementById('threadReplies').innerText;
    return t.includes('Acho que é às 20h!') && t.includes('Perfeito, aviso o resto do grupo!');
  });
  console.log('Responder dentro da thread junta-se às respostas anteriores (2 no total):', threadNowShowsBothReplies);
  await a.page.click('#modalThread button:has-text("Fechar")');
  const threadCountUpdated = await a.page.evaluate(() => document.getElementById('chatMessages').innerText.includes('🧵 2 respostas'));
  console.log('A contagem de respostas na conversa principal atualiza para 2:', threadCountUpdated);

  // --- B (the other group member) also sees the thread reply count live via receive_message ---
  await b.page.waitForTimeout(500);
  const bSeesThreadCount = await b.page.evaluate(() => document.getElementById('chatMessages').innerText.includes('🧵 2 respostas'));
  console.log('B também vê a contagem de respostas em tempo real:', bSeesThreadCount);

  // --- A reply sent from the thread does NOT clutter the main chat timeline as a separate visible-by-default duplicate concern ---
  // (it's still a normal message in the timeline, WhatsApp-style, just also linked into the thread — sanity check it appears exactly once)
  const replyAppearsOnceInMainTimeline = await a.page.evaluate(() => {
    const matches = [...document.querySelectorAll('#chatMessages .message')].filter(m => m.innerText.includes('Perfeito, aviso o resto do grupo!'));
    return matches.length === 1;
  });
  console.log('A resposta enviada pela thread aparece exatamente uma vez na conversa principal:', replyAppearsOnceInMainTimeline);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
