const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  // Stub pdf.js BEFORE any app script runs, so extractAttachmentText() never touches
  // the real CDN (this sandbox's outbound proxy blocks external CDNs anyway — same
  // reasoning already used for jsPDF in the shopping-list test). The stub mimics only
  // the tiny slice of the real pdf.js API that ensurePdfJsLoaded()/extractAttachmentText()
  // actually calls: getDocument({data}).promise -> {numPages, getPage(n) -> {getTextContent()}}.
  await page.addInitScript(() => {
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 2,
          getPage: async (n) => ({
            getTextContent: async () => ({
              items: n === 1
                ? [{ str: 'Contrato de arrendamento — cláusula 7: ' }, { str: 'renda de CODIGOSECRETO987 por mês.' }]
                : [{ str: 'Página final, sem termos relevantes.' }]
            })
          })
        })
      })
    };
  });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Search Attach Test');
  await page.fill('#regUsername', 'searchattach_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'searchattach' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.chats.push({ id: 'dm_searchattach', name: 'Anexo Chat', phone: '+351900000099', type: 'user' });
    renderChatList();
  });
  await page.click('.chat-item:has-text("Anexo Chat")');
  await page.waitForTimeout(300);

  // --- Send the .txt attachment (real extraction path, no pdf.js involved) ---
  await page.setInputFiles('#attachFileInput', path.join(__dirname, 'test_doc.txt'));
  await page.waitForTimeout(600);
  const txtAttachmentText = await page.evaluate(() => {
    const msgs = APP.messages['dm_searchattach'] || [];
    const m = msgs.find(x => x.fileName === 'test_doc.txt');
    return m ? m.attachmentText : null;
  });
  console.log('Texto extraído de um .txt contém o conteúdo real do ficheiro:', !!txtAttachmentText && txtAttachmentText.includes('SEGREDO_PROJETO_XPTO123'));

  // --- Send a fake .pdf attachment (goes through the stubbed pdf.js) ---
  // Reuse test_doc.txt's bytes but rename via a Buffer upload as .pdf so the extension/
  // mimetype route it to the PDF branch; the stub ignores the actual bytes anyway.
  await page.setInputFiles('#attachFileInput', {
    name: 'contrato.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake pdf bytes, content is irrelevant since pdf.js is stubbed'),
  });
  await page.waitForTimeout(600);
  const pdfAttachmentText = await page.evaluate(() => {
    const msgs = APP.messages['dm_searchattach'] || [];
    const m = msgs.find(x => x.fileName === 'contrato.pdf');
    return m ? m.attachmentText : null;
  });
  console.log('Texto extraído do PDF (via pdf.js) contém o conteúdo da página 1:', !!pdfAttachmentText && pdfAttachmentText.includes('CODIGOSECRETO987'));
  console.log('Texto extraído do PDF junta o conteúdo de várias páginas:', !!pdfAttachmentText && pdfAttachmentText.includes('Página final'));

  // --- Global search must find messages by CONTENT of the attachment, not just filename ---
  await page.click('button[onclick="openGlobalSearchModal()"]');
  await page.waitForSelector('#modalGlobalSearch.active');
  await page.fill('#globalSearchInput', 'CODIGOSECRETO987');
  await page.waitForTimeout(400);
  const resultsHtml = await page.evaluate(() => document.getElementById('globalSearchResults').innerHTML);
  console.log('Pesquisa global encontra um termo que só existe DENTRO do PDF:', resultsHtml.includes('CODIGOSECRETO987'));
  console.log('Resultado mostra a etiqueta 📎 com o nome do ficheiro (explica de onde veio):', resultsHtml.includes('📎') && resultsHtml.includes('contrato.pdf'));

  await page.fill('#globalSearchInput', 'SEGREDO_PROJETO_XPTO123');
  await page.waitForTimeout(400);
  const resultsHtml2 = await page.evaluate(() => document.getElementById('globalSearchResults').innerHTML);
  console.log('Pesquisa global encontra um termo que só existe DENTRO do .txt:', resultsHtml2.includes('SEGREDO_PROJETO_XPTO123'));

  // --- A search term that appears nowhere (not in text, not in any attachment) finds nothing ---
  await page.fill('#globalSearchInput', 'termoQueNaoExisteEmLadoNenhum999');
  await page.waitForTimeout(400);
  const noResultsHtml = await page.evaluate(() => document.getElementById('globalSearchResults').innerHTML);
  console.log('Termo inexistente não dá resultados nem crasha:', noResultsHtml.includes('Nenhuma mensagem encontrada'));

  // --- A normal image attachment (no extractable text) must not crash or set attachmentText ---
  await page.setInputFiles('#attachFileInput', path.join(__dirname, 'test_photo.png'));
  await page.waitForTimeout(500);
  const hasPreview = await page.evaluate(() => document.getElementById('modalAttachmentPreview').classList.contains('active'));
  if (hasPreview) {
    await page.click('#modalAttachmentPreview button:has-text("Enviar")').catch(() => {});
    await page.waitForTimeout(400);
  }
  const photoAttachmentText = await page.evaluate(() => {
    const msgs = APP.messages['dm_searchattach'] || [];
    const photoMsg = [...msgs].reverse().find(x => (x.fileType || '').startsWith('image/'));
    return photoMsg ? photoMsg.attachmentText : 'NO_PHOTO_MSG_FOUND';
  });
  console.log('Fotos não geram attachmentText (não há texto para extrair de uma imagem):', photoAttachmentText == null);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
