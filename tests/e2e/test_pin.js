const { chromium } = require('playwright');

async function typePin(page, digits) {
  for (const d of digits) {
    await page.click(`.pin-key:has-text("${d}")`);
    await page.waitForTimeout(80);
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Pin Test');
  await page.fill('#regUsername', 'pintest_' + ts);
  await page.fill('#regPhone', '+3513' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'pintest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // --- No PIN set yet: lock screen must not appear ---
  const lockVisibleInitially = await page.evaluate(() => document.getElementById('pinLockScreen').style.display === 'flex');
  console.log('Lock screen hidden when no PIN is set:', !lockVisibleInitially);

  // --- Create a PIN via the setup modal ---
  await page.evaluate(() => openPinSetupModal());
  await page.waitForSelector('#modalPinSetup.active');
  const statusBefore = await page.textContent('#pinSetupStatus');
  console.log('Setup modal shows "disabled" before creating one:', statusBefore.includes('desativado'));
  await page.click('button:has-text("Criar PIN")');
  await page.waitForSelector('#pinLockScreen', { state: 'visible' });
  const labelDuringCreate = await page.textContent('#pinLockScreen > div:nth-child(2)');
  console.log('Shows "Cria o novo PIN" label:', labelDuringCreate.includes('Cria o novo PIN'));

  await typePin(page, '1234');
  await page.waitForTimeout(200);
  const labelDuringConfirm = await page.textContent('#pinLockScreen > div:nth-child(2)');
  console.log('Moves to confirm step after first entry:', labelDuringConfirm.includes('Confirma o PIN'));

  // Mismatched confirm should reject and restart.
  await typePin(page, '0000');
  await page.waitForTimeout(200);
  const errorAfterMismatch = await page.textContent('#pinError');
  const labelAfterMismatch = await page.textContent('#pinLockScreen > div:nth-child(2)');
  console.log('Mismatched confirmation shows an error:', errorAfterMismatch.includes('não coincidem'));
  console.log('Restarts at "Cria o novo PIN" after mismatch:', labelAfterMismatch.includes('Cria o novo PIN'));

  // Now do it correctly.
  await typePin(page, '1234');
  await page.waitForTimeout(200);
  await typePin(page, '1234');
  await page.waitForTimeout(300);
  const modalReopened = await page.evaluate(() => document.getElementById('modalPinSetup').classList.contains('active'));
  const statusAfter = await page.textContent('#pinSetupStatus');
  console.log('Returns to setup modal after successful creation:', modalReopened);
  console.log('Setup modal now shows "ativo":', statusAfter.includes('ativo'));
  const hashStored = await page.evaluate(() => !!localStorage.getItem('pinHash'));
  console.log('PIN hash actually persisted in localStorage:', hashStored);
  const plainPinNotStored = await page.evaluate(() => {
    const raw = localStorage.getItem('pinHash') || '';
    return !raw.includes('1234') && raw.length === 64; // SHA-256 hex = 64 chars, and never the raw PIN
  });
  console.log('Stored value is a SHA-256 hash, not the plain PIN:', plainPinNotStored);
  await page.click('#modalPinSetup button:has-text("Fechar")');

  // --- Reload the page: PIN lock must appear on session restore ---
  await page.reload();
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);
  const lockShownOnReload = await page.evaluate(() => document.getElementById('pinLockScreen').style.display === 'flex');
  console.log('Lock screen appears automatically after reload (session restore):', lockShownOnReload);

  // Wrong PIN should reject and clear, not unlock.
  await typePin(page, '9999');
  await page.waitForTimeout(300);
  const stillLockedAfterWrong = await page.evaluate(() => document.getElementById('pinLockScreen').style.display === 'flex');
  const wrongPinError = await page.textContent('#pinError');
  console.log('Wrong PIN keeps the app locked:', stillLockedAfterWrong);
  console.log('Wrong PIN shows an error message:', wrongPinError.includes('incorreto'));

  // Correct PIN should unlock.
  await typePin(page, '1234');
  await page.waitForTimeout(300);
  const unlockedAfterCorrect = await page.evaluate(() => document.getElementById('pinLockScreen').style.display === 'none');
  console.log('Correct PIN unlocks the app:', unlockedAfterCorrect);

  // --- Simulate backgrounding the tab and returning: must re-lock ---
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  const relockedAfterVisibility = await page.evaluate(() => document.getElementById('pinLockScreen').style.display === 'flex');
  console.log('Re-locks after tab becomes visible again (backgrounding):', relockedAfterVisibility);
  await typePin(page, '1234');
  await page.waitForTimeout(200);

  // --- Change PIN flow ---
  await page.evaluate(() => openPinSetupModal());
  await page.click('button:has-text("Alterar PIN")');
  await page.waitForSelector('#pinLockScreen', { state: 'visible' });
  const changeLabel = await page.textContent('#pinLockScreen > div:nth-child(2)');
  console.log('Change flow asks for current PIN first:', changeLabel.includes('atual'));
  const cancelBtnLabel = await page.textContent('#pinLockScreen button.btn-small');
  console.log('Change flow shows Cancelar instead of Esqueci o PIN:', cancelBtnLabel.includes('Cancelar'));
  await typePin(page, '1234'); // old pin
  await page.waitForTimeout(200);
  await typePin(page, '5678'); // new pin
  await page.waitForTimeout(200);
  await typePin(page, '5678'); // confirm new pin
  await page.waitForTimeout(300);
  const hashChanged = await page.evaluate(() => localStorage.getItem('pinHash'));

  // Verify the NEW pin actually works by re-locking and testing it.
  await page.evaluate(() => showPinUnlockScreen());
  await typePin(page, '5678');
  await page.waitForTimeout(200);
  const unlockedWithNewPin = await page.evaluate(() => document.getElementById('pinLockScreen').style.display === 'none');
  console.log('New PIN (5678) unlocks after change:', unlockedWithNewPin);

  // --- Remove PIN flow ---
  await page.evaluate(() => openPinSetupModal());
  await page.click('button:has-text("Remover PIN")');
  await page.waitForSelector('#pinLockScreen', { state: 'visible' });
  await typePin(page, '5678');
  await page.waitForTimeout(300);
  const pinRemoved = await page.evaluate(() => !localStorage.getItem('pinHash'));
  console.log('PIN removed from localStorage after remove flow:', pinRemoved);

  // Reload again: with no PIN, lock screen must not reappear.
  await page.reload();
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);
  const lockGoneAfterRemoval = await page.evaluate(() => document.getElementById('pinLockScreen').style.display !== 'flex');
  console.log('No lock screen after removing the PIN and reloading:', lockGoneAfterRemoval);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
