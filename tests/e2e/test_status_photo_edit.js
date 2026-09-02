const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Status Edit Test');
  await page.fill('#regUsername', 'statusedit_' + ts);
  await page.fill('#regPhone', '+3516' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'statusedit' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('button[onclick="openStatusScreen()"]');
  await page.waitForSelector('#statusScreen.active');
  // Antes de teres qualquer estado próprio, "openNewStatusModal()" está no clique da própria
  // linha "O meu estado" (avatar/info), não num botão à parte — esse só aparece depois de já
  // teres pelo menos um estado ativo (ver renderStatusPanel).
  await page.click('[onclick="openNewStatusModal()"]');
  await page.waitForSelector('#modalNewStatus.active');

  // --- Edit button is not visible before a photo is chosen ---
  const editHiddenBeforePhoto = await page.evaluate(() => getComputedStyle(document.getElementById('newStatusPhotoPreview')).display === 'none');
  console.log('O botão "Editar" fica escondido antes de escolher uma foto:', editHiddenBeforePhoto);

  // --- Choose a photo (goes through the existing selection/upload flow) ---
  await page.setInputFiles('#statusPhotoInput', path.join(__dirname, 'test_photo_large.png'));
  await page.waitForTimeout(500);
  const photoPreviewShown = await page.evaluate(() => document.getElementById('newStatusPhotoPreview').style.display === 'block');
  console.log('A pré-visualização da foto do estado aparece depois de escolher o ficheiro:', photoPreviewShown);
  const urlBeforeEdit = await page.evaluate(() => APP.pendingStatusPhotoUrl);

  // --- Open the SAME photo editor from the status flow ---
  await page.click('#newStatusPhotoPreview button:has-text("Editar")');
  await page.waitForSelector('#modalPhotoEditor.active');
  await page.waitForTimeout(300);
  const canvasLoaded = await page.evaluate(() => {
    const c = document.getElementById('photoEditorCanvas');
    return c.width > 0 && c.height > 0;
  });
  console.log('O editor carrega a foto do estado no canvas:', canvasLoaded);

  // --- Draw something and save ---
  await page.click('#peToolDraw');
  const box = await page.locator('#photoEditorCanvas').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.click('#modalPhotoEditor button:has-text("Guardar")');
  await page.waitForTimeout(500);

  const editorClosed = await page.evaluate(() => !document.getElementById('modalPhotoEditor').classList.contains('active'));
  console.log('Guardar fecha o editor e volta ao ecrã do novo estado:', editorClosed);
  const newStatusModalStillActive = await page.evaluate(() => document.getElementById('modalNewStatus').classList.contains('active'));
  console.log('O modal "Novo estado" continua ativo depois de guardar a edição:', newStatusModalStillActive);
  const urlAfterEdit = await page.evaluate(() => APP.pendingStatusPhotoUrl);
  console.log('A foto pendente do estado foi atualizada com a versão editada:', urlAfterEdit !== urlBeforeEdit && !!urlAfterEdit);
  const previewImgUpdated = await page.evaluate((oldUrl) => document.getElementById('newStatusPhotoImg').src !== oldUrl, urlBeforeEdit);
  console.log('A pré-visualização do estado reflete a versão editada:', previewImgUpdated);

  // --- Publishing sends the EDITED photo ---
  await page.fill('#newStatusText', 'Estado com foto editada');
  await page.click('#modalNewStatus button:has-text("Publicar")');
  await page.waitForTimeout(1000);
  const myStatusPosted = await page.evaluate(() => APP.statusFeed.some(s => s.phone === APP.user.phone && s.items.some(i => i.text === 'Estado com foto editada')));
  console.log('O estado é publicado com sucesso depois de editar a foto:', myStatusPosted);

  // --- Regression: editing a normal chat attachment still works after the generalization ---
  await page.evaluate(() => { closeModal('modalNewStatus'); closeStatusScreen(); APP.chats.push({ id: 'regchat', type: 'user', name: 'Reg Chat', phone: '+351966666666' }); renderChatList(); });
  await page.click('.chat-item:has-text("Reg Chat")');
  await page.waitForTimeout(300);
  await page.setInputFiles('#attachFileInput', path.join(__dirname, 'test_photo_large.png'));
  await page.waitForSelector('#modalAttachmentPreview.active');
  const originalChatDataUrl = await page.evaluate(() => APP.pendingAttachment.dataUrl);
  await page.click('#modalAttachmentPreview button:has-text("Editar")');
  await page.waitForSelector('#modalPhotoEditor.active');
  await page.waitForTimeout(300);
  await page.click('#peToolDraw');
  const box2 = await page.locator('#photoEditorCanvas').boundingBox();
  await page.mouse.move(box2.x + 10, box2.y + 10);
  await page.mouse.down();
  await page.mouse.move(box2.x + 40, box2.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.click('#modalPhotoEditor button:has-text("Guardar")');
  await page.waitForTimeout(300);
  const chatAttachmentStillUpdated = await page.evaluate((orig) => APP.pendingAttachment.dataUrl !== orig, originalChatDataUrl);
  console.log('REGRESSÃO: editar um anexo de conversa (fluxo original) continua a funcionar:', chatAttachmentStillUpdated);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
