const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.addInitScript(() => {
    window.__pdfCalls = [];
    function FakeJsPDF() { this._lines = []; }
    FakeJsPDF.prototype.setFontSize = function () { return this; };
    FakeJsPDF.prototype.setFont = function () { return this; };
    FakeJsPDF.prototype.text = function (line) { this._lines.push(line); return this; };
    FakeJsPDF.prototype.addPage = function () { return this; };
    FakeJsPDF.prototype.save = function (filename) { window.__pdfCalls.push({ filename, lines: this._lines.slice() }); };
    window.jspdf = { jsPDF: FakeJsPDF };
  });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Units Test');
  await page.fill('#regUsername', 'units_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'units' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => openShoppingScreen());
  await page.waitForSelector('#shoppingScreen.active', { timeout: 3000 });

  const unitOptions = await page.evaluate(() => [...document.getElementById('shoppingItemUnitInput').options].map(o => o.value));
  console.log('Unit select is populated with un/kg/g/l/ml:', ['un', 'kg', 'g', 'l', 'ml'].every(u => unitOptions.includes(u)));
  const defaultUnit = await page.evaluate(() => document.getElementById('shoppingItemUnitInput').value);
  console.log('Default unit is "un":', defaultUnit === 'un');

  // Add a unit-counted item (default).
  await page.fill('#shoppingItemNameInput', 'Ovos');
  await page.fill('#shoppingItemQtyInput', '12');
  await page.click('#shoppingScreen button:has-text("➕")');
  await page.waitForTimeout(350);

  // Add a kg-based item with a decimal quantity.
  await page.fill('#shoppingItemNameInput', 'Carne picada');
  await page.fill('#shoppingItemQtyInput', '1.5');
  await page.selectOption('#shoppingItemUnitInput', 'kg');
  await page.click('#shoppingScreen button:has-text("➕")');
  await page.waitForTimeout(350);

  const ovosItem = await page.evaluate(() => SHOPPING.items.find(i => i.name === 'Ovos'));
  console.log('Unit-counted item keeps unit "un" and integer qty (12):', ovosItem.unit === 'un' && ovosItem.qty === 12);
  const carneItem = await page.evaluate(() => SHOPPING.items.find(i => i.name === 'Carne picada'));
  console.log('Kg-based item keeps unit "kg" with a decimal quantity (1.5):', carneItem.unit === 'kg' && Math.abs(carneItem.qty - 1.5) < 0.001);

  const listHtml = await page.evaluate(() => document.getElementById('shoppingListItems').innerHTML);
  console.log('Unit-counted item displays as "x12" (no redundant "un" text):', listHtml.includes('x12') && !listHtml.includes('12 un'));
  console.log('Kg-based item displays with the unit ("1.5 kg"):', listHtml.includes('1.5 kg'));

  // Add a price to the kg item and check the total uses the decimal qty correctly.
  await page.fill(`.shopping-store-input[data-item="${carneItem.id}"]`, 'Talho');
  await page.fill(`.shopping-price-input[data-item="${carneItem.id}"]`, '8.00');
  await page.click(`button[onclick="addShoppingPrice('${carneItem.id}')"]`);
  await page.waitForTimeout(350);

  const total = await page.evaluate(() => computeShoppingTotal(SHOPPING.items));
  console.log('Total correctly uses the decimal kg quantity (1.5 x 8.00 = 12.00):', Math.abs(total - 12.00) < 0.001);

  // --- Edit an item's unit ---
  await page.evaluate((id) => startEditShoppingItem(id), ovosItem.id);
  await page.waitForTimeout(200);
  const editUnitOptions = await page.evaluate((id) => [...document.getElementById(`shoppingEditUnit_${id}`).options].map(o => o.value), ovosItem.id);
  console.log('Edit form has a unit select too:', ['un', 'kg', 'g', 'l', 'ml'].every(u => editUnitOptions.includes(u)));
  const editUnitPreselected = await page.evaluate((id) => document.getElementById(`shoppingEditUnit_${id}`).value, ovosItem.id);
  console.log('Edit form pre-selects the item\'s current unit ("un"):', editUnitPreselected === 'un');

  await page.fill(`#shoppingEditQty_${ovosItem.id}`, '0.5');
  await page.selectOption(`#shoppingEditUnit_${ovosItem.id}`, 'kg');
  await page.click(`button[onclick="saveEditShoppingItem('${ovosItem.id}')"]`);
  await page.waitForTimeout(400);

  const ovosAfterEdit = await page.evaluate((id) => SHOPPING.items.find(i => i.id === id), ovosItem.id);
  console.log('Editing an item can change unit AND allow a decimal quantity (0.5 kg):', ovosAfterEdit.unit === 'kg' && Math.abs(ovosAfterEdit.qty - 0.5) < 0.001);

  // --- Server-side rounding sanity: "un" always rounds/clamps to an integer >= 1 even if a decimal sneaks through ---
  await page.evaluate(() => {
    socket.emit('add_shopping_item', { name: 'Teste Unidade Decimal', qty: '2.7', unit: 'un' });
  });
  await page.waitForTimeout(400);
  const roundedUnItem = await page.evaluate(() => SHOPPING.items.find(i => i.name === 'Teste Unidade Decimal'));
  console.log('Server rounds a decimal quantity for "un" items to a whole number:', roundedUnItem.unit === 'un' && Number.isInteger(roundedUnItem.qty) && roundedUnItem.qty === 3);

  // --- Sharing includes the unit ---
  await page.evaluate(() => {
    APP.chats.push({ id: 'unitsgroup', type: 'group', name: 'Units Group' });
  });
  await page.evaluate(() => shareShoppingListToChat('unitsgroup'));
  await page.waitForTimeout(400);
  const sharedHasUnit = await page.evaluate(() => {
    const msgs = APP.messages['unitsgroup'];
    const last = msgs[msgs.length - 1];
    return last.shoppingList.items.some(i => i.name === 'Carne picada' && i.unit === 'kg');
  });
  console.log('Shared list snapshot includes the unit for each item:', sharedHasUnit);

  await page.evaluate(() => { APP.currentChatId = 'unitsgroup'; renderMessages(); });
  await page.waitForTimeout(200);
  const sharedBubbleShowsUnit = await page.evaluate(() => document.getElementById('chatMessages').innerHTML.includes('1.5 kg'));
  console.log('Shared list bubble displays the unit (1.5 kg):', sharedBubbleShowsUnit);

  // --- Finalize and check PDF text includes the unit ---
  page.once('dialog', d => d.accept());
  await page.evaluate(() => finalizeShoppingList());
  await page.waitForTimeout(500);
  const pdfLines = await page.evaluate(() => window.__pdfCalls[window.__pdfCalls.length - 1].lines.join(' | '));
  console.log('PDF includes the kg quantity/unit for Carne picada:', pdfLines.includes('1.5 kg'));

  // --- History entry preserves units too ---
  const histItem = await page.evaluate(() => SHOPPING.history[0].items.find(i => i.name === 'Carne picada'));
  console.log('History entry preserves the item\'s unit (kg):', histItem.unit === 'kg' && Math.abs(histItem.qty - 1.5) < 0.001);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
