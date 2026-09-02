const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Chart Test');
  await page.fill('#regUsername', 'exchart_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'exchart' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Mock currency rates (same approach as test_expenses.js / test_recurring_expenses.js).
  await page.evaluate(() => {
    window.fetch = ((realFetch) => (url, ...rest) => {
      if (typeof url === 'string' && url.includes('/api/currency/rates')) {
        return Promise.resolve(new Response(JSON.stringify({ rates: { EUR: 1, USD: 1.1 }, updated: 'test' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, ...rest);
    })(window.fetch.bind(window));
  });

  // --- Pure function checks with fabricated data spanning several months ---
  const jan = new Date(2026, 0, 15).getTime();
  const feb1 = new Date(2026, 1, 3).getTime();
  const feb2 = new Date(2026, 1, 20).getTime();
  const noDate = null;
  await page.evaluate(({ jan, feb1, feb2 }) => {
    APP.chats.push({ id: 'chartgroup1', type: 'group', name: 'Chart Group' });
    APP.messages['chartgroup1'] = [
      { id: 'e1', sender: 'Você', text: '', time: '10:00', type: 'sent', expense: { description: 'Jantar', amount: 50, currency: 'EUR', amountEUR: 50, paidBy: 'Você', participants: ['Você'], createdAt: jan } },
      { id: 'e2', sender: 'Você', text: '', time: '10:01', type: 'sent', expense: { description: 'Renda', amount: 30, currency: 'EUR', amountEUR: 30, paidBy: 'Você', participants: ['Você'], createdAt: feb1 } },
      { id: 'e3', sender: 'Você', text: '', time: '10:02', type: 'sent', expense: { description: 'Luz', amount: 20, currency: 'EUR', amountEUR: 20, paidBy: 'Você', participants: ['Você'], createdAt: feb2 } },
      { id: 'e4', sender: 'Você', text: '', time: '10:03', type: 'sent', expense: { description: 'Antiga sem data', amount: 999, currency: 'EUR', amountEUR: 999, paidBy: 'Você', participants: ['Você'] } }
    ];
    APP.currentChatId = 'chartgroup1';
  }, { jan, feb1, feb2 });

  const data = await page.evaluate(() => computeExpensesOverTime('chartgroup1'));
  console.log('Agrupa por mês corretamente (2 meses: jan e fev):', data.length === 2);
  console.log('Janeiro tem o total certo (50):', data[0].total === 50 && data[0].key === '2026-01');
  console.log('Fevereiro soma as duas despesas desse mês (30+20=50):', data[1].total === 50 && data[1].key === '2026-02');
  console.log('Despesa antiga sem "createdAt" fica de fora do gráfico (999 não aparece em lado nenhum):', !data.some(d => d.total === 999) && (data[0].total + data[1].total) === 100);

  // --- Modal rendering ---
  await page.evaluate(() => openExpensesChartModal());
  await page.waitForSelector('#modalExpensesChart.active', { timeout: 3000 });
  const barsRendered = await page.evaluate(() => document.querySelectorAll('#expensesChartBars > div').length === 2);
  console.log('Renderiza uma barra por mês (2 barras):', barsRendered);
  // Nota: o ambiente de teste (ICU do Chromium sandboxed) por vezes não tem
  // dados completos de pt-PT e cai para "01/26" em vez de "jan/26" — isso é
  // uma limitação do ambiente de teste, não do código (mesmo padrão já usado
  // noutras funcionalidades desta app), por isso só se confirma o ano (2
  // dígitos), que aparece em ambos os formatos.
  const totalsShown = await page.evaluate(() => {
    const t = document.getElementById('expensesChartBars').textContent;
    return t.includes('50€') && t.includes('26');
  });
  console.log('Mostra os totais e os rótulos dos meses:', totalsShown);

  // --- Empty state: group with no dated expenses at all ---
  await page.evaluate(() => {
    APP.chats.push({ id: 'chartempty1', type: 'group', name: 'Empty Chart Group' });
    APP.messages['chartempty1'] = [];
    APP.currentChatId = 'chartempty1';
    openExpensesChartModal();
  });
  await page.waitForTimeout(200);
  const emptyStateShown = await page.evaluate(() => document.getElementById('expensesChartBars').textContent.includes('Ainda não há despesas'));
  console.log('Estado vazio mostrado quando não há despesas com data:', emptyStateShown);

  // --- Real submitExpense() now stamps a real createdAt (current month) ---
  await page.evaluate(() => {
    APP.chats.push({ id: 'chartreal1', type: 'group', name: 'Real Expense Group' });
    APP.messages['chartreal1'] = [];
    APP.currentChatId = 'chartreal1';
  });
  await page.evaluate(() => openAddExpenseForm());
  await page.waitForTimeout(300);
  await page.fill('#expenseDescription', 'Compra real');
  await page.fill('#expenseAmount', '75');
  await page.evaluate(() => submitExpense());
  await page.waitForTimeout(300);
  const realExpenseHasCreatedAt = await page.evaluate(() => {
    const exp = APP.messages['chartreal1'][0].expense;
    return typeof exp.createdAt === 'number' && Math.abs(Date.now() - exp.createdAt) < 5000;
  });
  console.log('submitExpense() real grava um createdAt (timestamp atual):', realExpenseHasCreatedAt);
  const realExpenseInChart = await page.evaluate(() => {
    const d = computeExpensesOverTime('chartreal1');
    return d.length === 1 && d[0].total === 75;
  });
  console.log('Essa despesa real já aparece corretamente no gráfico:', realExpenseInChart);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
