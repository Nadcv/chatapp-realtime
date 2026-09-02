const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');

  const ts = Date.now();
  async function tryRegister(password) {
    await page.fill('#regName', 'Weak Pass Test');
    await page.fill('#regUsername', 'weakpass_' + ts + '_' + Math.random().toString(36).slice(2, 6));
    await page.fill('#regPhone', '+3517' + (ts + Math.floor(Math.random() * 10000)).toString().slice(-8));
    await page.selectOption('#regCountry', 'Portugal');
    await page.fill('#regEmail', 'weakpass' + ts + Math.random() + '@test.com');
    await page.fill('#regPassword', password);
    await page.click('button:has-text("Criar conta")');
    await page.waitForTimeout(400);
    return await page.evaluate(() => document.getElementById('registerError').textContent);
  }

  const shortErr = await tryRegister('abc12');
  console.log('Rejects a password under 8 chars:', shortErr.includes('8 caracteres'));

  const commonErr = await tryRegister('password123');
  console.log('Rejects a well-known common password:', commonErr.includes('comum') || commonErr.includes('fácil'));

  const seqErr = await tryRegister('12345678');
  console.log('Rejects a simple sequential password:', seqErr.includes('comum') || seqErr.includes('fácil'));

  const repeatErr = await tryRegister('aaaaaaaa');
  console.log('Rejects an all-repeated-character password:', repeatErr.includes('comum') || repeatErr.includes('fácil'));

  // A strong password must still succeed and actually log the user in.
  const strongResult = await tryRegister('Tr8!qLzx#9');
  const loggedIn = await page.evaluate(() => document.getElementById('mainApp').style.display === 'flex');
  console.log('A strong password is accepted and logs the user in:', loggedIn, '(error shown:', JSON.stringify(strongResult) + ')');

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
