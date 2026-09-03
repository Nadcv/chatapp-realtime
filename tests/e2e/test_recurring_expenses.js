const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Recurring Test');
  await page.fill('#regUsername', 'recurring_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'recurring' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Mock currency rates so we don't depend on external network (same approach as test_expenses.js).
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

  // Fake group chat with two other senders, and actually join its socket.io room
  // (via join_room) so the server's broadcast responses reach this socket too.
  await page.evaluate(() => {
    APP.chats.push({ id: 'recgroup1', type: 'group', name: 'Casa Teste' });
    APP.messages['recgroup1'] = [
      { id: 'm1', sender: 'Ana', text: 'Oi pessoal', time: '10:00', type: 'received' },
      { id: 'm2', sender: 'Bruno', text: 'E aí', time: '10:01', type: 'received' }
    ];
    APP.currentChatId = 'recgroup1';
    socket.emit('join_room', { chatId: 'recgroup1' });
    renderChatList();
    renderMessages();
  });
  await page.waitForTimeout(300);

  // --- Estado vazio ---
  await page.evaluate(() => openRecurringExpensesModal());
  await page.waitForSelector('#modalRecurringExpenses.active', { timeout: 3000 });
  const emptyShown = await page.evaluate(() => document.getElementById('recurringExpensesList').textContent.includes('Ainda não há'));
  console.log('Estado vazio mostrado quando não há despesas fixas:', emptyShown);

  // --- Validação: sem descrição / sem valor ---
  await page.evaluate(() => openAddRecurringExpenseForm());
  await page.waitForSelector('#modalAddRecurringExpense.active', { timeout: 3000 });
  await page.waitForTimeout(300); // let loadCurrencyRates() resolve
  page.once('dialog', d => { console.log('Validação (sem descrição):', d.message().includes('descrição')); d.accept(); });
  await page.evaluate(() => submitRecurringExpense());
  await page.waitForTimeout(200);

  await page.fill('#recurringExpenseDescription', 'Renda');
  page.once('dialog', d => { console.log('Validação (sem valor):', d.message().includes('valor válido')); d.accept(); });
  await page.evaluate(() => submitRecurringExpense());
  await page.waitForTimeout(200);

  const currencyOptions = await page.evaluate(() => [...document.getElementById('recurringExpenseCurrency').options].map(o => o.value));
  console.log('Select de moeda populado com as taxas mocked:', currencyOptions.includes('USD') && currencyOptions.includes('BRL'));
  const dayOptions = await page.evaluate(() => [...document.getElementById('recurringExpenseDayOfMonth').options].map(o => o.value));
  console.log('Select de dia do mês tem 31 opções (1 a 31):', dayOptions.length === 31 && dayOptions[0] === '1' && dayOptions[30] === '31');
  const myName = await page.evaluate(() => APP.user.name);
  const paidByOptions = await page.evaluate(() => [...document.getElementById('recurringExpensePaidBy').options].map(o => o.value));
  // O valor guardado é sempre o nome real (nunca o literal "Você") — isto viaja
  // dentro do objeto da despesa fixa para a outra pessoa, tal como nas despesas
  // avulsas (ver getChatParticipantNames em index.html).
  console.log('Select "quem paga" inclui todos os participantes (pelo nome real):', paidByOptions.includes(myName) && !paidByOptions.includes('Você') && paidByOptions.includes('Ana') && paidByOptions.includes('Bruno'));

  // --- Criação real ---
  await page.fill('#recurringExpenseDescription', 'Renda');
  await page.fill('#recurringExpenseAmount', '750');
  await page.selectOption('#recurringExpenseCurrency', 'EUR');
  await page.selectOption('#recurringExpenseDayOfMonth', '1');
  await page.evaluate(() => submitRecurringExpense());
  await page.waitForTimeout(600);

  const created = await page.evaluate(() => (RECURRING_EXPENSES['recgroup1'] || []).some(r => r.description === 'Renda' && r.amount === 750 && r.dayOfMonth === 1));
  console.log('Despesa fixa criada e sincronizada de volta do servidor:', created);

  const listShowsIt = await page.evaluate(() => document.getElementById('recurringExpensesList').textContent.includes('Renda'));
  console.log('Lista mostra a nova despesa fixa:', listShowsIt);
  const showsDayOfMonth = await page.evaluate(() => document.getElementById('recurringExpensesList').textContent.includes('Todo dia 1'));
  console.log('Lista mostra o dia do mês configurado:', showsDayOfMonth);

  // --- Não interfere com a despesa avulsa existente (não cria mensagem real) ---
  const oneOffListUnaffected = await page.evaluate(() => getChatExpenses('recgroup1').length === 0);
  console.log('Criar uma despesa fixa NÃO cria uma despesa avulsa (mensagem real):', oneOffListUnaffected);

  // --- XSS safety ---
  await page.evaluate(() => openAddRecurringExpenseForm());
  await page.waitForTimeout(300);
  await page.fill('#recurringExpenseDescription', '<img src=x onerror=alert(1)>');
  await page.fill('#recurringExpenseAmount', '10');
  await page.evaluate(() => submitRecurringExpense());
  await page.waitForTimeout(600);
  const xssSafe = await page.evaluate(() => !document.getElementById('recurringExpensesList').innerHTML.includes('<img src=x onerror'));
  console.log('XSS-safe: descrição maliciosa é escapada:', xssSafe);

  // --- Apagar ---
  const rentId = await page.evaluate(() => RECURRING_EXPENSES['recgroup1'].find(r => r.description === 'Renda').id);
  await page.evaluate((id) => deleteRecurringExpense(id), rentId);
  await page.waitForTimeout(600);
  const deleted = await page.evaluate(() => !RECURRING_EXPENSES['recgroup1'].some(r => r.description === 'Renda'));
  console.log('Apagar uma despesa fixa funciona:', deleted);

  // --- Reload: a despesa fixa restante (a do XSS) persiste no servidor e volta ao entrar na sala ---
  await page.reload();
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.evaluate(() => {
    APP.chats.push({ id: 'recgroup1', type: 'group', name: 'Casa Teste' });
    APP.currentChatId = 'recgroup1';
    socket.emit('join_room', { chatId: 'recgroup1' });
  });
  await page.waitForTimeout(800);
  const persistedAfterReload = await page.evaluate(() => (RECURRING_EXPENSES['recgroup1'] || []).length === 1);
  console.log('Despesas fixas persistem no servidor e chegam ao entrar na sala após reload:', persistedAfterReload);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
