const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Pin Multi Test');
  await page.fill('#regUsername', 'pinmulti_' + ts);
  await page.fill('#regPhone', '+3516' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'pinmulti' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Set up a group chat with several messages to pin. O ID inclui "ts" (só desta
  // execução) porque as mensagens fixadas ficam guardadas server-side (pins.json,
  // ou Mongo em produção) indexadas por este ID — um ID fixo faria este teste
  // herdar pins de execuções anteriores da suite e falhar por causa disso, não de
  // um bug real. As referências seguintes usam APP.currentChatId em vez de repetir
  // o ID, já que o chat aberto não muda durante o resto do teste.
  await page.evaluate((groupId) => {
    APP.chats.push({ id: groupId, type: 'group', name: 'Grupo Pin' });
    APP.messages[groupId] = [
      { id: 'p1', sender: 'Ana', text: 'Primeira mensagem', time: '10:00', type: 'received' },
      { id: 'p2', sender: 'Bruno', text: 'Segunda mensagem', time: '10:01', type: 'received' },
      { id: 'p3', sender: 'Carla', text: 'Terceira mensagem', time: '10:02', type: 'received' }
    ];
    openChat(groupId);
  }, 'pintestgroup_' + ts);
  await page.waitForTimeout(300);

  const bannerHiddenInitially = await page.evaluate(() => document.getElementById('pinnedBanner').style.display === 'none');
  console.log('Banner hidden when nothing is pinned:', bannerHiddenInitially);

  // Pin the first message.
  await page.evaluate(() => pinMessage('p1'));
  await page.waitForTimeout(300);
  const bannerShowsSingle = await page.evaluate(() => ({
    display: document.getElementById('pinnedBanner').style.display,
    label: document.getElementById('pinnedBannerLabel').textContent,
    text: document.getElementById('pinnedBannerText').textContent,
    unpinBtnVisible: document.getElementById('pinnedBannerUnpinBtn').style.display !== 'none'
  }));
  console.log('Banner shows single-pin view correctly:', bannerShowsSingle.display === 'flex' && bannerShowsSingle.label === 'Mensagem fixada' && bannerShowsSingle.text.includes('Primeira mensagem') && bannerShowsSingle.unpinBtnVisible);

  // Pin a second and third message.
  await page.evaluate(() => pinMessage('p2'));
  await page.waitForTimeout(200);
  await page.evaluate(() => pinMessage('p3'));
  await page.waitForTimeout(200);

  const bannerShowsCount = await page.evaluate(() => ({
    label: document.getElementById('pinnedBannerLabel').textContent,
    text: document.getElementById('pinnedBannerText').textContent,
    unpinBtnHidden: document.getElementById('pinnedBannerUnpinBtn').style.display === 'none'
  }));
  console.log('Banner shows "3 mensagens fixadas" when multiple pins exist:', bannerShowsCount.label.includes('3 mensagens fixadas'));
  console.log('Banner hides the single-unpin button when multiple pins exist:', bannerShowsCount.unpinBtnHidden);

  const pinCount = await page.evaluate(() => APP.pinnedByChatId[APP.currentChatId].length);
  console.log('Exactly 3 pins tracked in state:', pinCount === 3);

  // Clicking the banner with multiple pins opens the list modal.
  await page.evaluate(() => onPinnedBannerClick());
  await page.waitForSelector('#modalPinnedMessages.active', { timeout: 3000 });
  const modalListText = await page.evaluate(() => document.getElementById('pinnedMessagesList').textContent);
  console.log('Pinned list modal shows all 3 pinned messages:', modalListText.includes('Primeira mensagem') && modalListText.includes('Segunda mensagem') && modalListText.includes('Terceira mensagem'));
  console.log('Pinned list modal shows senders:', modalListText.includes('Ana') && modalListText.includes('Bruno') && modalListText.includes('Carla'));

  // Clicking a row scrolls to it and closes the modal.
  const rowButtons = await page.evaluate(() => [...document.querySelectorAll('#pinnedMessagesList > div')].length);
  console.log('Modal renders exactly 3 rows:', rowButtons === 3);

  // Unpin one from inside the modal.
  await page.evaluate(() => unpinMessage('p2'));
  await page.waitForTimeout(300);
  const countAfterUnpinOne = await page.evaluate(() => APP.pinnedByChatId[APP.currentChatId].length);
  console.log('After unpinning one via the modal, 2 pins remain:', countAfterUnpinOne === 2);
  const modalRefreshedAfterUnpin = await page.evaluate(() => !document.getElementById('pinnedMessagesList').textContent.includes('Segunda mensagem'));
  console.log('Modal list refreshes live after an unpin (no stale entry):', modalRefreshedAfterUnpin);

  // Close modal, unpin one more down to 1 -> banner should revert to single-pin view.
  await page.evaluate(() => { closeModal('modalPinnedMessages'); unpinMessage('p3'); });
  await page.waitForTimeout(300);
  const backToSingleView = await page.evaluate(() => ({
    label: document.getElementById('pinnedBannerLabel').textContent,
    unpinBtnVisible: document.getElementById('pinnedBannerUnpinBtn').style.display !== 'none'
  }));
  console.log('Banner reverts to single-pin view when only 1 remains:', backToSingleView.label === 'Mensagem fixada' && backToSingleView.unpinBtnVisible);

  // Single-pin click scrolls directly (no modal).
  await page.evaluate(() => onPinnedBannerClick());
  await page.waitForTimeout(300);
  const modalNotOpenedForSingle = await page.evaluate(() => !document.getElementById('modalPinnedMessages').classList.contains('active'));
  console.log('Clicking banner with only 1 pin does NOT open the list modal (scrolls directly instead):', modalNotOpenedForSingle);

  // Unpin the last one via banner button -> banner hides entirely.
  await page.evaluate(() => unpinBannerMessage());
  await page.waitForTimeout(300);
  const bannerHiddenAfterAllUnpinned = await page.evaluate(() => document.getElementById('pinnedBanner').style.display === 'none');
  console.log('Banner hides after all pins removed:', bannerHiddenAfterAllUnpinned);
  const noPinsLeft = await page.evaluate(() => !APP.pinnedByChatId[APP.currentChatId]);
  console.log('No pins remain tracked in state:', noPinsLeft);

  // Cap test: pin up to the max (10), then a rejection should occur for the 11th.
  await page.evaluate(() => {
    APP.messages[APP.currentChatId] = [];
    for (let i = 0; i < 11; i++) {
      APP.messages[APP.currentChatId].push({ id: 'cap' + i, sender: 'Cap', text: 'msg' + i, time: '10:00', type: 'received' });
    }
  });
  let rejectionSeen = false;
  await page.exposeFunction('__testAlertCapture', (msg) => { rejectionSeen = rejectionSeen || msg.includes('máximo'); });
  await page.evaluate(() => { window.alert = (msg) => window.__testAlertCapture(msg); });
  for (let i = 0; i < 11; i++) {
    await page.evaluate((i) => pinMessage('cap' + i), i);
    await page.waitForTimeout(120);
  }
  const cappedAtMax = await page.evaluate(() => APP.pinnedByChatId[APP.currentChatId].length);
  console.log('Pin count is capped at the server-side max (10):', cappedAtMax === 10);
  console.log('An alert with "máximo" was shown when trying to exceed the cap:', rejectionSeen);

  // XSS safety in the pinned list modal.
  await page.evaluate(() => {
    APP.messages[APP.currentChatId].push({ id: 'xsspin', sender: '<img src=x onerror=alert(1)>', text: '<script>alert(2)</script>', time: '10:05', type: 'received' });
  });
  await page.evaluate(() => unpinMessage('cap0')); // free a slot
  await page.waitForTimeout(200);
  await page.evaluate(() => pinMessage('xsspin'));
  await page.waitForTimeout(200);
  await page.evaluate(() => openPinnedMessagesModal());
  await page.waitForTimeout(200);
  const xssSafeInModal = await page.evaluate(() => {
    const html = document.getElementById('pinnedMessagesList').innerHTML;
    return !html.includes('<script>alert') && !html.includes('<img src=x onerror');
  });
  console.log('XSS-safe: malicious sender/text in pinned list is escaped:', xssSafeInModal);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
