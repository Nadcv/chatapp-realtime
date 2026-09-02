const { chromium } = require('playwright');
const path = require('path');

async function registerUser(browser, label) {
  const page = await browser.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION (${label}):`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  await page.fill('#regName', label);
  await page.fill('#regUsername', 'vo_' + label.toLowerCase() + '_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'vo_' + label.toLowerCase() + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const phone = await page.evaluate(() => APP.user.phone);
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const alice = await registerUser(browser, 'Alice');
  const bob = await registerUser(browser, 'Bob');
  const alicePage = alice.page, bobPage = bob.page;

  await alicePage.evaluate((bobPhone) => socket.emit('add_contact', { phone: bobPhone }), bob.phone);
  await bobPage.evaluate((alicePhone) => socket.emit('add_contact', { phone: alicePhone }), alice.phone);
  await alicePage.waitForTimeout(500);
  await bobPage.waitForTimeout(500);

  await alicePage.click('.chat-item:has-text("Bob")');
  await alicePage.waitForTimeout(200);
  await bobPage.click('.chat-item:has-text("Alice")');
  await bobPage.waitForTimeout(200);

  // A normal (non-view-once) photo still works exactly as before: shows a preview
  // modal, sending without checking the box behaves like a regular photo message.
  await alicePage.setInputFiles('#attachFileInput', path.join(__dirname, 'test_photo.png'));
  await alicePage.waitForSelector('#modalAttachmentPreview.active', { timeout: 3000 });
  const previewImgSrc = await alicePage.evaluate(() => document.getElementById('viewOncePreviewImg').src.startsWith('data:image/png'));
  console.log('Preview modal shows the selected image before sending:', previewImgSrc);
  await alicePage.click('#modalAttachmentPreview button:has-text("Enviar")');
  await alicePage.waitForTimeout(400);
  const normalPhotoRendersImg = await alicePage.evaluate(() => !!document.querySelector('#chatMessages .message.sent img'));
  console.log('Sending WITHOUT checking the box sends a normal (non-view-once) photo:', normalPhotoRendersImg);

  // Now send a real view-once photo.
  await alicePage.setInputFiles('#attachFileInput', path.join(__dirname, 'test_photo.png'));
  await alicePage.waitForSelector('#modalAttachmentPreview.active', { timeout: 3000 });
  await alicePage.check('#viewOnceCheckbox');
  await alicePage.click('#modalAttachmentPreview button:has-text("Enviar")');
  await alicePage.waitForTimeout(500);

  // Sender's own bubble: still shows the real image (sender keeps their own copy).
  const aliceSeesOwnPhoto = await alicePage.evaluate(() => {
    const sentMsgs = [...document.querySelectorAll('#chatMessages .message.sent')];
    const last = sentMsgs[sentMsgs.length - 1];
    return !!last.querySelector('img');
  });
  console.log('Sender keeps seeing their own view-once photo normally:', aliceSeesOwnPhoto);
  const aliceSeesViewOnceBadge = await alicePage.evaluate(() => document.querySelector('#chatMessages .message.sent').parentElement ? document.querySelector('#chatMessages').innerText.includes('Ver uma vez') : false);
  console.log('Sender sees a "Ver uma vez" badge on their own sent bubble:', aliceSeesViewOnceBadge);

  await bobPage.waitForTimeout(500);

  // Recipient: sees a locked placeholder, NOT the actual image.
  const bobSeesLockedPlaceholder = await bobPage.evaluate(() => {
    const recvMsgs = [...document.querySelectorAll('#chatMessages .message.received')];
    const last = recvMsgs[recvMsgs.length - 1];
    return { hasImg: !!last.querySelector('img'), text: last.innerText };
  });
  console.log('Recipient does NOT see the actual image before opening it:', !bobSeesLockedPlaceholder.hasImg);
  console.log('Recipient sees the "toca para ver" placeholder text:', bobSeesLockedPlaceholder.text.includes('Toca para ver'));

  // Recipient opens it once.
  await bobPage.evaluate(() => {
    window.__openedNewTabs = [];
    const realOpen = window.open.bind(window);
    window.open = (...args) => { window.__openedNewTabs.push(args); return { document: { write: () => {} } }; };
  });
  const msgId = await bobPage.evaluate(() => {
    const msgs = APP.messages[APP.currentChatId];
    return msgs.find(m => m.viewOnce)?.id;
  });
  await bobPage.evaluate((id) => openViewOnceImage(id), msgId);
  await bobPage.waitForTimeout(500);

  const bobOpenedFullscreen = await bobPage.evaluate(() => window.__openedNewTabs.length > 0);
  console.log('Opening the photo triggers the fullscreen viewer:', bobOpenedFullscreen);

  const bobFileDataGoneLocally = await bobPage.evaluate((id) => {
    const msg = APP.messages[APP.currentChatId].find(m => m.id === id);
    return msg.fileData === null && msg.viewOnceOpened === true;
  }, msgId);
  console.log('Local message state is wiped immediately after opening (optimistic):', bobFileDataGoneLocally);

  const bobSeesVistaAfterOpening = await bobPage.evaluate(() => {
    const recvMsgs = [...document.querySelectorAll('#chatMessages .message.received')];
    return recvMsgs[recvMsgs.length - 1].innerText.includes('Foto vista');
  });
  console.log('After opening, the bubble now shows "Foto vista" instead of the image:', bobSeesVistaAfterOpening);

  // Trying to open it again does nothing (already opened).
  await bobPage.evaluate((id) => openViewOnceImage(id), msgId);
  await bobPage.waitForTimeout(200);
  const stillOnlyOneOpen = await bobPage.evaluate(() => window.__openedNewTabs.length === 1);
  console.log('Trying to open it a second time does nothing (still only opened once):', stillOnlyOneOpen);

  // Sender's side eventually finds out it was opened (server -> other side sync).
  await alicePage.waitForTimeout(500);
  const aliceSeesItWasOpened = await alicePage.evaluate(() => {
    const msg = APP.messages[APP.currentChatId].find(m => m.viewOnce);
    return msg.viewOnceOpened === true;
  });
  console.log('Sender\'s side is notified that the recipient opened the photo:', aliceSeesItWasOpened);

  // Server-side enforcement: even a brand new device (fresh room_history reload) can no
  // longer retrieve the photo once it has been opened — the file was actually wiped server-side.
  await bobPage.reload();
  await bobPage.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await bobPage.click('.chat-item:has-text("Alice")');
  await bobPage.waitForTimeout(500);
  const stillGoneAfterReload = await bobPage.evaluate((id) => {
    const msg = APP.messages[APP.currentChatId]?.find(m => m.id === id);
    return msg && msg.fileData === null && msg.viewOnceOpened === true;
  }, msgId);
  console.log('After a full page reload (fresh history from server), the photo is still gone — really wiped server-side:', stillGoneAfterReload);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
