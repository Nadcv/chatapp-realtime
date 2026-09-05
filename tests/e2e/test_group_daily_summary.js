const { chromium } = require('playwright');

// O disparo real do resumo diário automático só acontece às 22h (hora de
// Lisboa) — não é praticável nem determinístico esperar pelo relógio real
// num teste automatizado (mesmo problema já aceite noutras partes desta
// suite para funcionalidades dependentes da hora do dia). Por isso este
// teste cobre o que É determinístico e testável sem esperar: o interruptor
// "Resumo diário automático" em "Gerir grupo" é só para administradores,
// fica guardado no grupo, e é visível/sincronizado para toda a gente que
// vir o grupo (mesmo quem não é admin, para saber que está ligado).
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

  const a = await register(ctxA, 'Summary Admin', 'gsum_a_');
  const b = await register(ctxB, 'Summary Member', 'gsum_b_');

  const groupName = 'Grupo Resumo ' + Date.now();
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  await a.page.fill('#groupName', groupName);
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await a.page.waitForTimeout(500);

  await a.page.click(`.chat-item:has-text("${groupName}")`);
  await a.page.waitForTimeout(300);
  await a.page.click('button[onclick="openChatMoreModal()"]');
  await a.page.waitForSelector('#modalChatMore.active');
  await a.page.click('#manageGroupBtn');
  await a.page.waitForSelector('#modalManageGroup.active');
  await a.page.waitForTimeout(300);
  const startsUnchecked = await a.page.evaluate(() => !document.getElementById('groupDailySummaryToggle').checked);
  console.log('O resumo diário começa desligado por omissão:', startsUnchecked);

  // --- A (admin/criador) liga o resumo diário. ---
  await a.page.check('#groupDailySummaryToggle');
  await a.page.waitForTimeout(400);
  const enabledForA = await a.page.evaluate((name) => APP.groupsList.find(g => g.name === name)?.dailySummaryEnabled, groupName);
  console.log('Depois de ligar, o grupo fica marcado como "resumo diário ativo":', enabledForA === true);

  // --- B (membro comum, não admin) vê o mesmo estado sincronizado. ---
  await b.page.waitForTimeout(500);
  const enabledForB = await b.page.evaluate((name) => APP.groupsList.find(g => g.name === name)?.dailySummaryEnabled, groupName);
  console.log('Um membro comum vê o mesmo estado (ligado) sincronizado:', enabledForB === true);

  // --- B (não admin) tenta ligar/desligar diretamente por socket — o servidor recusa. ---
  const groupId = await b.page.evaluate((name) => APP.groupsList.find(g => g.name === name).id, groupName);
  await b.page.evaluate((gid) => { socket.emit('group_set_daily_summary', { groupId: gid, enabled: false }); }, groupId);
  await a.page.waitForTimeout(400);
  const stillEnabledAfterNonAdminAttempt = await a.page.evaluate((name) => APP.groupsList.find(g => g.name === name)?.dailySummaryEnabled, groupName);
  console.log('Um membro comum NÃO consegue desligar o resumo diário de outro grupo (só admins podem):', stillEnabledAfterNonAdminAttempt === true);

  // --- A desliga de novo — deve reverter para os dois lados. ---
  await a.page.uncheck('#groupDailySummaryToggle');
  await a.page.waitForTimeout(400);
  const disabledForA = await a.page.evaluate((name) => APP.groupsList.find(g => g.name === name)?.dailySummaryEnabled, groupName);
  console.log('O admin consegue desligar de novo:', disabledForA === false);
  await b.page.waitForTimeout(400);
  const disabledForB = await b.page.evaluate((name) => APP.groupsList.find(g => g.name === name)?.dailySummaryEnabled, groupName);
  console.log('E isso também chega ao membro comum:', disabledForB === false);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
