const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Emoji Test');
  await page.fill('#regUsername', 'emojitest_' + ts);
  await page.fill('#regPhone', '+3512' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'emojitest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Open a chat so the message input picker is meaningful.
  await page.waitForSelector('.chat-item', { timeout: 8000 });
  await page.click('.chat-item');
  await page.waitForTimeout(300);

  // --- Open picker: builds tabs + grid, defaults to "Sorrisos" (no recents yet) ---
  await page.evaluate(() => toggleEmojiPicker('messageInput'));
  await page.waitForSelector('#emojiPickerMain.active', { timeout: 3000 });
  const tabCount = await page.evaluate(() => document.querySelectorAll('#emojiPickerMain .emoji-picker-tabs button').length);
  console.log('Mostra uma aba por categoria + "Recentes" (9 categorias + recentes = 10):', tabCount === 10);
  const defaultCategory = await page.evaluate(() => document.querySelector('#emojiPickerMain .emoji-picker-tabs button.active').dataset.category);
  console.log('Sem recentes ainda, abre por omissão em "Sorrisos":', defaultCategory === 'Sorrisos');
  const smileysCount = await page.evaluate(() => document.querySelectorAll('#emojiPickerMainGrid span').length);
  console.log('A categoria "Sorrisos" tem muito mais do que os 30 antigos (biblioteca maior):', smileysCount > 60);

  // --- Switch categories ---
  await page.evaluate(() => renderEmojiPickerCategory('emojiPickerMain', 'Animais'));
  const animalsShown = await page.evaluate(() => document.getElementById('emojiPickerMainGrid').textContent.includes('🐶'));
  console.log('Mudar para "Animais" mostra emojis de animais:', animalsShown);
  const animalsTabActive = await page.evaluate(() => document.querySelector('#emojiPickerMain .emoji-picker-tabs button.active').dataset.category === 'Animais');
  console.log('A aba ativa muda corretamente para "Animais":', animalsTabActive);

  await page.evaluate(() => renderEmojiPickerCategory('emojiPickerMain', 'Bandeiras'));
  const portugalFlagShown = await page.evaluate(() => document.getElementById('emojiPickerMainGrid').textContent.includes('🇵🇹'));
  console.log('A categoria "Bandeiras" inclui a bandeira de Portugal:', portugalFlagShown);

  // --- Inserting an emoji works and adds it to "Recentes" ---
  await page.evaluate(() => renderEmojiPickerCategory('emojiPickerMain', 'Sorrisos'));
  await page.evaluate(() => insertEmoji('🥳'));
  const insertedIntoInput = await page.evaluate(() => document.getElementById('messageInput').value === '🥳');
  console.log('Clicar num emoji insere-o no campo de mensagem:', insertedIntoInput);

  await page.evaluate(() => renderEmojiPickerCategory('emojiPickerMain', 'Recentes'));
  const recentShowsIt = await page.evaluate(() => document.getElementById('emojiPickerMainGrid').textContent.includes('🥳'));
  console.log('O emoji usado aparece na aba "Recentes":', recentShowsIt);

  // Insert a second, different emoji — recents should show the newest first.
  await page.evaluate(() => insertEmoji('🔥'));
  await page.evaluate(() => renderEmojiPickerCategory('emojiPickerMain', 'Recentes'));
  const newestFirst = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('#emojiPickerMainGrid span')];
    return spans[0]?.textContent === '🔥';
  });
  console.log('Recentes mostra o mais usado recentemente primeiro:', newestFirst);

  // --- No duplicates in recents when reusing the same emoji ---
  await page.evaluate(() => insertEmoji('🥳'));
  const recentCountAfterReuse = await page.evaluate(() => JSON.parse(localStorage.getItem('recentEmojis')).filter(e => e === '🥳').length);
  console.log('Reutilizar um emoji não duplica na lista de recentes:', recentCountAfterReuse === 1);

  // --- Independent picker instance for the call chat panel ---
  const callPickerIsDifferentElement = await page.evaluate(() => document.getElementById('emojiPicker') !== document.getElementById('emojiPickerMain'));
  console.log('O picker do chat da chamada é uma instância independente do principal:', callPickerIsDifferentElement);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
