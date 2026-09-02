const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Font Test');
  await page.fill('#regUsername', 'fonttest_' + ts);
  await page.fill('#regPhone', '+3511' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'fonttest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Send a message so we have something to measure.
  await page.evaluate(() => {
    APP.chats.push({ id: 'dm_selftest', name: 'Self Test', phone: '+351000000001', type: 'user' });
    renderChatList();
  });
  await page.click('.chat-item:has-text("Self Test")');
  await page.waitForTimeout(200);
  await page.fill('#messageInput', 'mensagem de teste de tamanho');
  await page.press('#messageInput', 'Enter');
  await page.waitForTimeout(300);

  const initialFontSize = await page.evaluate(() => getComputedStyle(document.querySelector('#chatMessages .message.sent')).fontSize);
  console.log('Default message font size is 14px:', initialFontSize === '14px');

  // Open customize modal and check the slider reflects the default.
  await page.evaluate(() => openCustomizeModal());
  await page.waitForSelector('#modalCustomize.active');
  const sliderDefault = await page.inputValue('#msgFontSizeSlider');
  console.log('Slider defaults to 14:', sliderDefault === '14');

  // Drag the slider to 20 and confirm live preview + persistence.
  await page.fill('#msgFontSizeSlider', '20');
  await page.dispatchEvent('#msgFontSizeSlider', 'input');
  await page.waitForTimeout(150);
  const liveFontSize = await page.evaluate(() => getComputedStyle(document.querySelector('#chatMessages .message.sent')).fontSize);
  console.log('Live preview updates the message font size to 20px:', liveFontSize === '20px');
  const labelText = await page.textContent('#msgFontSizeLabel');
  console.log('Label shows 20px:', labelText === '20px');

  await page.dispatchEvent('#msgFontSizeSlider', 'change');
  await page.waitForTimeout(100);
  const savedValue = await page.evaluate(() => localStorage.getItem('msgFontSize'));
  console.log('Change event persists 20 to localStorage:', savedValue === '20');

  // Reload and confirm the size survives (applied on page load, before login even,
  // via the CSS custom property directly — the fake self-DM chat used above
  // isn't a real conversation, so there is no message left to render after reload).
  await page.reload();
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);
  const cssVarAfterReload = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-size-msg').trim());
  console.log('Font size CSS variable persists across reload:', cssVarAfterReload === '20px');

  // Reopening the modal should show the slider at the persisted value, not reset to 14.
  await page.evaluate(() => openCustomizeModal());
  await page.waitForSelector('#modalCustomize.active');
  const sliderAfterReload = await page.inputValue('#msgFontSizeSlider');
  console.log('Slider reflects the persisted value on reopen:', sliderAfterReload === '20');

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
