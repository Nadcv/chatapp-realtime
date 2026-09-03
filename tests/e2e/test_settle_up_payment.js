const { chromium } = require('playwright');

// Testa o "acertar contas" (MB WAY / Pix) nas despesas de viagem: a chave Pix
// do perfil, a simplificação de dívidas (quem paga a quem), e a geração do
// código Pix "copia e cola" (formato EMV/BR Code do Banco Central).
async function registerUser(browser, label, prefix) {
  const page = await browser.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION (${label}):`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  await page.fill('#regName', label);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const phone = await page.evaluate(() => APP.user.phone);
  const username = await page.evaluate(() => APP.user.username);
  return { page, phone, username };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const alice = await registerUser(browser, 'Alice', 'alicepix_');
  const bob = await registerUser(browser, 'Bob', 'bobpix_');

  // --- Chave Pix no perfil ---
  await bob.page.evaluate(() => openProfileModal());
  await bob.page.fill('#profilePixKeyInput', 'bob@example.com');
  await bob.page.dispatchEvent('#profilePixKeyInput', 'change');
  await bob.page.waitForTimeout(300);
  const bobPixSaved = await bob.page.evaluate(() => APP.user.pixKey);
  console.log('Chave Pix do perfil é guardada e devolvida pelo servidor:', bobPixSaved === 'bob@example.com');
  await bob.page.evaluate(() => closeModal('modalProfile'));

  // --- Alice e Bob tornam-se contactos reais (procurar utilizador) ---
  await alice.page.evaluate(() => openSearchUserModal());
  await alice.page.fill('#searchUsernameInput', bob.username);
  await alice.page.evaluate(() => doSearchUser());
  await alice.page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await alice.page.click('button:has-text("Iniciar conversa")');
  await alice.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });

  await bob.page.evaluate(() => openSearchUserModal());
  await bob.page.fill('#searchUsernameInput', alice.username);
  await bob.page.evaluate(() => doSearchUser());
  await bob.page.waitForSelector('button:has-text("Iniciar conversa")', { timeout: 8000 });
  await bob.page.click('button:has-text("Iniciar conversa")');
  await bob.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });

  // Cada um manda uma mensagem real — getChatParticipantNames deriva de quem já
  // enviou mensagens nesta conversa (grupos/DMs abertos não têm lista de membros).
  await alice.page.fill('#messageInput', 'Oi Bob!');
  await alice.page.press('#messageInput', 'Enter');
  await alice.page.waitForTimeout(400);
  await bob.page.waitForTimeout(400);
  await bob.page.fill('#messageInput', 'Oi Alice!');
  await bob.page.press('#messageInput', 'Enter');
  await alice.page.waitForTimeout(600);

  // --- Alice regista uma despesa paga por Bob, dividida por ambos ---
  await alice.page.evaluate(() => openExpensesModal());
  await alice.page.waitForSelector('#modalExpenses.active', { timeout: 5000 });
  await alice.page.evaluate(() => openAddExpenseForm());
  await alice.page.waitForSelector('#modalAddExpense.active');
  await alice.page.fill('#expenseDescription', 'Jantar');
  await alice.page.fill('#expenseAmount', '20');
  const paidByOptions = await alice.page.evaluate(() => [...document.getElementById('expensePaidBy').options].map(o => ({ value: o.value, label: o.textContent })));
  console.log('PaidBy tem 2 opções (Você/Alice + Bob pelo nome real):', paidByOptions.length === 2);
  const bobOption = paidByOptions.find(o => o.label === 'Bob');
  await alice.page.selectOption('#expensePaidBy', bobOption.value);
  await alice.page.click('#modalAddExpense button:has-text("Adicionar")');
  await alice.page.waitForTimeout(500);

  // --- "Como acertar contas" mostra a transferência simplificada ---
  await alice.page.evaluate(() => openExpensesModal());
  await alice.page.waitForTimeout(300);
  const settleUpText = await alice.page.evaluate(() => document.getElementById('settleUpBox').innerText);
  console.log('Mostra "Você → Bob" (Alice deve a Bob):', settleUpText.includes('Você') && settleUpText.includes('Bob') && settleUpText.includes('10.00'));

  await alice.page.click('#settleUpBox button:has-text("Ver")');
  await alice.page.waitForSelector('#modalSettleUpPay.active', { timeout: 5000 });
  await alice.page.waitForTimeout(1000); // dá tempo à resolução assíncrona do telefone/chave Pix
  const payContent = await alice.page.evaluate(() => document.getElementById('settleUpPayContent').innerText);
  console.log('Mostra a opção MB WAY com o número real de telefone do Bob:', payContent.includes('MB WAY') && payContent.includes(bob.phone));
  console.log('Mostra a secção Pix (Bob tem chave configurada):', payContent.includes('Pix'));

  const pixPayload = await alice.page.evaluate(() => {
    const ta = document.querySelector('#settleUpPayContent textarea');
    return ta ? ta.value : null;
  });
  console.log('Gera um código Pix (payload não vazio):', !!pixPayload && pixPayload.startsWith('000201'));

  // Verifica a estrutura TLV e o CRC16 do código Pix gerado (formato BR Code do Banco Central).
  const pixValid = await alice.page.evaluate((payload) => {
    function crc16ccitt(str) {
      let crc = 0xFFFF;
      for (let i = 0; i < str.length; i++) {
        crc ^= (str.charCodeAt(i) << 8);
        for (let j = 0; j < 8; j++) crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
      }
      return crc & 0xFFFF;
    }
    const before = payload.slice(0, -4);
    const crcInPayload = payload.slice(-4);
    const recomputed = crc16ccitt(before).toString(16).toUpperCase().padStart(4, '0');
    const hasPixGui = payload.includes('br.gov.bcb.pix');
    const hasPixKey = payload.includes('bob@example.com');
    return { crcMatches: crcInPayload === recomputed, hasPixGui, hasPixKey };
  }, pixPayload);
  console.log('CRC16 do código Pix está correto:', pixValid.crcMatches);
  console.log('Código Pix contém o GUI oficial (br.gov.bcb.pix):', pixValid.hasPixGui);
  console.log('Código Pix contém a chave Pix do Bob:', pixValid.hasPixKey);

  // Botão de copiar dá feedback visual.
  await alice.page.click('#settleUpPayContent button:has-text("Copiar código Pix")');
  await alice.page.waitForTimeout(200);
  const copyFeedback = await alice.page.evaluate(() => [...document.querySelectorAll('#settleUpPayContent button')].map(b => b.textContent).find(t => t.includes('Copiado')) || '');
  console.log('Botão de copiar dá feedback visual ("Copiado!"):', copyFeedback.includes('Copiado'));

  // --- Sem chave Pix configurada: mostra aviso em vez de rebentar ---
  await bob.page.evaluate(() => openProfileModal());
  await bob.page.fill('#profilePixKeyInput', '');
  await bob.page.dispatchEvent('#profilePixKeyInput', 'change');
  await bob.page.waitForTimeout(300);
  await bob.page.evaluate(() => closeModal('modalProfile'));
  await alice.page.click('#modalSettleUpPay button:has-text("Fechar")');
  await alice.page.waitForTimeout(200);
  await alice.page.evaluate(() => openExpensesModal());
  await alice.page.waitForTimeout(200);
  await alice.page.click('#settleUpBox button:has-text("Ver")');
  await alice.page.waitForTimeout(1200);
  const payContentNoKey = await alice.page.evaluate(() => document.getElementById('settleUpPayContent').innerText);
  console.log('Sem chave Pix, mostra aviso amigável em vez de rebentar:', payContentNoKey.includes('ainda não configurou') && !payContentNoKey.includes('undefined'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
