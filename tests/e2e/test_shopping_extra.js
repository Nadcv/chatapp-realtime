const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3519' + ts.toString().slice(-8);
  await page.fill('#regName', name);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  const a = await register(ctxA, 'Shopping Extra A', 'shopx_a_');
  const b = await register(ctxB, 'Shopping Extra B', 'shopx_b_');

  await a.page.evaluate(() => openShoppingScreen());
  await a.page.waitForSelector('#shoppingScreen.active', { timeout: 3000 });

  // --- Category select is populated ---
  const categoryOptions = await a.page.evaluate(() => [...document.getElementById('shoppingItemCategoryInput').options].map(o => o.value));
  console.log('Category select is populated with all categories:', categoryOptions.includes('frutas') && categoryOptions.includes('limpeza') && categoryOptions.includes('outros'));
  const defaultCategory = await a.page.evaluate(() => document.getElementById('shoppingItemCategoryInput').value);
  console.log('Default category is "outros":', defaultCategory === 'outros');

  // --- Add items in different categories ---
  async function addItem(page, name, qty, category) {
    await page.fill('#shoppingItemNameInput', name);
    await page.fill('#shoppingItemQtyInput', String(qty));
    await page.selectOption('#shoppingItemCategoryInput', category);
    await page.click('#shoppingScreen button:has-text("➕")');
    await page.waitForTimeout(350);
  }
  await addItem(a.page, 'Maçã', 6, 'frutas');
  await addItem(a.page, 'Detergente', 1, 'limpeza');
  await addItem(a.page, 'Pão de forma', 1, 'padaria');
  await addItem(a.page, 'Outra Maçã', 3, 'frutas');

  const itemsByCategory = await a.page.evaluate(() => {
    const cats = {};
    SHOPPING.items.forEach(i => { cats[i.category] = (cats[i.category] || 0) + 1; });
    return cats;
  });
  console.log('Items correctly tagged with their categories:', itemsByCategory.frutas === 2 && itemsByCategory.limpeza === 1 && itemsByCategory.padaria === 1);

  // --- Grouping: category headers appear, in the fixed aisle order (frutas before padaria before limpeza) ---
  const listHtml = await a.page.evaluate(() => document.getElementById('shoppingListItems').innerHTML);
  console.log('List shows category section headers:', listHtml.includes('Frutas e Legumes') && listHtml.includes('Padaria') && listHtml.includes('Limpeza'));
  const frutasIdx = listHtml.indexOf('Frutas e Legumes');
  const padariaIdx = listHtml.indexOf('Padaria');
  const limpezaIdx = listHtml.indexOf('Limpeza');
  console.log('Categories are grouped in the fixed aisle order (Frutas < Padaria < Limpeza):', frutasIdx < padariaIdx && padariaIdx < limpezaIdx);
  console.log('Frutas section shows count of 2 items:', listHtml.includes('Frutas e Legumes (2)'));

  // --- Edit an item ---
  const maçaId = await a.page.evaluate(() => SHOPPING.items.find(i => i.name === 'Maçã').id);
  await a.page.evaluate((id) => startEditShoppingItem(id), maçaId);
  await a.page.waitForTimeout(200);
  const editModeShown = await a.page.evaluate((id) => !!document.getElementById(`shoppingEditName_${id}`), maçaId);
  console.log('Edit mode shows the inline edit form:', editModeShown);

  await a.page.fill(`#shoppingEditName_${maçaId}`, 'Maçã Fuji');
  await a.page.fill(`#shoppingEditQty_${maçaId}`, '10');
  await a.page.selectOption(`#shoppingEditCategory_${maçaId}`, 'mercearia');
  await a.page.click(`button[onclick="saveEditShoppingItem('${maçaId}')"]`);
  await a.page.waitForTimeout(400);

  const editedItem = await a.page.evaluate((id) => SHOPPING.items.find(i => i.id === id), maçaId);
  console.log('Edited item has the new name:', editedItem.name === 'Maçã Fuji');
  console.log('Edited item has the new quantity:', editedItem.qty === 10);
  console.log('Edited item has the new category:', editedItem.category === 'mercearia');
  console.log('Item ID stays the same after editing (not recreated):', editedItem.id === maçaId);

  const editModeGone = await a.page.evaluate(() => EDITING_SHOPPING_ITEM_ID === null);
  console.log('Edit mode closes after saving:', editModeGone);

  // Cancel edit test.
  const outraMaçaId = await a.page.evaluate(() => SHOPPING.items.find(i => i.name === 'Outra Maçã').id);
  await a.page.evaluate((id) => startEditShoppingItem(id), outraMaçaId);
  await a.page.waitForTimeout(200);
  await a.page.fill(`#shoppingEditName_${outraMaçaId}`, 'NOME QUE NAO DEVE FICAR');
  await a.page.evaluate(() => cancelEditShoppingItem());
  await a.page.waitForTimeout(200);
  const nameUnchangedAfterCancel = await a.page.evaluate((id) => SHOPPING.items.find(i => i.id === id).name === 'Outra Maçã', outraMaçaId);
  console.log('Cancelling edit does NOT save the typed changes:', nameUnchangedAfterCancel);

  // XSS check on edit.
  await a.page.evaluate((id) => startEditShoppingItem(id), outraMaçaId);
  await a.page.waitForTimeout(200);
  await a.page.fill(`#shoppingEditName_${outraMaçaId}`, '<img src=x onerror=alert(1)>');
  await a.page.click(`button[onclick="saveEditShoppingItem('${outraMaçaId}')"]`);
  await a.page.waitForTimeout(300);
  const editXssSafe = await a.page.evaluate(() => !document.getElementById('shoppingListItems').innerHTML.includes('<img src=x onerror'));
  console.log('XSS-safe: malicious edited name is escaped:', editXssSafe);

  // --- Sharing the list into a chat ---
  const usernameB = await b.page.evaluate(() => APP.user.username);
  await a.page.evaluate((uname) => {
    document.getElementById('modalSearchUser').classList.add('active');
    document.getElementById('searchUsernameInput').value = uname;
  }, usernameB);
  await a.page.evaluate(() => doSearchUser());
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => {
    const btn = [...document.querySelectorAll('#searchUserResult button')].find(b => b.textContent.includes('conversa'));
    if (btn) btn.click();
  });
  await a.page.waitForTimeout(500);

  await a.page.evaluate(() => openShoppingShareModal());
  await a.page.waitForSelector('#modalShoppingShare.active', { timeout: 3000 });
  const shareListShowsB = await a.page.evaluate(() => document.getElementById('shoppingShareChatList').textContent.includes('Shopping Extra B'));
  console.log('Share modal lists B as a contact to share with:', shareListShowsB);

  const dmChatId = await a.page.evaluate(() => APP.chats.find(c => c.type === 'user' && c.name === 'Shopping Extra B').id);
  await a.page.evaluate((chatId) => shareShoppingListToChat(chatId), dmChatId);
  await a.page.waitForTimeout(500);

  const modalClosedAfterShare = await a.page.evaluate(() => !document.getElementById('modalShoppingShare').classList.contains('active'));
  console.log('Share modal closes after sending:', modalClosedAfterShare);

  const aSeesSharedMessage = await a.page.evaluate((chatId) => {
    const msgs = APP.messages[chatId];
    const last = msgs[msgs.length - 1];
    return !!last.shoppingList && last.shoppingList.items.length === 4;
  }, dmChatId);
  console.log('A\'s own chat shows the shared shopping list message (4 items):', aSeesSharedMessage);

  await b.page.waitForTimeout(500);
  const bReceivesSharedList = await b.page.evaluate(() => {
    const chat = APP.chats.find(c => c.type === 'user');
    const msgs = APP.messages[chat?.id] || [];
    return msgs.some(m => m.shoppingList);
  });
  console.log('B receives the shared shopping list message:', bReceivesSharedList);

  // Check the rendered bubble content.
  const bBubbleHtml = await b.page.evaluate((chatId) => {
    APP.currentChatId = chatId;
    renderMessages();
    return document.getElementById('chatMessages').innerHTML;
  }, await b.page.evaluate(() => APP.chats.find(c => c.type === 'user').id));
  console.log('Shared list bubble shows item names:', bBubbleHtml.includes('Maçã Fuji') && bBubbleHtml.includes('Detergente') && bBubbleHtml.includes('Pão de forma'));
  console.log('Shared list bubble shows the total:', bBubbleHtml.includes('Total:'));
  console.log('Shared list bubble is XSS-safe too:', !bBubbleHtml.includes('<img src=x onerror'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
