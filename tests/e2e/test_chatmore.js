const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'ChatMore Teste');
  await page.fill('#regUsername', 'chatmore_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'chatmore' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  // Create a group to test as an admin (group creator becomes admin) so manageGroupBtn is visible.
  const groupName = 'Grupo ChatMore ' + ts;
  await page.click('button[onclick="openContactsFeaturesModal()"]');
  await page.waitForSelector('#modalContactsFeatures.active');
  await page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await page.waitForSelector('#modalCreateGroup.active');
  await page.fill('#groupName', groupName);
  await page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await page.waitForTimeout(600);
  await page.click(`.chat-item:has-text("${groupName}")`);
  await page.waitForTimeout(300);

  // Header should now only show call buttons + the "..." button directly.
  const headerButtons = await page.locator('.chat-header > div[style*="margin-left:auto"] > button').count();
  console.log('Only 3 direct buttons in chat-header (voice, video, more):', headerButtons === 3);

  const directTitles = await page.locator('.chat-header > div[style*="margin-left:auto"] > button').evaluateAll(els => els.map(e => e.title));
  console.log('Direct buttons are exactly calls + more:', JSON.stringify(directTitles));

  // Open the "..." menu.
  await page.click('button[onclick="openChatMoreModal()"]');
  await page.waitForSelector('#modalChatMore.active');
  const gridButtons = await page.locator('#modalChatMore button.btn-small').allTextContents();
  console.log('Grid contains all 13 moved options + Fechar:', gridButtons.length === 14, gridButtons.map(t => t.trim()));

  // As group creator/admin, "Gerir grupo" should be visible inside the menu.
  const manageGroupVisible = await page.locator('#manageGroupBtn').evaluate(el => getComputedStyle(el).display !== 'none');
  console.log('Gerir grupo visible (creator is admin):', manageGroupVisible);

  // VR room should also be visible (group chat).
  const vrVisible = await page.locator('#vrRoomBtn').evaluate(el => getComputedStyle(el).display !== 'none');
  console.log('Sala VR visible (group chat):', vrVisible);

  // Bloquear should stay hidden (group chats don't show block).
  const blockVisible = await page.locator('#blockUserBtn').evaluate(el => getComputedStyle(el).display !== 'none');
  console.log('Bloquear hidden in group chat:', !blockVisible);

  // Click "Pesquisar" -> should close this modal and open the in-chat search bar.
  await page.click('#modalChatMore button:has-text("Pesquisar")');
  await page.waitForTimeout(300);
  const modalClosed = await page.locator('#modalChatMore').evaluate(el => !el.classList.contains('active'));
  const searchBarVisible = await page.locator('#chatSearchBar').evaluate(el => getComputedStyle(el).display !== 'none');
  console.log('Menu closed after clicking an item:', modalClosed);
  console.log('Chat search bar opened as a result:', searchBarVisible);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
