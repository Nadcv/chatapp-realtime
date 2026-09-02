const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Gif Test');
  await page.fill('#regUsername', 'giftest_' + ts);
  await page.fill('#regPhone', '+3510' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'giftest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.chats.push({ id: 'dm_giftest', name: 'Gif Chat', phone: '+351000000002', type: 'user' });
    renderChatList();
  });
  await page.click('.chat-item:has-text("Gif Chat")');
  await page.waitForTimeout(200);

  // --- Test 1: real endpoint, unconfigured (no GIPHY_API_KEY in this sandbox) ---
  await page.click('button[title="GIFs e Stickers"]');
  await page.waitForSelector('#modalGifPicker.active');
  await page.waitForTimeout(400);
  const unconfiguredMsg = await page.textContent('#gifResultsGrid');
  console.log('Shows "not configured" message when Giphy key is missing:', unconfiguredMsg.includes('não configurados'));
  await page.click('#modalGifPicker button:has-text("Fechar")');

  // --- Test 2: mock a configured Giphy response and exercise the full flow ---
  // page.route() does not intercept anything in this sandbox (confirmed with
  // a catch-all route matching 0 requests), so mock window.fetch itself
  // inside the page for this one endpoint, same approach used successfully
  // for the translator feature's tests earlier this session.
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, ...rest) => {
      if (typeof url === 'string' && url.includes('/api/gifs/search')) {
        const u = new URL(url, location.origin);
        const type = u.searchParams.get('type');
        const results = [
          { preview: `https://example.test/${type}-preview-1.gif`, full: `https://example.test/${type}-full-1.gif`, title: 'First ' + type },
          { preview: `https://example.test/${type}-preview-2.gif`, full: `https://example.test/${type}-full-2.gif`, title: 'Second ' + type },
        ];
        return Promise.resolve(new Response(JSON.stringify({ configured: true, results }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, ...rest);
    };
  });

  await page.click('button[title="GIFs e Stickers"]');
  await page.waitForSelector('#modalGifPicker.active');
  await page.waitForTimeout(300);
  const gifImgCount = await page.evaluate(() => document.querySelectorAll('#gifResultsGrid img').length);
  console.log('Renders the mocked GIF results as a grid of images:', gifImgCount === 2);
  const gifTabActive = await page.evaluate(() => document.getElementById('gifTabGifs').classList.contains('btn-accept'));
  console.log('GIFs tab is the default active tab:', gifTabActive);

  // Switch to Stickers tab and confirm the request re-fetches with type=stickers.
  await page.click('#gifTabStickers');
  await page.waitForTimeout(300);
  const stickerImgSrc = await page.evaluate(() => document.querySelector('#gifResultsGrid img')?.src || '');
  console.log('Switching to Stickers tab re-fetches sticker results:', stickerImgSrc.includes('stickers-preview'));
  const stickerTabActive = await page.evaluate(() => document.getElementById('gifTabStickers').classList.contains('btn-accept'));
  console.log('Stickers tab becomes active:', stickerTabActive);

  // Click a sticker result and confirm it sends as a real message.
  await page.click('#gifResultsGrid img');
  await page.waitForTimeout(300);
  const modalClosedAfterSend = await page.evaluate(() => !document.getElementById('modalGifPicker').classList.contains('active'));
  console.log('Modal closes after sending:', modalClosedAfterSend);
  const lastMsg = await page.evaluate(() => {
    const msgs = APP.messages[APP.currentChatId];
    return msgs[msgs.length - 1];
  });
  console.log('Sent message has the sticker full-size URL as fileData:', lastMsg.fileData === 'https://example.test/stickers-full-1.gif');
  console.log('Sent message is tagged image/gif:', lastMsg.fileType === 'image/gif');
  console.log('Sent message text labeled as Sticker:', lastMsg.text.includes('Sticker'));

  const renderedHtml = await page.evaluate(() => document.querySelector('#chatMessages .message.sent').innerHTML);
  console.log('Rendered message shows an <img> tag (not a generic file link):', renderedHtml.includes('<img src="https://example.test/stickers-full-1.gif"'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
