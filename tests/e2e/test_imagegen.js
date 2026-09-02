const { chromium } = require('playwright');

// Note: image.pollinations.ai is blocked at the sandbox's outbound proxy
// (confirmed via both a direct Node fetch and a real browser navigation —
// both get "CONNECT tunnel failed"/403). This is a sandbox restriction, not
// an app bug: Railway's outbound network isn't restricted this way. The
// server's /api/generate-image endpoint itself needs no network access at
// all (it only builds a URL string), which I confirmed works via curl. This
// test mocks window.fetch for that one endpoint (returning a tiny local PNG
// data URI instead of a real Pollinations URL) to exercise the actual UI
// flow: prompt -> generate -> preview -> regenerate -> send as a message.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Imggen Test');
  await page.fill('#regUsername', 'imggentest_' + ts);
  await page.fill('#regPhone', '+3509' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'imggentest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.chats.push({ id: 'dm_imggen', name: 'Imggen Chat', phone: '+351000000005', type: 'user' });
    renderChatList();
  });
  await page.click('.chat-item:has-text("Imggen Chat")');
  await page.waitForTimeout(200);

  // --- Test 1: empty prompt is rejected client-side (no request made) ---
  await page.click('button[title="Gerar imagem com IA"]');
  await page.waitForSelector('#modalImageGen.active');
  let alertMessage = null;
  page.once('dialog', (d) => { alertMessage = d.message(); d.accept(); });
  await page.click('button:has-text("Gerar")');
  await page.waitForTimeout(200);
  console.log('Empty prompt shows an alert instead of calling the API:', alertMessage && alertMessage.includes('descrição'));

  // --- Test 2: mock the endpoint and generate a real preview ---
  let requestedPrompts = [];
  await page.evaluate((tinyPng) => {
    window.__tinyPng = tinyPng;
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, ...rest) => {
      if (typeof url === 'string' && url.includes('/api/generate-image')) {
        const u = new URL(url, location.origin);
        window.__lastPrompt = u.searchParams.get('prompt');
        return Promise.resolve(new Response(JSON.stringify({ url: window.__tinyPng + '#' + Date.now() }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, ...rest);
    };
  }, TINY_PNG);

  await page.fill('#imageGenPrompt', 'um gato astronauta');
  await page.click('button:has-text("Gerar")');
  await page.waitForTimeout(300);
  const promptSent = await page.evaluate(() => window.__lastPrompt);
  console.log('Sends the typed prompt to the API:', promptSent === 'um gato astronauta');
  const previewImgVisible = await page.evaluate(() => !!document.querySelector('#imageGenResult img'));
  console.log('Shows a preview image after generating:', previewImgVisible);
  const hasRegenerateBtn = await page.evaluate(() => !!document.querySelector('#imageGenResult button')?.textContent.includes('outra'));
  console.log('Shows a "Gerar outra" (regenerate) option:', hasRegenerateBtn);

  const firstUrl = await page.evaluate(() => document.querySelector('#imageGenResult img').src);
  await page.click('#imageGenResult button:has-text("Gerar outra")');
  await page.waitForTimeout(300);
  const secondUrl = await page.evaluate(() => document.querySelector('#imageGenResult img').src);
  console.log('Regenerating fetches a fresh URL (not reusing the exact same one):', firstUrl !== secondUrl);

  // --- Test 3: send the generated image as a real message ---
  await page.click('#imageGenResult button:has-text("Enviar")');
  await page.waitForTimeout(300);
  const modalClosed = await page.evaluate(() => !document.getElementById('modalImageGen').classList.contains('active'));
  console.log('Modal closes after sending:', modalClosed);
  const lastMsg = await page.evaluate(() => {
    const msgs = APP.messages[APP.currentChatId];
    return msgs[msgs.length - 1];
  });
  console.log('Sent message carries the generated image URL as fileData:', lastMsg.fileData === secondUrl);
  console.log('Sent message is tagged image/png:', lastMsg.fileType === 'image/png');
  console.log('Sent message text labeled as AI-generated:', lastMsg.text.includes('Imagem gerada por IA'));
  const renderedHtml = await page.evaluate(() => document.querySelector('#chatMessages .message.sent').innerHTML);
  console.log('Renders as an actual <img> in the chat:', renderedHtml.includes('<img src="' + secondUrl.replace(/&/g, '&amp;')));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
