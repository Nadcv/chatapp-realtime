const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3519' + ts.toString().slice(-8);
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

  const a = await register(ctxA, 'Hidden A', 'hpoll_a_');
  const b = await register(ctxB, 'Hidden B', 'hpoll_b_');
  const c = await register(ctxC, 'Hidden C', 'hpoll_c_');

  const groupName = 'Grupo Enquete Oculta ' + Date.now();
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  await a.page.fill('#groupName', groupName);
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await a.page.waitForTimeout(600);

  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);

  // A creates a poll with "hide results until I vote" checked.
  await a.page.click('#pollBtn');
  await a.page.waitForSelector('#modalCreatePoll.active');
  await a.page.fill('#pollQuestionInput', 'Qual é o melhor filme?');
  const optionInputs = await a.page.locator('.poll-option-input');
  await optionInputs.nth(0).fill('Matrix');
  await optionInputs.nth(1).fill('Inception');
  await a.page.check('#pollHideResultsInput');
  await a.page.click('#modalCreatePoll button:has-text("Criar")');
  await a.page.waitForTimeout(400);

  // A created it, so A hasn't voted yet either — results should be hidden for A too.
  const htmlA0 = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('Criador ainda não votou, resultados escondidos para A:', htmlA0.includes('aparecem depois de votares') && !htmlA0.includes('% ('));

  // B opens the group and votes on Matrix (index 0).
  await b.page.waitForTimeout(500);
  await b.page.click(`.chat-item:has-text("${groupName}")`);
  await b.page.waitForTimeout(500);
  const htmlB0 = await b.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('B vê a enquete escondida antes de votar (sem contagens):', htmlB0.includes('aparecem depois de votares') && !htmlB0.includes('% ('));

  await b.page.locator('#chatMessages .message div[onclick^="votePoll"]').nth(0).click();
  await b.page.waitForTimeout(400);
  const htmlB1 = await b.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('B vê os resultados reais assim que vota:', htmlB1.includes('1 voto') && htmlB1.includes('✓ Matrix'));

  // C opens the group but does NOT vote — should still see it hidden, even though B already voted.
  await c.page.waitForTimeout(300);
  await c.page.click(`.chat-item:has-text("${groupName}")`);
  await c.page.waitForTimeout(500);
  const htmlC0 = await c.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('C (ainda não votou) continua a não ver os resultados, mesmo já havendo 1 voto de B:', htmlC0.includes('aparecem depois de votares') && !htmlC0.includes('1 voto'));

  // Security check: C's raw socket payload must never carry B's real vote (not just hidden by CSS/JS).
  const cRawPollData = await c.page.evaluate(() => {
    const msgs = APP.messages[APP.currentChatId] || [];
    const pollMsg = msgs.find(m => m.poll);
    return pollMsg ? pollMsg.poll.options.map(o => o.votes.length) : null;
  });
  console.log('Payload em memória de C não contém a contagem real de votos (tudo a zero):', JSON.stringify(cRawPollData) === '[0,0]');

  // A (creator, still hasn't voted) should NOT see B's vote live either via poll_updated.
  const htmlA1 = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('A (criador, ainda não votou) continua sem ver o voto de B em tempo real:', htmlA1.includes('aparecem depois de votares') && !htmlA1.includes('1 voto'));

  // Now A votes on Inception (index 1) — should reveal full results to A (2 votes: B on Matrix, A on Inception).
  await a.page.locator('#chatMessages .message div[onclick^="votePoll"]').nth(1).click();
  await a.page.waitForTimeout(400);
  const htmlA2 = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('Depois de A votar, vê os resultados completos (2 votos):', htmlA2.includes('2 votos') && htmlA2.includes('✓ Inception'));

  // C reloads without voting — should still be hidden after a fresh room_history load too.
  await c.page.reload();
  await c.page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await c.page.click(`.chat-item:has-text("${groupName}")`);
  await c.page.waitForTimeout(500);
  const htmlC1 = await c.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('Depois de recarregar sem votar, C continua sem ver os resultados:', htmlC1.includes('aparecem depois de votares') && !htmlC1.includes('2 votos'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
