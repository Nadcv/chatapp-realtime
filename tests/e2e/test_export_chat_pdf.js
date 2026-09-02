const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  // Mock jsPDF (its CDN is blocked in this sandbox) so we can verify the PDF
  // generation call happens with the right data, without needing the real library —
  // same approach already used for the shopping-list PDF test.
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
    FakeJsPDF.prototype.splitTextToSize = function (text) { return [text]; }; // sem wrapping real — só testa a lógica de conteúdo/paginação
    FakeJsPDF.prototype.addPage = function () { this._pages++; return this; };
    FakeJsPDF.prototype.save = function (filename) {
      window.__pdfCalls.push({ filename, lines: this._lines.slice(), pages: this._pages });
    };
    window.jspdf = { jsPDF: FakeJsPDF };
  });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Export PDF Test');
  await page.fill('#regUsername', 'exportpdf_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'exportpdf' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.chats.push({ id: 'exportpdfchat', type: 'user', name: 'Maria Export', phone: '+351933333333' });
    APP.messages['exportpdfchat'] = [
      { id: 'm1', sender: 'Maria Export', text: 'Olá, tudo bem?', time: '09:00', type: 'received' },
      { id: 'm2', sender: 'Você', text: 'Tudo ótimo, obrigado!', time: '09:01', type: 'sent' },
      { id: 'm3', sender: 'Maria Export', text: 'Mensagem apagada teste', time: '09:02', type: 'received', deleted: true },
      { id: 'm4', sender: 'Você', text: '', time: '09:03', type: 'sent', fileData: 'data:image/png;base64,abc', fileName: 'foto.png', fileType: 'image/png' },
    ];
    APP.currentChatId = 'exportpdfchat';
    renderChatList();
  });

  await page.evaluate(() => exportChatToPdf());
  await page.waitForTimeout(300);

  const pdfCall = await page.evaluate(() => window.__pdfCalls[0]);
  console.log('Gera o PDF com o nome do ficheiro certo:', pdfCall?.filename === 'conversa_Maria_Export.pdf');
  const allLines = pdfCall?.lines.join('\n') || '';
  console.log('Inclui o título com o nome da conversa:', allLines.includes('Conversa: Maria Export'));
  console.log('Inclui a mensagem recebida:', allLines.includes('Olá, tudo bem?') && allLines.includes('Maria Export:'));
  console.log('Inclui a mensagem enviada com "Você":', allLines.includes('Você: Tudo ótimo, obrigado!'));
  console.log('Mensagem apagada aparece como placeholder, não o texto original:', allLines.includes('(mensagem apagada)') && !allLines.includes('Mensagem apagada teste'));
  console.log('Anexo aparece como placeholder com o nome do ficheiro:', allLines.includes('(anexo: foto.png)'));
  console.log('Inclui a data/hora de exportação:', /Exportado em/.test(allLines));

  // --- Empty chat exports cleanly without crashing ---
  await page.evaluate(() => {
    APP.chats.push({ id: 'emptypdfchat', type: 'user', name: 'Vazio Export', phone: '+351933333334' });
    APP.messages['emptypdfchat'] = [];
    APP.currentChatId = 'emptypdfchat';
  });
  await page.evaluate(() => exportChatToPdf());
  await page.waitForTimeout(300);
  const emptyCall = await page.evaluate(() => window.__pdfCalls[1]);
  console.log('Conversa vazia exporta sem crash, com aviso claro:', emptyCall?.lines.join('\n').includes('Sem mensagens nesta conversa'));

  // --- Long chat triggers pagination (addPage called) ---
  await page.evaluate(() => {
    APP.chats.push({ id: 'longpdfchat', type: 'user', name: 'Longo Export', phone: '+351933333335' });
    APP.messages['longpdfchat'] = Array.from({ length: 60 }, (_, i) => ({
      id: 'lm' + i, sender: i % 2 === 0 ? 'Alguém' : 'Você', text: 'Mensagem número ' + i, time: '10:00', type: i % 2 === 0 ? 'received' : 'sent'
    }));
    APP.currentChatId = 'longpdfchat';
  });
  await page.evaluate(() => exportChatToPdf());
  await page.waitForTimeout(300);
  const longCall = await page.evaluate(() => window.__pdfCalls[2]);
  console.log('Uma conversa longa (60 mensagens) gera mais do que uma página:', longCall?.pages > 1);
  console.log('Todas as 60 mensagens aparecem no PDF:', longCall?.lines.filter(l => l.includes('Mensagem número')).length === 60);

  // --- Button is present in the chat-more menu ---
  await page.evaluate(() => { APP.currentChatId = 'exportpdfchat'; openChat('exportpdfchat'); });
  await page.waitForTimeout(200);
  await page.click('button[onclick="openChatMoreModal()"]');
  await page.waitForSelector('#modalChatMore.active');
  const btnVisible = await page.locator('button:has-text("Exportar PDF")').isVisible();
  console.log('O botão "Exportar PDF" está visível no menu "Mais desta conversa":', btnVisible);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
