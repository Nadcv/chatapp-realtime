const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3518' + ts.toString().slice(-8);
  const username = prefix + ts;
  await page.fill('#regName', name);
  await page.fill('#regUsername', username);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone, username };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await register(ctxA, 'Last A', 'last_a_');
  const b = await register(ctxB, 'Last B', 'last_b_');

  // Um jogo em tempo real só funciona entre contactos de verdade — o servidor
  // recusa silenciosamente a mensagem que cria o jogo se A e B não forem
  // contactos um do outro (isDmRoomAllowedForPhone em server.js), por isso
  // fabricar a conversa só do lado do cliente (como antes) nunca chegava a
  // criar o jogo no servidor. Em vez disso, A procura B pelo nome de
  // utilizador (o mesmo fluxo real de "Procurar utilizador"), o que trata
  // add_contact dos dois lados e abre a conversa automaticamente.
  await a.page.click('button[title="Grupos, chamadas e contactos"]');
  await a.page.click('#modalContactsFeatures button[onclick*="openSearchUserModal"]');
  await a.page.waitForSelector('#modalSearchUser.active');
  await a.page.fill('#searchUsernameInput', b.username);
  await a.page.click('button:has-text("Procurar")');
  await a.page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await a.page.click('#searchUserResult button:has-text("Iniciar conversa")');
  await a.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });
  await a.page.waitForTimeout(300);
  await a.page.click('#gamesBtn');
  await a.page.waitForSelector('#modalGameChooser.active');
  await a.page.click('button:has-text("Damas")');
  await a.page.waitForTimeout(400);

  async function clickCell(page, index) {
    await page.click(`#chatMessages div[data-cell="${index}"]`);
    await page.waitForTimeout(200);
  }

  // Before any move, no highlight should exist.
  const beforeMove = await a.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game).game.lastMove);
  console.log('No lastMove before any move:', beforeMove === undefined);

  await clickCell(a.page, 17);
  await clickCell(a.page, 26);
  await a.page.waitForTimeout(300);

  const afterMoveGame = await a.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game).game);
  console.log('lastMove recorded correctly on A:', afterMoveGame.lastMove?.from === 17 && afterMoveGame.lastMove?.to === 26);

  // B's chat with A only shows up once B's own contacts list is updated —
  // isso acontece automaticamente quando A lhe manda a primeira mensagem
  // (a que cria o jogo), não antes.
  await b.page.waitForSelector('.chat-item:has-text("Last A")', { timeout: 8000 });
  await b.page.click('.chat-item:has-text("Last A")');
  await b.page.waitForTimeout(500);
  const bGame = await b.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game).game);
  console.log('B also sees the same lastMove (via room_history):', bGame.lastMove?.from === 17 && bGame.lastMove?.to === 26);

  // Check the actual rendered highlight color on both cells for both users.
  const cell17StyleA = await a.page.evaluate(() => document.querySelector('div[data-cell="17"]').style.background);
  const cell26StyleA = await a.page.evaluate(() => document.querySelector('div[data-cell="26"]').style.background);
  const cell17StyleB = await b.page.evaluate(() => document.querySelector('div[data-cell="17"]').style.background);
  console.log('Cell 17 highlighted green on A:', cell17StyleA.includes('76, 175, 80'));
  console.log('Cell 26 highlighted green on A:', cell26StyleA.includes('76, 175, 80'));
  console.log('Cell 17 highlighted green on B too:', cell17StyleB.includes('76, 175, 80'));

  const legendVisible = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML.includes('última jogada'));
  console.log('Legend mentions "última jogada":', legendVisible);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
