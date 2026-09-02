const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Photo Editor Test');
  await page.fill('#regUsername', 'photoedit_' + ts);
  await page.fill('#regPhone', '+3513' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'photoedit' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.chats.push({ id: 'photoeditchat', type: 'user', name: 'Photo Chat', phone: '+351955555555' });
    renderChatList();
  });
  await page.click('.chat-item:has-text("Photo Chat")');
  await page.waitForTimeout(300);

  // --- Attach a photo, preview modal opens ---
  // Usa uma imagem maior (200x200) em vez do test_photo.png padrão (1x1 pixel, fixture
  // minúscula usada noutros testes) — um canvas de 1x1 não dá para clicar/arrastar em nada.
  await page.setInputFiles('#attachFileInput', path.join(__dirname, 'test_photo_large.png'));
  await page.waitForSelector('#modalAttachmentPreview.active');
  const originalDataUrl = await page.evaluate(() => APP.pendingAttachment.dataUrl);

  // --- Open the photo editor from the preview modal ---
  await page.click('#modalAttachmentPreview button:has-text("Editar")');
  await page.waitForSelector('#modalPhotoEditor.active');
  await page.waitForTimeout(300);
  const canvasHasContent = await page.evaluate(() => {
    const c = document.getElementById('photoEditorCanvas');
    return c.width > 0 && c.height > 0;
  });
  // Regressão do bug reportado: em telemóveis pequenos, sem scroll o utilizador ficava
  // "preso" no editor porque os botões Cancelar/Guardar caíam fora do ecrã visível.
  const modalScrollable = await page.evaluate(() => {
    const modal = document.querySelector('#modalPhotoEditor .modal');
    const style = getComputedStyle(modal);
    return style.overflowY === 'auto' && parseFloat(style.maxHeight) > 0;
  });
  console.log('O modal do editor tem scroll ativado (não fica "preso" em ecrãs pequenos):', modalScrollable);
  console.log('O editor carrega a imagem no canvas:', canvasHasContent);

  // --- Draw a stroke on the canvas ---
  // Nota: cada troca de ferramenta mostra/esconde uma linha de opções diferente (cor+pincel,
  // emojis, cortar), o que desloca o canvas verticalmente — por isso a posição é sempre
  // remedida depois de mudar de ferramenta, nunca reaproveitada de uma medição antiga.
  await page.click('#peToolDraw');
  let box = await page.locator('#photoEditorCanvas').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, box.y + 50, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const canvasAfterDraw = await page.evaluate(() => document.getElementById('photoEditorCanvas').toDataURL());
  console.log('Desenhar no canvas altera o conteúdo (não fica igual à imagem original):', canvasAfterDraw !== originalDataUrl);

  // --- Add text: a real in-page input now, no native prompt() dialog ---
  await page.click('#peToolText');
  box = await page.locator('#photoEditorCanvas').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 30);
  const overlayVisible = await page.evaluate(() => document.getElementById('peTextOverlayInput').style.display === 'block');
  console.log('Tocar com a ferramenta de texto mostra um campo de texto normal (não um prompt() do navegador):', overlayVisible);
  await page.fill('#peTextOverlayInput', 'OLA');
  const typedValueVisible = await page.evaluate(() => document.getElementById('peTextOverlayInput').value === 'OLA');
  console.log('É possível ver/corrigir o que se escreveu antes de confirmar:', typedValueVisible);
  await page.press('#peTextOverlayInput', 'Enter');
  await page.waitForTimeout(150);
  const overlayHiddenAfterCommit = await page.evaluate(() => document.getElementById('peTextOverlayInput').style.display === 'none');
  console.log('Confirmar com Enter esconde o campo de texto:', overlayHiddenAfterCommit);
  const canvasAfterText = await page.evaluate(() => document.getElementById('photoEditorCanvas').toDataURL());
  console.log('Escrever texto altera o conteúdo do canvas de novo:', canvasAfterText !== canvasAfterDraw);

  // --- Escape cancels the text without drawing anything, and must NOT bubble up to the
  // app's global "Escape closes every active modal" shortcut (a real bug found: it did,
  // closing the whole photo editor instead of just cancelling the text) ---
  await page.mouse.click(box.x + 70, box.y + 70);
  await page.fill('#peTextOverlayInput', 'NAO DEVIA APARECER');
  await page.press('#peTextOverlayInput', 'Escape');
  await page.waitForTimeout(150);
  const editorStillOpenAfterEscape = await page.evaluate(() => document.getElementById('modalPhotoEditor').classList.contains('active'));
  console.log('Escape no campo de texto NÃO fecha o editor inteiro (só cancela o texto):', editorStillOpenAfterEscape);
  const canvasAfterEscape = await page.evaluate(() => document.getElementById('photoEditorCanvas').toDataURL());
  console.log('Escape cancela sem desenhar nada no canvas:', canvasAfterEscape === canvasAfterText);

  // --- Add an emoji --- (scoped to #peEmojiOptions — "🔥" also matches the unrelated fire-alerts button elsewhere in the app)
  await page.click('#peToolEmoji');
  box = await page.locator('#photoEditorCanvas').boundingBox();
  await page.click('#peEmojiOptions button:has-text("🔥")');
  await page.mouse.click(box.x + 60, box.y + 60);
  await page.waitForTimeout(150);
  const canvasAfterEmoji = await page.evaluate(() => document.getElementById('photoEditorCanvas').toDataURL());
  console.log('Colar um emoji altera o conteúdo do canvas de novo:', canvasAfterEmoji !== canvasAfterText);

  // --- Undo removes the last change (emoji) ---
  await page.click('#modalPhotoEditor button:has-text("Desfazer")');
  await page.waitForTimeout(150);
  const canvasAfterUndo = await page.evaluate(() => document.getElementById('photoEditorCanvas').toDataURL());
  console.log('Desfazer volta ao estado anterior (antes do emoji):', canvasAfterUndo === canvasAfterText);

  // --- Crop: drag a selection, then apply ---
  const canvasRealSize = await page.evaluate(() => ({ w: document.getElementById('photoEditorCanvas').width, h: document.getElementById('photoEditorCanvas').height }));
  await page.click('#peToolCrop');
  box = await page.locator('#photoEditorCanvas').boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.click('#modalPhotoEditor button:has-text("Aplicar corte")');
  await page.waitForTimeout(150);
  const canvasAfterCrop = await page.evaluate(() => ({ w: document.getElementById('photoEditorCanvas').width, h: document.getElementById('photoEditorCanvas').height }));
  console.log('Cortar reduz o tamanho do canvas para a área selecionada:', canvasAfterCrop.w < canvasRealSize.w && canvasAfterCrop.h < canvasRealSize.h);

  // --- Undo restores the pre-crop size too ---
  await page.click('#modalPhotoEditor button:has-text("Desfazer")');
  await page.waitForTimeout(150);
  const canvasAfterCropUndo = await page.evaluate(() => ({ w: document.getElementById('photoEditorCanvas').width, h: document.getElementById('photoEditorCanvas').height }));
  console.log('Desfazer um corte também repõe as dimensões anteriores do canvas:', canvasAfterCropUndo.w === canvasRealSize.w && canvasAfterCropUndo.h === canvasRealSize.h);

  // --- Reset original discards ALL edits, back to the untouched photo ---
  await page.click('#modalPhotoEditor button:has-text("Repor original")');
  await page.waitForTimeout(200);
  const canvasAfterReset = await page.evaluate(() => document.getElementById('photoEditorCanvas').toDataURL());
  // A imagem original é redesenhada a partir do dataUrl original — comparamos indiretamente
  // pelo tamanho do canvas voltar ao original (o toDataURL da própria imagem pode ter uma
  // codificação ligeiramente diferente do PNG de origem, mas as dimensões não mentem).
  const sizeAfterReset = await page.evaluate(() => ({ w: document.getElementById('photoEditorCanvas').width, h: document.getElementById('photoEditorCanvas').height }));
  console.log('Repor original volta às dimensões da imagem original:', sizeAfterReset.w === canvasRealSize.w && sizeAfterReset.h === canvasRealSize.h);

  // --- Draw something again, then Save — the edited image replaces the pending attachment ---
  await page.click('#peToolDraw');
  box = await page.locator('#photoEditorCanvas').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.click('#modalPhotoEditor button:has-text("Guardar")');
  await page.waitForTimeout(200);
  const editorClosedAfterSave = await page.evaluate(() => !document.getElementById('modalPhotoEditor').classList.contains('active'));
  console.log('Guardar fecha o editor e volta à pré-visualização:', editorClosedAfterSave);
  const previewModalStillActive = await page.evaluate(() => document.getElementById('modalAttachmentPreview').classList.contains('active'));
  console.log('A pré-visualização continua ativa depois de guardar a edição:', previewModalStillActive);
  const pendingAttachmentUpdated = await page.evaluate((orig) => APP.pendingAttachment.dataUrl !== orig && APP.pendingAttachment.fileType === 'image/png', originalDataUrl);
  console.log('O anexo pendente foi atualizado com a imagem editada:', pendingAttachmentUpdated);
  const previewImgUpdated = await page.evaluate((orig) => document.getElementById('viewOncePreviewImg').src !== orig, originalDataUrl);
  console.log('A imagem de pré-visualização reflete a versão editada:', previewImgUpdated);

  // --- Sending now sends the EDITED image, not the original ---
  await page.click('#modalAttachmentPreview button:has-text("Enviar")');
  await page.waitForTimeout(500);
  const sentFileType = await page.evaluate(() => {
    const msgs = APP.messages['photoeditchat'] || [];
    const last = msgs[msgs.length - 1];
    return last?.fileType;
  });
  console.log('A mensagem enviada usa a imagem editada (fileType image/png do canvas):', sentFileType === 'image/png');

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
