const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Receipt OCR Test');
  await page.fill('#regUsername', 'receiptocr_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'receiptocr' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Mock currency rates (avoid depending on the real API) and set up a group chat.
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, ...rest) => {
      if (typeof url === 'string' && url.includes('/api/currency/rates')) {
        return Promise.resolve(new Response(JSON.stringify({ rates: { EUR: 1 }, updated: 'test' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, ...rest);
    };
    APP.chats.push({ id: 'receiptgroup', type: 'group', name: 'Receipt Group' });
    APP.messages['receiptgroup'] = [];
    APP.currentChatId = 'receiptgroup';
  });

  await page.evaluate(() => openAddExpenseForm());
  await page.waitForSelector('#modalAddExpense.active', { timeout: 3000 });
  await page.waitForTimeout(300);

  const buttonVisible = await page.evaluate(() => !!document.querySelector('button[onclick*="expenseReceiptInput"]'));
  console.log('The "Ler valor de um recibo" button is present in the form:', buttonVisible);

  // --- Scenario 1: Tesseract already "loaded" (mocked), OCR finds a clear total ---
  await page.evaluate(() => {
    window.Tesseract = {
      recognize: async () => ({ data: { text: 'RESTAURANTE\nPrato 12,00\nBebida 2,50\nTOTAL A PAGAR 14,50' } })
    };
  });
  const receiptPath = path.join(__dirname, 'dummy_receipt.png');
  await page.setInputFiles('#expenseReceiptInput', receiptPath);
  await page.waitForFunction(() => document.getElementById('expenseReceiptStatus').textContent.includes('Valor detetado'), { timeout: 5000 });

  const amountFieldAfterOcr = await page.evaluate(() => document.getElementById('expenseAmount').value);
  console.log('Amount field is pre-filled with the OCR-detected total (14.50):', amountFieldAfterOcr === '14.50');
  const statusShowsSuccess = await page.evaluate(() => document.getElementById('expenseReceiptStatus').textContent);
  console.log('Status message confirms the detected value and asks to double check:', statusShowsSuccess.includes('14.50') && statusShowsSuccess.includes('confirma'));

  // The field must remain editable — user can override the OCR guess.
  await page.fill('#expenseAmount', '99.99');
  const overriddenValue = await page.evaluate(() => document.getElementById('expenseAmount').value);
  console.log('The pre-filled amount can still be manually overridden:', overriddenValue === '99.99');

  // --- Scenario 2: OCR text has no recognizable amount ---
  await page.evaluate(() => {
    window.Tesseract = { recognize: async () => ({ data: { text: 'texto ilegível sem números úteis' } }) };
  });
  await page.setInputFiles('#expenseReceiptInput', receiptPath);
  await page.waitForFunction(() => document.getElementById('expenseReceiptStatus').textContent.includes('Não consegui'), { timeout: 5000 });
  console.log('When no amount is found, a clear "couldn\'t detect" message is shown:', true);

  // --- Scenario 3: Tesseract itself fails/throws (simulating an OCR engine error) ---
  await page.evaluate(() => {
    window.Tesseract = { recognize: async () => { throw new Error('boom'); } };
  });
  await page.setInputFiles('#expenseReceiptInput', receiptPath);
  await page.waitForFunction(() => document.getElementById('expenseReceiptStatus').textContent.includes('Não foi possível ler'), { timeout: 5000 });
  console.log('When OCR itself throws, a graceful error message is shown (no crash):', true);

  // --- Full flow: submit the expense after OCR pre-fill and confirm it's recorded correctly ---
  await page.evaluate(() => {
    window.Tesseract = { recognize: async () => ({ data: { text: 'Total 20,00' } }) };
  });
  await page.setInputFiles('#expenseReceiptInput', receiptPath);
  await page.waitForFunction(() => document.getElementById('expenseReceiptStatus').textContent.includes('Valor detetado'), { timeout: 5000 });
  await page.fill('#expenseDescription', 'Jantar com recibo lido');
  await page.evaluate(() => submitExpense());
  await page.waitForTimeout(400);
  const finalExpense = await page.evaluate(() => {
    const msgs = APP.messages['receiptgroup'];
    return msgs[msgs.length - 1].expense;
  });
  console.log('Full flow: expense submitted with the OCR-derived amount is recorded correctly:', finalExpense && finalExpense.amount === 20 && finalExpense.description === 'Jantar com recibo lido');

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
