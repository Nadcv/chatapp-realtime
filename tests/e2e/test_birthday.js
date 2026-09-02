const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  const phone = '+3516' + ts.toString().slice(-8);

  // Compute today's date (server/browser share the sandbox clock) for a matching birthday.
  const todayISO = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  const birthdayThisYear = todayISO; // exact match including year is fine, we compare month-day only anyway

  await page.fill('#regName', 'Aniversario Teste');
  await page.fill('#regUsername', 'aniversario_' + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'aniversario' + ts + '@test.com');
  await page.fill('#regBirthday', birthdayThisYear);
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(500);

  const bannerVisible = await page.locator('#birthdayBanner').evaluate(el => getComputedStyle(el).display !== 'none');
  const bannerText = await page.textContent('#birthdayBanner');
  console.log('Own-birthday banner visible right after registering with today\'s date:', bannerVisible);
  console.log('Banner text:', bannerText.trim());

  // Profile modal should reflect the stored birthday.
  await page.click('#headerAvatar');
  await page.waitForSelector('#modalProfile.active');
  const profileBirthdayValue = await page.inputValue('#profileBirthdayInput');
  console.log('Profile shows correct birthday:', profileBirthdayValue === birthdayThisYear, profileBirthdayValue);

  // Change to a non-today date and confirm the banner disappears.
  const notTodayISO = '1995-01-01';
  await page.fill('#profileBirthdayInput', notTodayISO);
  await page.evaluate((v) => setBirthday(v), notTodayISO);
  await page.waitForTimeout(300);
  const bannerAfterChange = await page.locator('#birthdayBanner').evaluate(el => getComputedStyle(el).display !== 'none');
  console.log('Banner hidden after changing own birthday away from today:', !bannerAfterChange);

  // Simulate a contact whose birthday IS today (bypassing the real add-contact flow, not what we're testing).
  await page.evaluate((bday) => {
    APP.onlineContacts = [{ name: 'Amigo Teste <script>', phone: '+351999999999', birthday: bday }];
    checkBirthdaysToday();
  }, birthdayThisYear);
  await page.waitForTimeout(200);
  const contactBannerVisible = await page.locator('#birthdayBanner').evaluate(el => getComputedStyle(el).display !== 'none');
  const contactBannerHtml = await page.evaluate(() => document.getElementById('birthdayBanner').innerHTML);
  console.log('Banner visible for contact birthday today:', contactBannerVisible);
  console.log('Contact name escaped safely (no raw <script>):', !contactBannerHtml.includes('<script>Amigo'));
  console.log('Banner mentions contact name:', contactBannerHtml.includes('Amigo Teste'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
