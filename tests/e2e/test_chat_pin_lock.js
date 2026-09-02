const { chromium } = require('playwright');

async function typePin(page, digits) {
  for (const d of digits) {
    await page.click(`.pin-key:has-text("${d}")`);
    await page.waitForTimeout(80);
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Chat Lock Test');
  await page.fill('#regUsername', 'chatlock_' + ts);
  await page.fill('#regPhone', '+3512' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'chatlock' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.chats.push({ id: 'lockchatA', type: 'user', name: 'Segredo A', phone: '+351911111111' });
    APP.chats.push({ id: 'lockchatB', type: 'user', name: 'Normal B', phone: '+351922222222' });
    APP.messages['lockchatA'] = [{ id: 'm1', sender: 'Segredo A', text: 'informação muito privada', time: '10:00', type: 'received' }];
    renderChatList();
  });

  // --- Trying to lock a chat without a PIN set must be refused with a clear message ---
  let noPinDialogShown = false;
  page.on('dialog', d => { if (d.message().includes('PIN primeiro')) noPinDialogShown = true; d.accept(); });
  await page.evaluate(() => { APP.currentChatId = 'lockchatA'; toggleLockChat(); });
  await page.waitForTimeout(200);
  console.log('Sem PIN definido, tentar bloquear mostra um aviso claro:', noPinDialogShown);
  const notLockedWithoutPin = await page.evaluate(() => !APP.lockedChats.has('lockchatA'));
  console.log('A conversa não fica bloqueada sem um PIN definido:', notLockedWithoutPin);

  // --- Create a PIN first ---
  await page.evaluate(() => openPinSetupModal());
  await page.click('button:has-text("Criar PIN")');
  await page.waitForSelector('#pinLockScreen', { state: 'visible' });
  await typePin(page, '1234');
  await page.waitForTimeout(150);
  await typePin(page, '1234');
  await page.waitForTimeout(300);
  await page.click('#modalPinSetup button:has-text("Fechar")');

  // --- Now locking works, and closes the currently open chat ---
  await page.evaluate(() => { APP.currentChatId = 'lockchatA'; openChat('lockchatA'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => toggleLockChat());
  await page.waitForTimeout(300);
  const lockedNow = await page.evaluate(() => APP.lockedChats.has('lockchatA'));
  console.log('Bloquear a conversa funciona depois de haver um PIN:', lockedNow);
  const chatClosedAfterLock = await page.evaluate(() => !document.getElementById('chatArea').classList.contains('active'));
  console.log('A conversa fecha-se logo depois de a bloquear:', chatClosedAfterLock);

  // --- The locked chat disappears from the sidebar, replaced by a summary row ---
  const nameHiddenFromList = await page.evaluate(() => ![...document.querySelectorAll('#chatList h4')].some(el => el.textContent.includes('Segredo A')));
  console.log('O nome da conversa bloqueada desaparece da lista:', nameHiddenFromList);
  const otherChatStillVisible = await page.evaluate(() => [...document.querySelectorAll('#chatList h4')].some(el => el.textContent.includes('Normal B')));
  console.log('As outras conversas continuam visíveis normalmente:', otherChatStillVisible);
  const summaryRowShown = await page.evaluate(() => document.getElementById('chatList').innerText.includes('Conversas bloqueadas') && document.getElementById('chatList').innerText.includes('1 conversa'));
  console.log('Aparece uma linha resumo "Conversas bloqueadas":', summaryRowShown);

  // --- Global search must not leak the locked chat's content ---
  await page.click('button[onclick="openGlobalSearchModal()"]');
  await page.waitForSelector('#modalGlobalSearch.active');
  await page.fill('#globalSearchInput', 'informação muito privada');
  await page.waitForTimeout(400);
  const searchFindsNothing = await page.evaluate(() => document.getElementById('globalSearchResults').innerText.includes('Nenhuma mensagem encontrada'));
  console.log('A pesquisa global não encontra conteúdo de uma conversa bloqueada:', searchFindsNothing);
  await page.click('#modalGlobalSearch button:has-text("Fechar")').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => closeModal('modalGlobalSearch'));

  // --- Trying to open the locked chat directly (e.g. a stale reference) asks for the PIN instead ---
  await page.evaluate(() => openChat('lockchatA'));
  await page.waitForTimeout(200);
  const pinAskedInstead = await page.evaluate(() => document.getElementById('pinLockScreen').style.display === 'flex' && document.getElementById('chatArea').classList.contains('active') === false);
  console.log('Abrir a conversa bloqueada diretamente pede o PIN em vez de a mostrar:', pinAskedInstead);

  // Wrong PIN keeps it hidden.
  await typePin(page, '0000');
  await page.waitForTimeout(200);
  const stillHiddenAfterWrong = await page.evaluate(() => !APP.lockedChatsRevealed && document.getElementById('pinLockScreen').style.display === 'flex');
  console.log('PIN errado mantém a conversa escondida:', stillHiddenAfterWrong);

  // Correct PIN reveals it AND opens the chat that was requested.
  await typePin(page, '1234');
  await page.waitForTimeout(300);
  const revealedAndOpened = await page.evaluate(() => APP.lockedChatsRevealed && APP.currentChatId === 'lockchatA' && document.getElementById('chatName').textContent === 'Segredo A');
  console.log('PIN certo revela a conversa e abre-a automaticamente:', revealedAndOpened);
  const badgeShown = await page.evaluate(() => [...document.querySelectorAll('.chat-item h4')].some(el => el.textContent.includes('Segredo A') && el.textContent.includes('🔒')));
  console.log('Mostra a etiqueta 🔒 na conversa bloqueada quando revelada:', badgeShown);

  // --- Backgrounding the tab re-hides the locked section again ---
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  const rehiddenAfterBackground = await page.evaluate(() => !APP.lockedChatsRevealed);
  console.log('Voltar de segundo plano volta a esconder as conversas bloqueadas:', rehiddenAfterBackground);
  await typePin(page, '1234'); // unlock the app-wide screen again to continue

  // --- Unlocking (toggling off) makes it a normal chat again ---
  await page.waitForTimeout(300);
  await page.evaluate(() => { APP.currentChatId = 'lockchatA'; toggleLockChat(); });
  await page.waitForTimeout(300);
  const unlockedNow = await page.evaluate(() => !APP.lockedChats.has('lockchatA'));
  console.log('Desbloquear a conversa faz com que volte a aparecer normalmente:', unlockedNow);
  const backInNormalList = await page.evaluate(() => [...document.querySelectorAll('#chatList h4')].some(el => el.textContent.includes('Segredo A')));
  console.log('A conversa volta a aparecer na lista normal depois de desbloqueada:', backInNormalList);

  // --- Removing the PIN entirely auto-unlocks any remaining locked chats ---
  await page.evaluate(() => { APP.currentChatId = 'lockchatB'; toggleLockChat(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => openPinSetupModal());
  await page.click('button:has-text("Remover PIN")');
  await page.waitForSelector('#pinLockScreen', { state: 'visible' });
  await typePin(page, '1234');
  await page.waitForTimeout(300);
  const autoUnlockedAfterPinRemoved = await page.evaluate(() => APP.lockedChats.size === 0 && [...document.querySelectorAll('#chatList h4')].some(el => el.textContent.includes('Normal B')));
  console.log('Remover o PIN desbloqueia automaticamente as conversas que ainda estavam bloqueadas:', autoUnlockedAfterPinRemoved);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
