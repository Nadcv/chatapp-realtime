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

  const a = await register(ctxA, 'Poll A', 'poll_a_');
  const b = await register(ctxB, 'Poll B', 'poll_b_');

  const groupName = 'Grupo Enquete ' + Date.now();
  // The "Criar grupo" trigger now lives inside the 📇 menu.
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  await a.page.fill('#groupName', groupName);
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await a.page.waitForTimeout(600);

  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);

  const pollBtnVisible = await a.page.locator('#pollBtn').evaluate(el => getComputedStyle(el).display !== 'none');
  console.log('Poll button visible in a group chat:', pollBtnVisible);

  await a.page.click('#pollBtn');
  await a.page.waitForSelector('#modalCreatePoll.active');
  await a.page.fill('#pollQuestionInput', 'Onde jantamos? <script>');
  const optionInputs = await a.page.locator('.poll-option-input');
  await optionInputs.nth(0).fill('Pizza');
  await optionInputs.nth(1).fill('Sushi');
  await a.page.click('button:has-text("➕ Mais uma opção")');
  await a.page.locator('.poll-option-input').nth(2).fill('Massa');
  await a.page.click('#modalCreatePoll button:has-text("Criar")');
  await a.page.waitForTimeout(400);

  const pollHtmlA = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('Poll question rendered on A:', pollHtmlA.includes('Onde jantamos?'));
  console.log('Question escaped safely (no raw <script>):', !pollHtmlA.includes('<script>Onde'));
  console.log('3 options rendered on A:', pollHtmlA.includes('Pizza') && pollHtmlA.includes('Sushi') && pollHtmlA.includes('Massa'));

  // User B opens the same group (auto-visible to all registered users) and should see the poll via room_history.
  await b.page.waitForTimeout(500);
  await b.page.click(`.chat-item:has-text("${groupName}")`);
  await b.page.waitForTimeout(500);
  const pollHtmlB = await b.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('Poll visible on B via room_history:', pollHtmlB.includes('Onde jantamos?') && pollHtmlB.includes('Pizza'));

  // B votes on "Sushi" (index 1).
  const optionDivsB = b.page.locator('#chatMessages .message div[onclick^="votePoll"]');
  await optionDivsB.nth(1).click();
  await a.page.waitForTimeout(500);
  const afterBVoteA = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('A sees B\'s vote live (poll_updated broadcast), 1 voto total:', afterBVoteA.includes('1 voto') && afterBVoteA.includes('100%'));

  // A votes on "Pizza" (index 0) — now 2 total votes, 50/50.
  const optionDivsA = a.page.locator('#chatMessages .message div[onclick^="votePoll"]');
  await optionDivsA.nth(0).click();
  await a.page.waitForTimeout(400);
  const afterAVoteA = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('A sees 2 total votes after voting too:', afterAVoteA.includes('2 votos'));
  console.log('A sees own checkmark on Pizza:', afterAVoteA.includes('✓ Pizza'));

  // A switches vote to "Massa" (index 2) — still 2 total votes, but Pizza should drop to 0 and Massa to 1.
  await optionDivsA.nth(2).click();
  await a.page.waitForTimeout(400);
  const afterSwitchA = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('After switching vote, still 2 votos total:', afterSwitchA.includes('2 votos'));
  console.log('Checkmark moved to Massa:', afterSwitchA.includes('✓ Massa'));

  // A un-votes by clicking Massa again — total drops to 1.
  await optionDivsA.nth(2).click();
  await a.page.waitForTimeout(400);
  const afterUnvoteA = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('After un-voting, back to 1 voto total:', afterUnvoteA.includes('1 voto') && !afterUnvoteA.includes('2 votos'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
