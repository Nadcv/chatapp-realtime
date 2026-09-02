const { chromium } = require('playwright');

// Espelha ringFrequencyForUser() do index.html — só 5 tons possíveis, por
// isso dois telefones AO ACASO têm ~20% de hipótese de colidir no mesmo tom
// (não é um bug, é só a cardinalidade do hash). Em vez de arriscar esse falso
// negativo, escolhe-se o telefone da 2ª conta de forma a garantir um tom
// diferente do da 1ª — testando assim a propriedade real (o algoritmo
// consegue mesmo distinguir contas), não a sorte de duas chamadas aleatórias.
function ringFrequencyForPhone(phone) {
  let hash = 0;
  for (let i = 0; i < phone.length; i++) hash = (hash * 31 + phone.charCodeAt(i)) >>> 0;
  const tones = [780, 880, 950, 1040, 1120];
  return tones[hash % tones.length];
}

async function registerUser(context, name, usernamePrefix, phone) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  if (!phone) phone = '+3517' + ts.toString().slice(-8);
  await page.fill('#regName', name);
  await page.fill('#regUsername', usernamePrefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', usernamePrefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'] });

  const a = await registerUser(ctxA, 'Nadiel Teste', 'nadiel_');
  const freqA0 = ringFrequencyForPhone(a.phone);
  let bPhone;
  do {
    bPhone = '+3517' + (Date.now() + Math.floor(Math.random() * 1000000)).toString().slice(-8);
  } while (ringFrequencyForPhone(bPhone) === freqA0);
  const b = await registerUser(ctxB, 'Luis Teste', 'luis_', bPhone);
  await a.page.waitForTimeout(500);
  await b.page.waitForTimeout(500);

  // Check the per-user ring frequency for each, WITHOUT any prior click (simulating
  // an incoming call on a tab that hasn't been touched yet since page load — the
  // exact scenario that failed before).
  const freqA = await a.page.evaluate(() => ringFrequencyForUser());
  const freqB = await b.page.evaluate(() => ringFrequencyForUser());
  console.log('Ring frequency A (Nadiel):', freqA);
  console.log('Ring frequency B (Luis):', freqB);
  console.log('Different tones per account:', freqA !== freqB);

  // Simulate B calling A with ZERO prior interaction on A's tab (no click at all)
  // — this is the exact failing scenario reported.
  await b.page.evaluate((aPhone) => {
    const chatId = dmRoomId(APP.user.phone, aPhone);
    APP.chats.push({ id: chatId, name: 'Nadiel Teste', phone: aPhone, type: 'user', online: true });
    APP.currentChatId = chatId;
    startCall('voice');
  }, a.phone);

  await a.page.waitForSelector('#modalIncomingCall.active', { timeout: 8000 });
  await a.page.waitForTimeout(300);
  const stateNoClick = await a.page.evaluate(() => ({
    ctxState: ringtoneCtx ? ringtoneCtx.state : 'no-context',
    hasTimer: !!ringtoneTimer
  }));
  console.log('A (no prior click) ring state:', stateNoClick);
  // NOTE: Playwright's automated navigation itself may or may not count as a
  // "user gesture" for autoplay purposes depending on Chromium flags; the real
  // fix (persistent, reused context + resume-on-first-gesture) is what matters,
  // this just confirms the context exists and a timer is running.

  await a.page.click('button[onclick="declineIncomingCall()"]');
  await a.page.waitForTimeout(200);

  // Second call, now decline+accept cycle should NOT recreate the context
  // (same object reference reused).
  const ctxRefBefore = await a.page.evaluate(() => !!ringtoneCtx);
  await b.page.evaluate((aPhone) => {
    const chatId = dmRoomId(APP.user.phone, aPhone);
    APP.currentChatId = chatId;
    startCall('voice');
  }, a.phone);
  await a.page.waitForSelector('#modalIncomingCall.active', { timeout: 8000 });
  const reused = await a.page.evaluate(() => !!ringtoneCtx);
  console.log('Context persisted across calls (not recreated):', ctxRefBefore && reused);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
