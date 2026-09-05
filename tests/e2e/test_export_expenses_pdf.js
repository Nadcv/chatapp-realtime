const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  // Mock jsPDF (o CDN está bloqueado nesta sandbox) — mesma abordagem já usada
  // no teste do PDF da conversa e da lista de compras.
  await page.addInitScript(() => {
    window.__pdfCalls = [];
    function FakeJsPDF() {
      this._lines = [];
      this._pages = 1;
      this.internal = { pageSize: { getWidth: () => 210 } };
    }
    FakeJsPDF.prototype.setFontSize = function () { return this; };
    FakeJsPDF.prototype.setFont = function () { return this; };
    FakeJsPDF.prototype.setTextColor = function () { return this; };
    FakeJsPDF.prototype.text = function (line) { this._lines.push(line); return this; };
    FakeJsPDF.prototype.splitTextToSize = function (text) { return [text]; };
    FakeJsPDF.prototype.addPage = function () { this._pages++; return this; };
    FakeJsPDF.prototype.save = function (filename) {
      window.__pdfCalls.push({ filename, lines: this._lines.slice(), pages: this._pages });
    };
    window.jspdf = { jsPDF: FakeJsPDF };
  });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Export Expenses Test');
  await page.fill('#regUsername', 'exportexp_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'exportexp' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Duas despesas: uma paga pelo próprio utilizador ("Você"), outra por Maria —
  // testa também a conversão de "Você" para o nome real de quem paga (Maria).
  await page.evaluate(() => {
    APP.chats.push({ id: 'exportexpchat', type: 'user', name: 'Maria Expenses', phone: '+351933333333' });
    APP.messages['exportexpchat'] = [
      { id: 'm1', sender: 'Você', text: '', type: 'sent', expense: { description: 'Jantar', amount: 40, amountEUR: 40, currency: 'EUR', paidBy: 'Você', participants: ['Você', 'Maria Expenses'] } },
      { id: 'm2', sender: 'Maria Expenses', text: '', type: 'received', expense: { description: 'Táxi', amount: 20, amountEUR: 20, currency: 'EUR', paidBy: 'Maria Expenses', participants: ['Você', 'Maria Expenses'] } },
    ];
    APP.currentChatId = 'exportexpchat';
    renderChatList();
  });

  await page.evaluate(() => exportExpensesToPdf());
  await page.waitForTimeout(300);

  const pdfCall = await page.evaluate(() => window.__pdfCalls[0]);
  console.log('Gera o PDF com o nome do ficheiro certo:', pdfCall?.filename === 'despesas_Maria_Expenses.pdf');
  const allLines = pdfCall?.lines.join('\n') || '';
  console.log('Inclui o título com o nome da conversa:', allLines.includes('Despesas: Maria Expenses'));
  console.log('Inclui a data de exportação:', /Exportado em/.test(allLines));
  console.log('Inclui as duas despesas com descrição e valor:', allLines.includes('Jantar — 40 EUR') && allLines.includes('Táxi — 20 EUR'));
  console.log('Mostra quem pagou cada despesa:', allLines.includes('Pago por Você') && allLines.includes('Pago por Maria Expenses'));
  console.log('Mostra a secção de saldos:', allLines.includes('Saldos'));
  // Duas despesas de 40€ e 20€, cada uma dividida a meio: Você pagou 40, deve 30 (metade das duas) => a receber 10. Maria pagou 20, deve 30 => deve 10.
  console.log('Saldo calculado corretamente (Você a receber, Maria a dever):', allLines.includes('Você: deve receber 10.00€') && allLines.includes('Maria Expenses: deve 10.00€'));
  console.log('Inclui a secção "Como acertar contas" com a transferência simplificada:', allLines.includes('Como acertar contas') && allLines.includes('Maria Expenses → Você: 10.00€'));

  // --- Conversa sem despesas exporta sem crash, com aviso claro ---
  await page.evaluate(() => {
    APP.chats.push({ id: 'emptyexpchat', type: 'user', name: 'Vazio Expenses', phone: '+351933333334' });
    APP.messages['emptyexpchat'] = [];
    APP.currentChatId = 'emptyexpchat';
  });
  await page.evaluate(() => exportExpensesToPdf());
  await page.waitForTimeout(300);
  const emptyCall = await page.evaluate(() => window.__pdfCalls[1]);
  const emptyLines = emptyCall?.lines.join('\n') || '';
  console.log('Conversa sem despesas exporta sem crash, com aviso claro:', emptyLines.includes('Ainda sem despesas registadas') && emptyLines.includes('Nenhuma despesa nesta conversa'));

  // --- O botão "📄 PDF" está visível no modal de Despesas ---
  await page.evaluate(() => { APP.currentChatId = 'exportexpchat'; openChat('exportexpchat'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => openExpensesModal());
  await page.waitForSelector('#modalExpenses.active');
  const btnVisible = await page.locator('#modalExpenses button:has-text("📄 PDF")').isVisible();
  console.log('O botão "📄 PDF" está visível no modal de Despesas:', btnVisible);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
