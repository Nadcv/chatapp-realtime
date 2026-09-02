const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Link Prev Test');
  await page.fill('#regUsername', 'linkprevtest_' + ts);
  await page.fill('#regPhone', '+3502' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'linkprevtest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.chats.push({ id: 'dm_linkprev', name: 'Link Chat', phone: '+351000000006', type: 'user' });
    renderChatList();
  });
  await page.click('.chat-item:has-text("Link Chat")');
  await page.waitForTimeout(200);

  // The real /api/link-preview endpoint works fine (SSRF guard verified via
  // curl already), but this sandbox's outbound proxy blocks arbitrary
  // external domains (allowlist-based), so mock window.fetch for that one
  // endpoint to test the actual client-side rendering logic.
  let requestedUrl = null;
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, ...rest) => {
      if (typeof url === 'string' && url.includes('/api/link-preview')) {
        const u = new URL(url, location.origin);
        window.__requestedPreviewUrl = u.searchParams.get('url');
        return Promise.resolve(new Response(JSON.stringify({
          url: window.__requestedPreviewUrl,
          title: 'An Example Page Title',
          description: 'A description of the example page, for the preview card.',
          image: 'https://example.test/preview.jpg'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, ...rest);
    };
  });

  await page.fill('#messageInput', 'olha isto: https://example.test/some-article, muito bom!');
  await page.press('#messageInput', 'Enter');
  await page.waitForTimeout(500);

  requestedUrl = await page.evaluate(() => window.__requestedPreviewUrl);
  console.log('Extracts the URL from the message text correctly (punctuation stripped):', requestedUrl === 'https://example.test/some-article');

  const debugInfo = await page.evaluate(() => {
    const msgs = APP.messages[APP.currentChatId] || [];
    const last = msgs[msgs.length-1];
    const sentEls = [...document.querySelectorAll('#chatMessages .message.sent')];
    return { msgCount: msgs.length, lastMsgId: last?.id, lastLinkPreview: JSON.stringify(last?.linkPreview), sentElCount: sentEls.length, sentElIds: sentEls.map(e=>e.getAttribute('data-msg-id')) };
  });
  console.log('DEBUG:', JSON.stringify(debugInfo));
  const previewCardHtml = await page.evaluate(() => document.querySelector('#chatMessages .message.sent')?.innerHTML || '');
  console.log('Renders the preview title:', previewCardHtml.includes('An Example Page Title'));
  console.log('Renders the preview description:', previewCardHtml.includes('for the preview card'));
  console.log('Renders the preview image:', previewCardHtml.includes('https://example.test/preview.jpg'));
  console.log('Original message text is still shown normally alongside the preview:', previewCardHtml.includes('olha isto:'));

  // A second render pass (e.g. from a new message arriving) must NOT
  // re-fetch the same preview — msg.linkPreview should already be cached.
  const fetchCountBefore = await page.evaluate(() => {
    window.__fetchCallCount = window.__fetchCallCount || 0;
    return window.__fetchCallCount;
  });
  await page.evaluate(() => {
    let count = 0;
    const realFetch = window.fetch;
    window.fetch = (...args) => { if (String(args[0]).includes('/api/link-preview')) count++; window.__fetchCallCount = count; return realFetch(...args); };
    renderMessages(); // força um segundo render da mesma conversa
  });
  await page.waitForTimeout(300);
  const fetchCountAfter = await page.evaluate(() => window.__fetchCallCount || 0);
  console.log('Does not re-fetch the preview on a second render of the same message:', fetchCountAfter === 0);

  // A plain message without any URL must not show a preview container at all.
  await page.fill('#messageInput', 'mensagem completamente normal sem link nenhum');
  await page.press('#messageInput', 'Enter');
  await page.waitForTimeout(300);
  const noPreviewContainer = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('#chatMessages .message.sent')];
    const last = msgs[msgs.length - 1];
    return !last.querySelector('[id^="linkpreview_"]');
  });
  console.log('A message without a URL has no preview container at all:', noPreviewContainer);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
