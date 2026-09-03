const { chromium } = require('playwright');

// Testa o "Restaurar a partir de um ficheiro" (o par do "Exportar os meus
// dados" já existente): idioma, aniversário, chave Pix, contactos e
// lembretes devem voltar para uma conta NOVA (o cenário real: reinstalou a
// app, trocou de aparelho, ou recriou a conta) — mas NUNCA mensagens, senha
// ou nome de utilizador/identidade da conta.
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // --- Bob: só para ser um contacto real que ainda existe, para testar a
  // readição de contactos no restauro. ---
  const bobPage = await browser.newPage();
  const ts0 = Date.now();
  await bobPage.goto('http://localhost:3000');
  await bobPage.click('.login-switch');
  await bobPage.fill('#regName', 'Bob Contact');
  await bobPage.fill('#regUsername', 'bobimport_' + ts0);
  await bobPage.fill('#regPhone', '+3519' + ts0.toString().slice(-8));
  await bobPage.selectOption('#regCountry', 'Portugal');
  await bobPage.fill('#regEmail', 'bobimport' + ts0 + '@test.com');
  await bobPage.fill('#regPassword', 'senha1234forte');
  await bobPage.click('button:has-text("Criar conta")');
  await bobPage.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const bobUsername = await bobPage.evaluate(() => APP.user.username);
  const bobPhone = await bobPage.evaluate(() => APP.user.phone);

  // --- Alice: a conta ORIGINAL, com dados a exportar. ---
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION (Alice):', err.message));
  const ts = Date.now() + 1;
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  await page.fill('#regName', 'Alice Original');
  await page.fill('#regUsername', 'aliceimport_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'aliceimport' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Alice torna-se contacto real do Bob (procurar utilizador).
  await page.evaluate(() => openSearchUserModal());
  await page.fill('#searchUsernameInput', bobUsername);
  await page.evaluate(() => doSearchUser());
  await page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await page.click('button:has-text("Iniciar conversa")');
  await page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });

  // Alice configura idioma, aniversário e chave Pix no perfil.
  await page.evaluate(() => openProfileModal());
  await page.selectOption('#profileLangSelect', 'es');
  await page.evaluate(() => setPreferredLang('es'));
  await page.fill('#profileBirthdayInput', '1990-05-20');
  await page.evaluate(() => setBirthday('1990-05-20'));
  await page.fill('#profilePixKeyInput', 'alice-original@example.com');
  await page.dispatchEvent('#profilePixKeyInput', 'change');
  await page.waitForTimeout(400);
  await page.evaluate(() => closeModal('modalProfile'));

  // Alice adiciona um lembrete (id gerado pelo servidor).
  const reminderInfo = await page.evaluate(() => new Promise((resolve) => {
    socket.once('reminders_list', (list) => {
      const last = (list || [])[list.length - 1];
      resolve(last ? { id: last.id, text: last.text } : null);
    });
    socket.emit('add_reminder', { text: 'Levar guarda-chuva', remindAt: Date.now() + 86400000 });
  }));
  console.log('Lembrete criado com sucesso (setup):', reminderInfo && reminderInfo.text === 'Levar guarda-chuva');

  // --- Alice exporta os dados (mesma API que o botão "Exportar" usa). ---
  const exportedData = await page.evaluate(async () => {
    const res = await fetch('/api/account/export', { headers: { 'x-auth-token': APP.token } });
    return res.json();
  });
  console.log('Export inclui a chave Pix configurada:', exportedData.perfil.pixKey === 'alice-original@example.com');
  console.log('Export inclui o contacto do Bob:', exportedData.contactos.includes(bobPhone));
  console.log('Export inclui o lembrete criado:', (exportedData.lembretes || []).some(r => r.id === reminderInfo.id && r.text === 'Levar guarda-chuva'));

  // --- Nova conta ("Alice Nova" — simula reinstalar a app / recriar a conta). ---
  const newPage = await browser.newPage();
  newPage.on('pageerror', err => console.log('PAGE EXCEPTION (Alice Nova):', err.message));
  const ts2 = Date.now() + 2;
  await newPage.goto('http://localhost:3000');
  await newPage.click('.login-switch');
  await newPage.fill('#regName', 'Alice Nova');
  await newPage.fill('#regUsername', 'alicenova_' + ts2);
  await newPage.fill('#regPhone', '+3519' + ts2.toString().slice(-8));
  await newPage.selectOption('#regCountry', 'Portugal');
  await newPage.fill('#regEmail', 'alicenova' + ts2 + '@test.com');
  await newPage.fill('#regPassword', 'senha1234forte');
  await newPage.click('button:has-text("Criar conta")');
  await newPage.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const originalUsername = await newPage.evaluate(() => APP.user.username);

  await newPage.evaluate(() => openProfileModal());
  const noPixBefore = await newPage.evaluate(() => document.getElementById('profilePixKeyInput').value === '');
  console.log('Conta nova começa sem chave Pix (estado inicial limpo):', noPixBefore);

  // O confirm() dispara quase de imediato depois do ficheiro ser escolhido —
  // o listener de diálogos tem de estar pronto ANTES de setInputFiles, senão
  // o Playwright chega a descartar o diálogo sozinho (comportamento por
  // omissão sem handler nenhum) antes deste código o conseguir apanhar.
  const dialogMsgs = [];
  const dialogPromise = new Promise((resolve) => {
    newPage.on('dialog', (d) => {
      dialogMsgs.push(d.message());
      d.accept();
      if (dialogMsgs.length === 2) resolve();
    });
  });

  // Escolhe o ficheiro exportado através do próprio input de restauro (mesmo
  // caminho que um utilizador real usaria) — sem escrever nada em disco,
  // Playwright aceita um buffer em memória diretamente.
  await newPage.setInputFiles('#importDataFileInput', {
    name: 'os-meus-dados-chatapp.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exportedData))
  });

  await Promise.race([dialogPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout à espera dos 2 diálogos (confirm + resumo)')), 10000))]);
  const [confirmMsg, summaryMsg] = dialogMsgs;
  console.log('Diálogo de confirmação explica o que vai ser restaurado:', confirmMsg.includes('idioma') && confirmMsg.includes('senha'));
  console.log('Diálogo de resumo confirma 1 contacto e 1 lembrete restaurados:', summaryMsg.includes('Contactos readicionados: 1') && summaryMsg.includes('Lembretes trazidos de volta: 1'));

  await newPage.waitForSelector('#mainApp', { state: 'visible', timeout: 10000 }); // após location.reload() + reautenticação
  await newPage.waitForTimeout(800);

  const restoredLang = await newPage.evaluate(() => APP.user.preferredLang);
  console.log('Idioma preferido restaurado (es):', restoredLang === 'es');
  const restoredBirthday = await newPage.evaluate(() => APP.user.birthday);
  console.log('Aniversário restaurado:', restoredBirthday === '1990-05-20');
  const restoredPixKey = await newPage.evaluate(() => APP.user.pixKey);
  console.log('Chave Pix restaurada:', restoredPixKey === 'alice-original@example.com');

  const restoredContacts = await newPage.evaluate((bp) => (APP.onlineContacts || []).some(c => c.phone === bp), bobPhone);
  console.log('Bob voltou a ser contacto real:', restoredContacts);

  const restoredReminders = await newPage.evaluate((rid) => (REMINDERS.items || []).some(r => r.id === rid && r.text === 'Levar guarda-chuva'), reminderInfo.id);
  console.log('Lembrete restaurado (mesmo id do servidor):', restoredReminders);

  const identityUntouched = await newPage.evaluate((expectedUsername) => APP.user.username === expectedUsername, originalUsername);
  console.log('Identidade da conta (nome de utilizador) nunca é substituída pelo restauro:', identityUntouched);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
