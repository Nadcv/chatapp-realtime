// Deleting an account from one device must force-logout that account's
// OTHER active device too, with a clear explanation (not just a silent
// disconnect that looks like a network glitch).
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto('http://localhost:3000');
  await page1.click('.login-switch');
  const ts = Date.now();
  const phone = '+3512' + ts.toString().slice(-8);
  await page1.fill('#regName', 'MultiDelete');
  await page1.fill('#regUsername', 'multidel_' + ts);
  await page1.fill('#regPhone', phone);
  await page1.selectOption('#regCountry', 'Portugal');
  await page1.fill('#regEmail', 'multidel' + ts + '@test.com');
  await page1.fill('#regPassword', 'senha1234forte');
  await page1.click('button:has-text("Criar conta")');
  await page1.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Log in on a second device/context with the same account.
  const page2 = await ctx2.newPage();
  await page2.goto('http://localhost:3000');
  await page2.fill('#loginPhone', phone);
  await page2.fill('#loginPassword', 'senha1234forte');
  await page2.click('button:has-text("Entrar")');
  await page2.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  console.log('2º dispositivo entrou com sucesso na mesma conta:', true);

  let dialogMessages = [];
  page2.on('dialog', d => { dialogMessages.push(d.message()); d.accept(); });

  // Delete the account from device 1.
  page1.on('dialog', d => d.accept());
  await page1.evaluate(() => openDeleteAccountModal());
  await page1.fill('#deleteAccountPasswordInput', 'senha1234forte');
  await page1.click('button:has-text("Apagar definitivamente")');
  await page1.waitForSelector('#loginFormBox', { state: 'visible', timeout: 5000 });
  console.log('Dispositivo 1 (quem apagou) volta ao ecrã de login:', true);

  await page2.waitForTimeout(1000);
  const gotWarned = dialogMessages.some(m => m.includes('apagada'));
  console.log('Dispositivo 2 (a OUTRA sessão) recebe um aviso claro de que a conta foi apagada:', gotWarned);
  const device2LoggedOut = await page2.evaluate(() => document.getElementById('mainApp').style.display === 'none' || document.getElementById('loginScreen').classList.contains('hidden') === false);
  console.log('Dispositivo 2 é forçado a sair (não fica preso com uma sessão morta):', device2LoggedOut);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
