const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Icon Size Test');
  await page.fill('#regUsername', 'iconsize_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'iconsize' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.chats.push({ id: 'iconsizegroup', type: 'group', name: 'Icon Size Group' });
    APP.messages['iconsizegroup'] = [];
    openChat('iconsizegroup');
  });
  await page.waitForTimeout(400);

  const sizes = await page.evaluate(() => {
    const btns = document.querySelectorAll('.chat-input-area .btn-icon');
    return [...btns].map(b => ({ w: b.offsetWidth, h: b.offsetHeight, visible: getComputedStyle(b).display !== 'none' }));
  });
  console.log('Icon buttons found in the input bar:', sizes.length);
  console.log('All icon buttons are now 28x28 (down from 34x34):', sizes.every(s => s.w === 28 && s.h === 28));

  const inputWidthBefore = await page.evaluate(() => document.getElementById('messageInput').getBoundingClientRect().width);
  console.log('Message input width with smaller icons (px):', inputWidthBefore);

  // Compare against the OLD size to confirm more room was actually freed up.
  await page.evaluate(() => {
    document.querySelectorAll('.chat-input-area .btn-icon').forEach(b => {
      b.style.width = '34px'; b.style.height = '34px'; b.style.fontSize = '15px';
    });
  });
  await page.waitForTimeout(100);
  const inputWidthOldSize = await page.evaluate(() => document.getElementById('messageInput').getBoundingClientRect().width);
  console.log('Message input width with the OLD 34px icons (px, for comparison):', inputWidthOldSize);
  console.log('Shrinking the icons actually frees up extra width for typing:', inputWidthBefore > inputWidthOldSize);

  // Sanity: buttons remain clickable/functional at the smaller size (emoji picker still opens).
  await page.evaluate(() => {
    document.querySelectorAll('.chat-input-area .btn-icon').forEach(b => {
      b.style.width = '28px'; b.style.height = '28px'; b.style.fontSize = '13px';
    });
  });
  await page.click('.chat-input-area .btn-icon:has-text("😊")');
  await page.waitForTimeout(200);
  const emojiPickerOpened = await page.evaluate(() => document.getElementById('emojiPickerMain').classList.contains('active'));
  console.log('Smaller emoji button is still clickable and opens the picker:', emojiPickerOpened);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
