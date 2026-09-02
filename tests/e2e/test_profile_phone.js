const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  const phone = '+3519' + ts.toString().slice(-8);
  await page.fill('#regName', 'Profile Phone Teste');
  await page.fill('#regUsername', 'profile_phone_' + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'profilephone' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  await page.click('#headerAvatar');
  await page.waitForSelector('#modalProfile.active');
  const phoneLabel = await page.textContent('#profilePhoneLabel');
  console.log('Registered phone:', phone);
  console.log('Profile phone label:', phoneLabel);
  console.log('Matches:', phoneLabel.includes(phone));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
