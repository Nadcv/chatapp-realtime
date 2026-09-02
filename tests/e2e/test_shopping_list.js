const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  // Mock jsPDF (its CDN is blocked in this sandbox) so we can verify the PDF
  // generation call happens with the right data, without needing the real library.
  await page.addInitScript(() => {
    window.__pdfCalls = [];
    function FakeJsPDF() {
      this._lines = [];
    }
    FakeJsPDF.prototype.setFontSize = function () { return this; };
    FakeJsPDF.prototype.setFont = function () { return this; };
    FakeJsPDF.prototype.text = function (line) { this._lines.push(line); return this; };
    FakeJsPDF.prototype.addPage = function () { return this; };
    FakeJsPDF.prototype.save = function (filename) {
      window.__pdfCalls.push({ filename, lines: this._lines.slice() });
    };
    window.jspdf = { jsPDF: FakeJsPDF };
  });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Shopping Test');
  await page.fill('#regUsername', 'shop_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'shop' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Open the tab via the real "Mais" menu flow.
  await page.click('button[onclick="openMoreFeaturesModal()"]');
  await page.waitForSelector('#modalMoreFeatures.active', { timeout: 3000 });
  await page.click('#modalMoreFeatures button:has-text("Compras")');
  await page.waitForSelector('#shoppingScreen.active', { timeout: 3000 });

  const emptyStateShown = await page.evaluate(() => document.getElementById('shoppingListItems').textContent.includes('vazia'));
  console.log('Empty state shown when the list has no items:', emptyStateShown);

  const totalZero = await page.evaluate(() => document.getElementById('shoppingListTotal').textContent);
  console.log('Total starts at 0,00 €:', totalZero.includes('0,00'));

  // Add first item.
  await page.fill('#shoppingItemNameInput', 'Leite');
  await page.fill('#shoppingItemQtyInput', '2');
  await page.click('#shoppingScreen button:has-text("➕")');
  await page.waitForTimeout(400);

  const itemAdded = await page.evaluate(() => SHOPPING.items.length === 1 && SHOPPING.items[0].name === 'Leite' && SHOPPING.items[0].qty === 2);
  console.log('Item "Leite x2" added to the list:', itemAdded);
  const inputCleared = await page.evaluate(() => document.getElementById('shoppingItemNameInput').value === '');
  console.log('Name input clears after adding:', inputCleared);

  // Add a second item.
  await page.fill('#shoppingItemNameInput', 'Pão');
  await page.click('#shoppingScreen button:has-text("➕")');
  await page.waitForTimeout(400);
  const twoItems = await page.evaluate(() => SHOPPING.items.length === 2);
  console.log('Second item "Pão" added (2 items total):', twoItems);

  // Add price comparisons to "Leite": two stores.
  const leiteId = await page.evaluate(() => SHOPPING.items.find(i => i.name === 'Leite').id);
  await page.fill(`.shopping-store-input[data-item="${leiteId}"]`, 'Continente');
  await page.fill(`.shopping-price-input[data-item="${leiteId}"]`, '1.20');
  await page.click(`button[onclick="addShoppingPrice('${leiteId}')"]`);
  await page.waitForTimeout(300);
  await page.fill(`.shopping-store-input[data-item="${leiteId}"]`, 'Pingo Doce');
  await page.fill(`.shopping-price-input[data-item="${leiteId}"]`, '1.15');
  await page.click(`button[onclick="addShoppingPrice('${leiteId}')"]`);
  await page.waitForTimeout(300);

  const twoPrices = await page.evaluate((id) => SHOPPING.items.find(i => i.id === id).prices.length === 2, leiteId);
  console.log('Two price entries recorded for Leite (price comparison):', twoPrices);

  const cheapestHighlighted = await page.evaluate(() => document.getElementById('shoppingListItems').innerHTML.includes('✅ Pingo Doce: 1.15'));
  console.log('The cheapest price (Pingo Doce 1.15€) is highlighted with ✅:', cheapestHighlighted);
  const expensiveNotHighlighted = await page.evaluate(() => !document.getElementById('shoppingListItems').innerHTML.includes('✅ Continente'));
  console.log('The more expensive price (Continente) is NOT marked as cheapest:', expensiveNotHighlighted);

  // Total should reflect cheapest price × qty for Leite (2 × 1.15 = 2.30), Pão has no price yet (0).
  const totalAfterPrices = await page.evaluate(() => document.getElementById('shoppingListTotal').textContent);
  console.log('Total reflects cheapest price × quantity (2.30 € for Leite, Pão still 0):', totalAfterPrices.includes('2,30'));

  // Remove the more expensive price entry.
  const continentePriceId = await page.evaluate((id) => SHOPPING.items.find(i => i.id === id).prices.find(p => p.store === 'Continente').id, leiteId);
  await page.evaluate(({ leiteId, continentePriceId }) => deleteShoppingPrice(leiteId, continentePriceId), { leiteId, continentePriceId });
  await page.waitForTimeout(300);
  const onePriceLeft = await page.evaluate((id) => SHOPPING.items.find(i => i.id === id).prices.length === 1, leiteId);
  console.log('Deleting a price entry works:', onePriceLeft);

  // Mark "Pão" as bought.
  const paoId = await page.evaluate(() => SHOPPING.items.find(i => i.name === 'Pão').id);
  await page.evaluate((id) => toggleShoppingItem(id), paoId);
  await page.waitForTimeout(300);
  const paoBought = await page.evaluate((id) => SHOPPING.items.find(i => i.id === id).bought === true, paoId);
  console.log('Marking an item as bought works:', paoBought);
  const strikethroughShown = await page.evaluate(() => document.getElementById('shoppingListItems').innerHTML.includes('line-through'));
  console.log('Bought item shows a strikethrough style:', strikethroughShown);

  // Add a price to Pão too, so we have a full list to finalize.
  await page.fill(`.shopping-store-input[data-item="${paoId}"]`, 'Padaria');
  await page.fill(`.shopping-price-input[data-item="${paoId}"]`, '0.90');
  await page.click(`button[onclick="addShoppingPrice('${paoId}')"]`);
  await page.waitForTimeout(300);

  const totalBeforeFinalize = await page.evaluate(() => computeShoppingTotal(SHOPPING.items));
  console.log('Total before finalizing (1.15*2 + 0.90*1 = 3.20):', Math.abs(totalBeforeFinalize - 3.20) < 0.001);

  // Delete an item entirely.
  await page.fill('#shoppingItemNameInput', 'Item para apagar');
  await page.click('#shoppingScreen button:has-text("➕")');
  await page.waitForTimeout(300);
  const toDeleteId = await page.evaluate(() => SHOPPING.items.find(i => i.name === 'Item para apagar').id);
  await page.evaluate((id) => deleteShoppingItem(id), toDeleteId);
  await page.waitForTimeout(300);
  const itemDeleted = await page.evaluate(() => !SHOPPING.items.some(i => i.name === 'Item para apagar'));
  console.log('Deleting an item entirely works:', itemDeleted);

  // XSS safety check.
  await page.fill('#shoppingItemNameInput', '<img src=x onerror=alert(1)>');
  await page.click('#shoppingScreen button:has-text("➕")');
  await page.waitForTimeout(300);
  const xssSafe = await page.evaluate(() => !document.getElementById('shoppingListItems').innerHTML.includes('<img src=x onerror'));
  console.log('XSS-safe: malicious item name is escaped in the rendered list:', xssSafe);
  const xssItemId = await page.evaluate(() => SHOPPING.items.find(i => i.name.includes('img'))?.id);
  if (xssItemId) await page.evaluate((id) => deleteShoppingItem(id), xssItemId);
  await page.waitForTimeout(200);

  // --- Finalize the list, PDF generation, and history ---
  page.once('dialog', d => d.accept());
  await page.evaluate(() => finalizeShoppingList());
  await page.waitForTimeout(500);

  const pdfWasGenerated = await page.evaluate(() => window.__pdfCalls.length === 1);
  console.log('Finalizing triggers exactly one PDF generation call:', pdfWasGenerated);
  const pdfHasLeiteAndPao = await page.evaluate(() => {
    const lines = window.__pdfCalls[0].lines.join(' | ');
    return lines.includes('Leite') && lines.includes('Pão') && lines.includes('Pingo Doce') && lines.includes('Padaria');
  });
  console.log('PDF content includes both items with their cheapest store/price:', pdfHasLeiteAndPao);
  const pdfHasTotal = await page.evaluate(() => window.__pdfCalls[0].lines.some(l => l.includes('Total:') && l.includes('3.20')));
  console.log('PDF content includes the correct total (3.20 €):', pdfHasTotal);

  const listClearedAfterFinalize = await page.evaluate(() => SHOPPING.items.length === 0);
  console.log('Active list is cleared after finalizing:', listClearedAfterFinalize);
  const historyHasOneEntry = await page.evaluate(() => SHOPPING.history.length === 1);
  console.log('History now has exactly 1 finalized entry:', historyHasOneEntry);
  const historyTotalCorrect = await page.evaluate(() => Math.abs(SHOPPING.history[0].total - 3.20) < 0.001);
  console.log('History entry stores the correct total:', historyTotalCorrect);

  // Open history modal, confirm rendering, and regenerate PDF from history.
  await page.evaluate(() => openShoppingHistoryModal());
  await page.waitForSelector('#modalShoppingHistory.active', { timeout: 3000 });
  const historyListShowsEntry = await page.evaluate(() => document.getElementById('shoppingHistoryList').textContent.includes('3,20'));
  console.log('History modal shows the finalized list with its total:', historyListShowsEntry);

  await page.click('#shoppingHistoryList button:has-text("PDF")');
  await page.waitForTimeout(300);
  const secondPdfGenerated = await page.evaluate(() => window.__pdfCalls.length === 2);
  console.log('Regenerating a PDF from history works (2nd PDF call triggered):', secondPdfGenerated);

  // Reload the page — the shopping list (empty active + history) should persist server-side.
  await page.reload();
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const persistedHistory = await page.evaluate(() => SHOPPING.history.length === 1 && Math.abs(SHOPPING.history[0].total - 3.20) < 0.001);
  console.log('Shopping list history persists across a page reload (server-synced):', persistedHistory);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
