const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const ctx = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Selfie Group Teste');
  await page.fill('#regUsername', 'selfie_grp_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'selfiegrp' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(500);

  // Simula estar numa chamada em grupo (bypassa a criação real do grupo,
  // que não é o que este teste está a validar) e abre o self.
  await page.evaluate(() => {
    APP.currentChatId = 'grp_test_123';
    APP.chats.push({ id: 'grp_test_123', name: 'Grupo Teste', type: 'group' });
    joinGroupCall('video');
  });
  await page.waitForFunction(() => document.getElementById('tile_me') && document.querySelector('#tile_me video')?.videoWidth > 0, { timeout: 8000 });
  console.log('Group call joined, tile_me has video.');

  await page.click('button[onclick="openSelfieCam()"]');
  await page.waitForSelector('#selfieCamOverlay.active');
  await page.waitForTimeout(600); // deixa alguns frames desenharem

  const canvasHasContent = await page.evaluate(() => {
    const canvas = document.getElementById('selfieCanvas');
    return canvas.width > 0 && canvas.height > 0;
  });
  console.log('Selfie canvas has dimensions (was broken before, read empty #pipVideo in group calls):', canvasHasContent);

  const bgChips = await page.locator('#selfieBackgroundRow .selfie-chip').allTextContents();
  console.log('Background chips rendered:', bgChips);

  await page.click('button[onclick="setSelfieBackground(\'purple\')"]');
  await page.waitForTimeout(400);
  const activeBg = await page.evaluate(() => SELFIE.background);
  console.log('Active background after selecting Roxo:', activeBg);

  await page.click('#selfieShutterBtn');
  await page.waitForTimeout(200);
  const captured = await page.evaluate(() => !!SELFIE.captured && SELFIE.captured.startsWith('data:image/jpeg'));
  console.log('Selfie captured with background applied:', captured);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
