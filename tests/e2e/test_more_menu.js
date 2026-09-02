const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'More Menu Teste');
  await page.fill('#regUsername', 'more_menu_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'moremenu' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  // Confirm the 7 buttons no longer live directly in the header.
  const directButtons = ['openTransportScreen()', 'openDriveListenScreen()', 'openNavScreen()', 'openFiresScreen()', 'openSpaceScreen()', 'openCurrencyScreen()', 'openCalcScreen()'];
  for (const fn of directButtons) {
    const count = await page.locator(`.header-actions > button[onclick="${fn}"]`).count();
    console.log(`Header no longer has a direct button for ${fn}:`, count === 0);
  }

  // Open the "Mais" modal and verify all 7 are inside it, functional.
  await page.click('button[onclick="openMoreFeaturesModal()"]');
  await page.waitForSelector('#modalMoreFeatures.active');
  const gridButtons = await page.locator('#modalMoreFeatures button.btn-small').allTextContents();
  console.log('Grid buttons in "Mais":', gridButtons.map(t => t.trim()));

  // Click one to confirm it actually opens the target screen (Calculadora) and closes the modal.
  await page.click('#modalMoreFeatures button:has-text("Calculadora")');
  await page.waitForTimeout(300);
  const calcOpen = await page.locator('#calcScreen').evaluate(el => el.classList.contains('active'));
  const modalClosed = await page.locator('#modalMoreFeatures').evaluate(el => !el.classList.contains('active'));
  console.log('Calc screen opened after clicking grid item:', calcOpen);
  console.log('"Mais" modal closed after clicking grid item:', modalClosed);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
