const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Media Menu Teste');
  await page.fill('#regUsername', 'media_menu_' + ts);
  await page.fill('#regPhone', '+3513' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'mediamenu' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  // 1) The 5 media features and Atividades should no longer be direct header buttons.
  const directFns = ['openTvScreen()', 'openWatchScreen()', 'openNewsScreen()', 'openJamendoScreen()', 'openFunnyFeedScreen()', 'openActivitiesScreen()'];
  for (const fn of directFns) {
    const count = await page.locator(`.header-actions > button[onclick="${fn}"]`).count();
    console.log(`Direct header button for ${fn} (should be 0):`, count);
  }

  // 2) "Mais" now includes Atividades.
  await page.click('button[onclick="openMoreFeaturesModal()"]');
  await page.waitForSelector('#modalMoreFeatures.active');
  const hasActivities = await page.locator('#modalMoreFeatures button:has-text("Atividades")').count();
  console.log('Atividades inside "Mais":', hasActivities > 0);
  await page.click('#modalMoreFeatures button:has-text("Fechar")');
  await page.waitForTimeout(200);

  // 3) New "Multimédia" (🎬) button opens a grid with the 5 media features.
  await page.click('#mediaBtn');
  await page.waitForSelector('#modalMediaFeatures.active');
  const mediaButtons = await page.locator('#modalMediaFeatures button.btn-small').allTextContents();
  console.log('Media modal buttons:', mediaButtons.map(t => t.trim()));

  // 4) Clicking one (TV em Direto) actually opens the right screen and closes the modal.
  await page.click('#modalMediaFeatures button:has-text("TV em Direto")');
  await page.waitForTimeout(300);
  const tvOpen = await page.locator('#tvScreen').evaluate(el => el.classList.contains('active'));
  const modalClosed = await page.locator('#modalMediaFeatures').evaluate(el => !el.classList.contains('active'));
  console.log('TV screen opened:', tvOpen);
  console.log('Media modal closed after click:', modalClosed);

  // 5) News badge still toggles correctly on the moved #newsBadge (now inside #mediaBtn).
  await page.evaluate(() => document.getElementById('newsBadge').style.display = 'block');
  const badgeVisible = await page.locator('#mediaBtn #newsBadge').evaluate(el => getComputedStyle(el).display !== 'none');
  console.log('News badge visible on #mediaBtn when set:', badgeVisible);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
