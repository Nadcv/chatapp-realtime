const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 360, height: 700 } }); // narrow phone width
  const page = await context.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'UI Fix Test');
  await page.fill('#regUsername', 'uifixtest_' + ts);
  await page.fill('#regPhone', '+3508' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'uifixtest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.chats.push({ id: 'dm_uifix', name: 'UI Fix Chat', phone: '+351000000006', type: 'user' });
    renderChatList();
  });
  await page.click('.chat-item:has-text("UI Fix Chat")');
  await page.waitForTimeout(200);

  // --- Test 1: compose-row icons are smaller and fit within a narrow viewport ---
  const iconSize = await page.evaluate(() => {
    const btn = document.querySelector('.chat-input-area button.btn-icon');
    return { width: btn.offsetWidth, height: btn.offsetHeight };
  });
  // Encolheram mais uma vez desde que este teste foi escrito (42px -> 34px ->
  // 28px hoje) — o que importa é continuarem pequenos o suficiente para
  // caberem no ecrã estreito, não um valor exato específico.
  console.log('Compose icons continuam pequenos (28px):', iconSize.width === 28 && iconSize.height === 28);

  const composeAreaFits = await page.evaluate(() => {
    const area = document.querySelector('.chat-input-area');
    return area.scrollWidth <= area.clientWidth + 1; // +1 for subpixel rounding
  });
  console.log('Compose row fits within a 360px-wide screen (no horizontal overflow):', composeAreaFits);

  const sendBtnVisible = await page.evaluate(() => {
    const btn = document.querySelector('.chat-input-area button[onclick="sendMessage()"]');
    const rect = btn.getBoundingClientRect();
    return rect.right <= window.innerWidth + 1 && rect.left >= 0;
  });
  console.log('Send button (last icon) stays fully inside the viewport:', sendBtnVisible);

  // --- Test 2: translator "from" side now offers the full language list ---
  await page.evaluate(() => openTranslatorModal());
  await page.waitForSelector('#modalTranslator.active');
  const fromOptionCount = await page.evaluate(() => document.getElementById('quickTransFrom').options.length);
  const toOptionCount = await page.evaluate(() => document.getElementById('quickTransTo').options.length);
  console.log('Translator "from" side now has all 11 languages (was just PT/EN):', fromOptionCount === 11);
  console.log('Both sides have the same language list:', fromOptionCount === toOptionCount);
  const fromHasGerman = await page.evaluate(() => [...document.getElementById('quickTransFrom').options].some(o => o.value === 'de'));
  console.log('"From" side includes a non-PT/EN language (German):', fromHasGerman);

  // Swap should now fully exchange both sides regardless of language.
  await page.selectOption('#quickTransFrom', 'fr');
  await page.selectOption('#quickTransTo', 'de');
  await page.click('button[title="Trocar os dois lados"]');
  await page.waitForTimeout(200);
  const fromAfterSwap = await page.inputValue('#quickTransFrom');
  const toAfterSwap = await page.inputValue('#quickTransTo');
  console.log('Swap now fully exchanges both sides for ANY language pair (not just PT/EN):', fromAfterSwap === 'de' && toAfterSwap === 'fr');

  // Speech recognition locale should follow the selected "from" language, not just en/pt.
  await page.selectOption('#quickTransFrom', 'es');
  const recognitionLocale = await page.evaluate(() => SPEECH_RECOGNITION_LOCALES[document.getElementById('quickTransFrom').value]);
  console.log('Voice recognition locale follows the selected language (Spanish -> es-ES):', recognitionLocale === 'es-ES');

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
