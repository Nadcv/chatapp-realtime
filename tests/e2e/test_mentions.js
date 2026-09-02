const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(name, 'PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3515' + ts.toString().slice(-8);
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
  const a = await register(await browser.newContext(), 'Mention Ana', 'ment_a_');
  const b = await register(await browser.newContext(), 'Mention Bruno', 'ment_b_');

  const groupName = 'Grupo Mencoes ' + Date.now();
  await a.page.click('button[onclick="openContactsFeaturesModal()"]');
  await a.page.waitForSelector('#modalContactsFeatures.active');
  await a.page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await a.page.waitForSelector('#modalCreateGroup.active');
  await a.page.fill('#groupName', groupName);
  await a.page.click('#modalCreateGroup button:has-text("Criar Grupo")');

  for (const p of [a, b]) {
    await p.page.waitForFunction((name) => typeof APP !== 'undefined' && APP.chats.some(ch => ch.name === name), groupName, { timeout: 15000 });
  }

  // A needs B as a contact for the mention autocomplete to know about them
  // (mirrors how mentions resolve against APP.chats of type 'user').
  await a.page.evaluate(({ bPhone }) => {
    APP.chats.push({ id: dmRoomId(APP.user.phone, bPhone), name: 'Mention Bruno', phone: bPhone, type: 'user' });
  }, { bPhone: b.phone });

  for (const p of [a, b]) {
    await p.page.click(`.chat-item:has-text("${groupName}")`);
    await p.page.waitForTimeout(200);
  }

  // --- Test 1: autocomplete matches on ANY word of the name, not just the
  // start of the full string — typing the surname-like second word "Bruno"
  // (test names here are "Mention <Name>") must still match.
  await a.page.click('#messageInput');
  await a.page.type('#messageInput', 'Oi @Bru');
  await a.page.waitForTimeout(150);
  const autocompleteVisible = await a.page.evaluate(() => document.getElementById('mentionAutocomplete').style.display === 'block');
  const autocompleteText = await a.page.textContent('#mentionAutocomplete');
  console.log('Autocomplete shows while typing @Bru:', autocompleteVisible);
  console.log('Autocomplete suggests "Mention Bruno":', autocompleteText.includes('Mention Bruno'));

  // --- Test 2: clicking the suggestion inserts the full name ---
  await a.page.click('#mentionAutocomplete div:has-text("Mention Bruno")');
  const inputValueAfterClick = await a.page.inputValue('#messageInput');
  console.log('Selecting suggestion inserts full name:', inputValueAfterClick === 'Oi @Mention Bruno ');
  const autocompleteHiddenAfterClick = await a.page.evaluate(() => document.getElementById('mentionAutocomplete').style.display === 'none');
  console.log('Autocomplete closes after selecting:', autocompleteHiddenAfterClick);

  await a.page.type('#messageInput', 'tudo bem?');
  await a.page.press('#messageInput', 'Enter');
  await a.page.waitForTimeout(500);

  // --- Test 3: rendered message highlights the mention ---
  const msgHtmlA = await a.page.evaluate(() => document.querySelector('#chatMessages .message.sent').innerHTML);
  console.log('Sender sees mention highlighted as a span:', /<span[^>]*>@Mention Bruno<\/span>/.test(msgHtmlA));

  await b.page.waitForTimeout(300);
  const msgHtmlB = await b.page.evaluate(() => document.querySelector('#chatMessages .message.received')?.innerHTML || '');
  console.log('Recipient sees the mention highlighted too:', /<span[^>]*>@Mention Bruno<\/span>/.test(msgHtmlB));
  const isSelfHighlightStyle = await b.page.evaluate(() => {
    const el = [...document.querySelectorAll('#chatMessages .message.received span')].find(s => s.textContent.includes('@Mention Bruno'));
    return el ? el.getAttribute('style') : null;
  });
  console.log('Recipient (the one mentioned) gets the self-mention style (yellowish bg):', isSelfHighlightStyle && isSelfHighlightStyle.includes('255,193,7'));

  // --- Test 4: XSS safety check — a message containing raw HTML must not execute/inject ---
  await a.page.fill('#messageInput', '<img src=x onerror="window.__xssFired=true">');
  await a.page.press('#messageInput', 'Enter');
  await a.page.waitForTimeout(400);
  const xssFired = await a.page.evaluate(() => window.__xssFired === true);
  const lastMsgHtml = await a.page.evaluate(() => [...document.querySelectorAll('#chatMessages .message.sent')].pop().innerHTML);
  const sidebarPreviewHtml = await a.page.evaluate(() => document.querySelector('#chatList .chat-item.active p')?.innerHTML || '');
  console.log('Raw HTML in a message is escaped, not executed (XSS-safe):', !xssFired && lastMsgHtml.includes('&lt;img'));
  console.log('Sidebar preview also escapes it (was the actual live XSS sink found):', sidebarPreviewHtml.includes('&lt;img'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
