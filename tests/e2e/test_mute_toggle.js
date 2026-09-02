const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Mute Toggle Teste');
  await page.fill('#regUsername', 'mute_toggle_' + ts);
  await page.fill('#regPhone', '+3515' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'mutetoggle' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);
  await page.click('.chat-item:has-text("Gemini")');
  await page.waitForTimeout(300);

  await page.click('button[onclick="openChatMoreModal()"]');
  await page.waitForSelector('#modalChatMore.active');
  const before = await page.textContent('#muteToggleIcon');
  const labelBefore = await page.textContent('#muteToggleBtn');
  console.log('Icon before toggling:', before.trim());
  console.log('Label preserved before toggling:', labelBefore.includes('Silenciar'));

  await page.click('#muteToggleBtn');
  await page.waitForTimeout(200);
  await page.click('button[onclick="openChatMoreModal()"]');
  await page.waitForSelector('#modalChatMore.active');
  const after = await page.textContent('#muteToggleIcon');
  const labelAfter = await page.textContent('#muteToggleBtn');
  console.log('Icon changed after toggling mute:', before.trim() !== after.trim(), after.trim());
  console.log('Label still present after toggling (no wipeout):', labelAfter.includes('Silenciar') || labelAfter.includes('notifica'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
