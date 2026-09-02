const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  // Mock jsPDF (blocked CDN in this sandbox).
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
  await page.fill('#regName', 'Price Edit Test');
  await page.fill('#regUsername', 'priceedit_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'priceedit' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => openShoppingScreen());
  await page.waitForSelector('#shoppingScreen.active', { timeout: 3000 });

  // Add an item with a price.
  await page.fill('#shoppingItemNameInput', 'Azeite');
  await page.click('#shoppingScreen button:has-text("➕")');
  await page.waitForTimeout(350);
  const itemId = await page.evaluate(() => SHOPPING.items.find(i => i.name === 'Azeite').id);
  await page.fill(`.shopping-store-input[data-item="${itemId}"]`, 'Continente');
  await page.fill(`.shopping-price-input[data-item="${itemId}"]`, '5.00');
  await page.click(`button[onclick="addShoppingPrice('${itemId}')"]`);
  await page.waitForTimeout(350);

  const priceId = await page.evaluate((id) => SHOPPING.items.find(i => i.id === id).prices[0].id, itemId);

  // --- Edit price in the ACTIVE list ---
  await page.evaluate(({ itemId, priceId }) => startEditShoppingPrice(itemId, priceId), { itemId, priceId });
  await page.waitForTimeout(200);
  const editFormShown = await page.evaluate((pid) => !!document.getElementById(`shoppingEditPriceStore_${pid}`), priceId);
  console.log('Edit form for the price appears:', editFormShown);

  await page.fill(`#shoppingEditPriceStore_${priceId}`, 'Pingo Doce');
  await page.fill(`#shoppingEditPriceValue_${priceId}`, '4.50');
  await page.click(`span[onclick="saveEditShoppingPrice('${itemId}','${priceId}')"]`);
  await page.waitForTimeout(400);

  const priceUpdated = await page.evaluate(({ itemId, priceId }) => {
    const p = SHOPPING.items.find(i => i.id === itemId).prices.find(p => p.id === priceId);
    return p.store === 'Pingo Doce' && Math.abs(p.price - 4.50) < 0.001;
  }, { itemId, priceId });
  console.log('Price store and value are updated correctly:', priceUpdated);
  const priceIdUnchanged = await page.evaluate(({ itemId, priceId }) => SHOPPING.items.find(i => i.id === itemId).prices.some(p => p.id === priceId), { itemId, priceId });
  console.log('Price entry ID stays the same (not recreated):', priceIdUnchanged);
  const editModeClosedAfterSave = await page.evaluate(() => EDITING_SHOPPING_PRICE === null);
  console.log('Edit mode for price closes after saving:', editModeClosedAfterSave);

  // Cancel edit test — typed changes should not be saved.
  await page.evaluate(({ itemId, priceId }) => startEditShoppingPrice(itemId, priceId), { itemId, priceId });
  await page.waitForTimeout(200);
  await page.fill(`#shoppingEditPriceStore_${priceId}`, 'NAO DEVE FICAR');
  await page.evaluate(() => cancelEditShoppingPrice());
  await page.waitForTimeout(200);
  const cancelWorks = await page.evaluate(({ itemId, priceId }) => SHOPPING.items.find(i => i.id === itemId).prices.find(p => p.id === priceId).store === 'Pingo Doce', { itemId, priceId });
  console.log('Cancelling price edit does not save typed changes:', cancelWorks);

  // XSS safety on price edit.
  await page.evaluate(({ itemId, priceId }) => startEditShoppingPrice(itemId, priceId), { itemId, priceId });
  await page.waitForTimeout(200);
  await page.fill(`#shoppingEditPriceStore_${priceId}`, '<img src=x onerror=alert(1)>');
  await page.click(`span[onclick="saveEditShoppingPrice('${itemId}','${priceId}')"]`);
  await page.waitForTimeout(400);
  const priceXssSafe = await page.evaluate(() => !document.getElementById('shoppingListItems').innerHTML.includes('<img src=x onerror'));
  console.log('XSS-safe: malicious edited store name is escaped in the active list:', priceXssSafe);

  // Reset store name back to something normal for the finalize step below.
  await page.evaluate(({ itemId, priceId }) => startEditShoppingPrice(itemId, priceId), { itemId, priceId });
  await page.waitForTimeout(200);
  await page.fill(`#shoppingEditPriceStore_${priceId}`, 'Pingo Doce');
  await page.fill(`#shoppingEditPriceValue_${priceId}`, '4.50');
  await page.click(`span[onclick="saveEditShoppingPrice('${itemId}','${priceId}')"]`);
  await page.waitForTimeout(400);

  // --- Finalize the list into history ---
  page.once('dialog', d => d.accept());
  await page.evaluate(() => finalizeShoppingList());
  await page.waitForTimeout(500);

  const historyId = await page.evaluate(() => SHOPPING.history[0].id);
  const histTotalBefore = await page.evaluate(() => SHOPPING.history[0].total);
  console.log('History entry created with correct initial total (4.50):', Math.abs(histTotalBefore - 4.50) < 0.001);

  // --- Expand the history entry and edit a price there ---
  await page.evaluate(() => openShoppingHistoryModal());
  await page.waitForSelector('#modalShoppingHistory.active', { timeout: 3000 });
  await page.evaluate((id) => toggleShoppingHistoryExpand(id), historyId);
  await page.waitForTimeout(200);

  const historyExpandedShowsItem = await page.evaluate(() => document.getElementById('shoppingHistoryList').textContent.includes('Azeite'));
  console.log('Expanding a history entry shows its items:', historyExpandedShowsItem);
  const historyShowsPrice = await page.evaluate(() => document.getElementById('shoppingHistoryList').textContent.includes('Pingo Doce'));
  console.log('Expanded history entry shows the recorded price/store:', historyShowsPrice);

  const histItemId = await page.evaluate(() => SHOPPING.history[0].items[0].id);
  const histPriceId = await page.evaluate(() => SHOPPING.history[0].items[0].prices[0].id);

  await page.evaluate(({ historyId, histItemId, histPriceId }) => startEditShoppingHistoryPrice(historyId, histItemId, histPriceId), { historyId, histItemId, histPriceId });
  await page.waitForTimeout(200);
  const histEditFormShown = await page.evaluate((pid) => !!document.getElementById(`shoppingHistEditStore_${pid}`), histPriceId);
  console.log('History price edit form appears:', histEditFormShown);

  await page.fill(`#shoppingHistEditStore_${histPriceId}`, 'Recibo real');
  await page.fill(`#shoppingHistEditValue_${histPriceId}`, '3.99');
  await page.click(`span[onclick="saveEditShoppingHistoryPrice('${historyId}','${histItemId}','${histPriceId}')"]`);
  await page.waitForTimeout(500);

  const histPriceUpdated = await page.evaluate(() => {
    const p = SHOPPING.history[0].items[0].prices[0];
    return p.store === 'Recibo real' && Math.abs(p.price - 3.99) < 0.001;
  });
  console.log('History entry price/store updated correctly:', histPriceUpdated);

  const histTotalRecalculated = await page.evaluate(() => Math.abs(SHOPPING.history[0].total - 3.99) < 0.001);
  console.log('History entry TOTAL is recalculated after editing its price (was 4.50, now 3.99):', histTotalRecalculated);

  // Active list (already emptied by finalize) must be unaffected by the history edit.
  const activeListStillEmpty = await page.evaluate(() => SHOPPING.items.length === 0);
  console.log('Editing a history price does not affect the active (already-cleared) list:', activeListStillEmpty);

  // Regenerate PDF from the history entry — should use the CORRECTED price.
  await page.click(`#shoppingHistoryList button:has-text("PDF")`);
  await page.waitForTimeout(300);
  const pdfHasCorrectedPrice = await page.evaluate(() => {
    const last = window.__pdfCalls[window.__pdfCalls.length - 1];
    const lines = last.lines.join(' | ');
    return lines.includes('Recibo real') && lines.includes('3.99');
  });
  console.log('Regenerated PDF from history reflects the corrected price:', pdfHasCorrectedPrice);
  const pdfHasCorrectedTotal = await page.evaluate(() => {
    const last = window.__pdfCalls[window.__pdfCalls.length - 1];
    return last.lines.some(l => l.includes('Total:') && l.includes('3.99'));
  });
  console.log('Regenerated PDF shows the corrected total:', pdfHasCorrectedTotal);

  // XSS safety in history price edit.
  await page.evaluate(({ historyId, histItemId, histPriceId }) => startEditShoppingHistoryPrice(historyId, histItemId, histPriceId), { historyId, histItemId, histPriceId });
  await page.waitForTimeout(200);
  await page.fill(`#shoppingHistEditStore_${histPriceId}`, '<img src=x onerror=alert(2)>');
  await page.click(`span[onclick="saveEditShoppingHistoryPrice('${historyId}','${histItemId}','${histPriceId}')"]`);
  await page.waitForTimeout(400);
  const histXssSafe = await page.evaluate(() => !document.getElementById('shoppingHistoryList').innerHTML.includes('<img src=x onerror'));
  console.log('XSS-safe: malicious edited history store name is escaped:', histXssSafe);

  // Reload — persistence check for the corrected history data.
  await page.reload();
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const persistedAfterReload = await page.evaluate(() => Math.abs(SHOPPING.history[0].total - parseFloat(SHOPPING.history[0].items[0].prices[0].price)) < 0.001);
  console.log('Corrected history data (price/total) persists across reload:', persistedAfterReload);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
