const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Expense Test A');
  await page.fill('#regUsername', 'expA_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'expa' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Mock currency rates so we don't depend on external network.
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, ...rest) => {
      if (typeof url === 'string' && url.includes('/api/currency/rates')) {
        return Promise.resolve(new Response(JSON.stringify({
          rates: { EUR: 1, USD: 1.1, BRL: 6.0 }, updated: 'test'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, ...rest);
    };
  });

  // Open a group chat to test expenses in a group (participants derived from senders).
  await page.evaluate(() => {
    APP.chats.push({ id: 'testgroup1', type: 'group', name: 'Viagem Teste' });
    APP.messages['testgroup1'] = [
      { id: 'm1', sender: 'Ana', text: 'Oi pessoal', time: '10:00', type: 'received' },
      { id: 'm2', sender: 'Bruno', text: 'E aí', time: '10:01', type: 'received' }
    ];
    APP.currentChatId = 'testgroup1';
    renderChatList();
    renderMessages();
  });

  // Test getChatParticipantNames includes the logged-in user's REAL name (not the
  // literal "Você" placeholder — that string is only ever a local self-display
  // label; storing it as a value would send a meaningless "Você" to the other
  // side of the conversation instead of an actual identifiable name) + distinct senders.
  const myName = await page.evaluate(() => APP.user.name);
  const participants = await page.evaluate(() => getChatParticipantNames('testgroup1'));
  console.log('Participants include my own real name (not "Você"), Ana, Bruno:', participants.includes(myName) && !participants.includes('Você') && participants.includes('Ana') && participants.includes('Bruno'));
  console.log('Participants count is exactly 3 (no duplicates):', participants.length === 3);

  // Open expenses modal (should show "no expenses yet").
  await page.evaluate(() => openExpensesModal());
  await page.waitForSelector('#modalExpenses.active', { timeout: 3000 });
  const emptyMsg = await page.evaluate(() => document.getElementById('expensesBalancesBox').textContent.includes('Ainda sem despesas'));
  console.log('Empty state shown when no expenses exist:', emptyMsg);

  // Open "Nova despesa" form.
  await page.evaluate(() => openAddExpenseForm());
  await page.waitForSelector('#modalAddExpense.active', { timeout: 3000 });
  await page.waitForTimeout(300); // let loadCurrencyRates() resolve

  const currencyOptions = await page.evaluate(() => [...document.getElementById('expenseCurrency').options].map(o => o.value));
  console.log('Currency select populated with mocked rates:', currencyOptions.includes('USD') && currencyOptions.includes('BRL'));

  const paidByOptions = await page.evaluate(() => [...document.getElementById('expensePaidBy').options].map(o => o.value));
  console.log('PaidBy select includes all participants (by real name):', paidByOptions.includes(myName) && paidByOptions.includes('Ana') && paidByOptions.includes('Bruno'));
  const myOptionLabel = await page.evaluate((name) => [...document.getElementById('expensePaidBy').options].find(o => o.value === name)?.textContent, myName);
  console.log('My own option is LABELED "Você" even though its value is my real name:', myOptionLabel === 'Você');

  const participantCheckboxes = await page.evaluate(() => document.querySelectorAll('.expense-participant-checkbox').length);
  console.log('Participant checkboxes rendered for all 3 people:', participantCheckboxes === 3);

  // Fill and submit expense: 110 USD paid by Ana, split among all 3 (Você, Ana, Bruno).
  await page.fill('#expenseDescription', 'Jantar no restaurante');
  await page.fill('#expenseAmount', '110');
  await page.selectOption('#expenseCurrency', 'USD');
  await page.selectOption('#expensePaidBy', 'Ana');
  await page.evaluate(() => submitExpense());
  await page.waitForTimeout(300);

  const bubbleVisible = await page.evaluate(() => {
    const msgs = APP.messages['testgroup1'];
    const last = msgs[msgs.length - 1];
    return !!last.expense && last.expense.description === 'Jantar no restaurante';
  });
  console.log('Expense message pushed into chat with correct description:', bubbleVisible);

  const amountEURCorrect = await page.evaluate(() => {
    const msgs = APP.messages['testgroup1'];
    const last = msgs[msgs.length - 1];
    // 110 USD / 1.1 rate = 100 EUR
    return Math.abs(last.expense.amountEUR - 100) < 0.01;
  });
  console.log('Currency conversion to EUR is correct (110 USD @ rate 1.1 -> 100 EUR):', amountEURCorrect);

  const renderedBubbleHtml = await page.evaluate(() => {
    const msgs = APP.messages['testgroup1'];
    return renderExpense(msgs[msgs.length - 1]);
  });
  console.log('Rendered bubble shows description, amount, payer, participant count:',
    renderedBubbleHtml.includes('Jantar no restaurante') &&
    renderedBubbleHtml.includes('110') &&
    renderedBubbleHtml.includes('USD') &&
    renderedBubbleHtml.includes('Ana') &&
    renderedBubbleHtml.includes('3 pessoas'));

  // Check the actual chat bubble in the DOM (via renderMessages) also shows it.
  const domHasExpenseBubble = await page.evaluate(() => document.getElementById('chatMessages').innerHTML.includes('Jantar no restaurante'));
  console.log('Expense bubble appears in the rendered chat DOM:', domHasExpenseBubble);

  // Reopen expenses modal — should now show a non-empty balance summary.
  await page.evaluate(() => openExpensesModal());
  await page.waitForTimeout(200);
  const balancesText = await page.evaluate(() => document.getElementById('expensesBalancesBox').textContent);
  console.log('Balances show Ana is owed money:', balancesText.includes('Ana') && balancesText.includes('deve receber'));
  console.log('Balances show Você/Bruno owe money:', (balancesText.match(/deve \d/g) || []).length >= 1);

  // Add a second expense paid by "Você" (myself) split only between myself and Bruno, to test multi-expense balance math.
  await page.evaluate(() => openAddExpenseForm());
  await page.waitForTimeout(200);
  await page.fill('#expenseDescription', 'Táxi');
  await page.fill('#expenseAmount', '20');
  await page.selectOption('#expenseCurrency', 'EUR');
  await page.selectOption('#expensePaidBy', myName);
  await page.evaluate((name) => {
    document.querySelectorAll('.expense-participant-checkbox').forEach(cb => { cb.checked = (cb.value === name || cb.value === 'Bruno'); });
  }, myName);
  await page.evaluate(() => submitExpense());
  await page.waitForTimeout(300);

  const expensesCount = await page.evaluate(() => getChatExpenses('testgroup1').length);
  console.log('Two expenses now recorded for this chat:', expensesCount === 2);

  // Verify balance math: Ana paid 100 (split 3 ways: 33.33 each) => Ana +66.67, Você -33.33, Bruno -33.33
  // Você paid 20 (split 2 ways: 10 each, Ana not included) => Você +10, Bruno -10
  // Final: Ana = 66.67 - 0 = +66.67 (owed), Você = -33.33+10 = -23.33 (owes), Bruno = -33.33-10 = -43.33 (owes)
  await page.evaluate(() => openExpensesModal());
  await page.waitForTimeout(200);
  const finalBalances = await page.evaluate(() => document.getElementById('expensesBalancesBox').textContent);
  console.log('Final balance summary (manual check):', finalBalances.replace(/\s+/g, ' ').trim());

  // XSS safety: description/paidBy with HTML should be escaped.
  await page.evaluate(() => {
    APP.chats.push({ id: 'testgroup2', type: 'group', name: 'XSS Group' });
    APP.messages['testgroup2'] = [{ id: 'mx', sender: '<img src=x onerror=alert(1)>', text: 'hi', time: '10:00', type: 'received' }];
    APP.currentChatId = 'testgroup2';
  });
  await page.evaluate(() => openAddExpenseForm());
  await page.waitForTimeout(200);
  await page.fill('#expenseDescription', '<script>alert(1)</script>');
  await page.fill('#expenseAmount', '5');
  await page.evaluate(() => submitExpense());
  await page.waitForTimeout(300);
  const xssSafe = await page.evaluate(() => {
    const html = document.getElementById('chatMessages').innerHTML;
    return !html.includes('<script>alert') && !html.includes('<img src=x onerror');
  });
  console.log('XSS: malicious description/sender names are escaped in the rendered DOM:', xssSafe);

  // Test 1-1 chat expenses (not gated to groups only).
  await page.evaluate(() => {
    APP.chats.push({ id: 'testdm1', type: 'user', name: 'Amigo Solo' });
    APP.messages['testdm1'] = [{ id: 'md1', sender: 'Amigo Solo', text: 'oi', time: '09:00', type: 'received' }];
    APP.currentChatId = 'testdm1';
    renderMessages();
  });
  await page.evaluate(() => openAddExpenseForm());
  await page.waitForTimeout(200);
  const dmModalOpened = await page.evaluate(() => document.getElementById('modalAddExpense').classList.contains('active'));
  console.log('Expense form opens fine for a 1-1 chat too (not group-gated):', dmModalOpened);
  await page.fill('#expenseDescription', 'Hotel a dois');
  await page.fill('#expenseAmount', '80');
  await page.evaluate(() => submitExpense());
  await page.waitForTimeout(300);
  const dmExpenseAdded = await page.evaluate(() => getChatExpenses('testdm1').length === 1);
  console.log('1-1 chat expense was recorded successfully:', dmExpenseAdded);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
