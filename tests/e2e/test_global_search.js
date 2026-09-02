const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Global Search Test');
  await page.fill('#regUsername', 'gsearchtest_' + ts);
  await page.fill('#regPhone', '+3503' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'gsearchtest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Seed multiple fake chats with messages, including a deleted one and an encrypted one.
  await page.evaluate(() => {
    APP.chats.push(
      { id: 'gs_chat_a', name: 'Chat Alpha', phone: '+351000000101', type: 'user' },
      { id: 'gs_chat_b', name: 'Chat Beta', phone: '+351000000102', type: 'user' },
      { id: 'gs_chat_c', name: 'Grupo Gama', phone: '', type: 'group' }
    );
    APP.messages['gs_chat_a'] = [
      { id: 'msg_a1', text: 'Vamos marcar aquela reunião de projeto amanhã', sender: 'other', time: '10:00' },
      { id: 'msg_a2', text: 'mensagem apagada', deleted: true, sender: 'me', time: '10:05' }
    ];
    APP.messages['gs_chat_b'] = [
      { id: 'msg_b1', text: 'Podes enviar o ficheiro do projeto final?', sender: 'other', time: '11:00' },
      { id: 'msg_b2', text: 'conteudo cifrado nao deveria aparecer', encrypted: true, sender: 'me', time: '11:05' }
    ];
    APP.messages['gs_chat_c'] = [
      { id: 'msg_c1', text: 'Ninguem falou de projeto aqui, so futebol', sender: 'other', time: '12:00' }
    ];
    renderChatList();
  });

  await page.click('button[title="Pesquisar em todas as mensagens"]');
  await page.waitForSelector('#modalGlobalSearch.active', { timeout: 3000 });
  console.log('Modal opens on button click: true');

  const emptyStateText = await page.evaluate(() => document.getElementById('globalSearchResults').innerText);
  console.log('Shows placeholder text on empty query:', emptyStateText.includes('Escreve para pesquisar'));

  await page.fill('#globalSearchInput', 'projeto');
  await page.waitForTimeout(400); // debounce is 250ms

  const resultsHtml = await page.evaluate(() => document.getElementById('globalSearchResults').innerHTML);
  const resultCount = await page.evaluate(() => document.querySelectorAll('#globalSearchResults .chat-item').length);
  console.log('Finds matches across multiple chats (expect 3 - a1, b1, c1):', resultCount === 3);
  console.log('Highlights the matched term with <mark>:', resultsHtml.includes('<mark'));
  console.log('Includes chat name Chat Alpha:', resultsHtml.includes('Chat Alpha'));
  console.log('Includes chat name Chat Beta:', resultsHtml.includes('Chat Beta'));
  console.log('Includes group chat Grupo Gama:', resultsHtml.includes('Grupo Gama'));
  console.log('Excludes deleted message text:', !resultsHtml.includes('mensagem apagada'));
  console.log('Excludes encrypted message text:', !resultsHtml.includes('conteudo cifrado'));

  // Search for something with no matches
  await page.fill('#globalSearchInput', 'inexistentetermoxyz');
  await page.waitForTimeout(400);
  const noMatchText = await page.evaluate(() => document.getElementById('globalSearchResults').innerText);
  console.log('Shows "no results" message for a query with no matches:', noMatchText.includes('Nenhuma mensagem encontrada'));

  // Clicking a result should close the modal, open the right chat, and scroll to the message.
  await page.fill('#globalSearchInput', 'ficheiro');
  await page.waitForTimeout(400);
  await page.click('#globalSearchResults .chat-item');
  await page.waitForTimeout(500);

  const modalClosed = await page.evaluate(() => !document.getElementById('modalGlobalSearch').classList.contains('active'));
  console.log('Clicking a result closes the search modal:', modalClosed);

  const correctChatOpen = await page.evaluate(() => APP.currentChatId === 'gs_chat_b');
  console.log('Clicking a result opens the correct chat:', correctChatOpen);

  const highlightedMsg = await page.evaluate(() => {
    return new Promise(resolve => {
      let tries = 0;
      const check = () => {
        const el = document.querySelector('[data-msg-id="msg_b1"]');
        if (el && el.style.background) return resolve(el.style.background);
        if (++tries > 20) return resolve(el ? el.style.background : 'ELEMENT_NOT_FOUND');
        setTimeout(check, 100);
      };
      check();
    });
  });
  console.log('Target message gets the highlight flash background:', !!highlightedMsg && highlightedMsg.includes('168') && highlightedMsg.includes('132'));

  // XSS safety: a chat name or message containing HTML-special chars must be escaped in results.
  await page.evaluate(() => {
    APP.chats.push({ id: 'gs_chat_xss', name: '<img src=x onerror=alert(1)>', phone: '', type: 'user' });
    APP.messages['gs_chat_xss'] = [{ id: 'msg_xss1', text: 'projeto <script>alert(2)</script> perigoso', sender: 'other', time: '13:00' }];
    renderChatList();
  });
  await page.click('button[title="Pesquisar em todas as mensagens"]');
  await page.waitForSelector('#modalGlobalSearch.active', { timeout: 3000 });
  await page.fill('#globalSearchInput', 'projeto');
  await page.waitForTimeout(400);
  const xssCheck = await page.evaluate(() => {
    const hasRawImgTag = document.getElementById('globalSearchResults').innerHTML.includes('<img src=x onerror');
    const hasRawScriptTag = document.getElementById('globalSearchResults').innerHTML.includes('<script>alert(2)');
    return { hasRawImgTag, hasRawScriptTag };
  });
  console.log('Chat name with HTML is escaped (no raw <img> tag):', !xssCheck.hasRawImgTag);
  console.log('Message text with HTML is escaped (no raw <script> tag):', !xssCheck.hasRawScriptTag);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
