const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Verificação para a escrita segura de ficheiros JSON locais (ver
// writeJsonFileSafe() no server.js) — usada quando MONGO_URI não está
// definida (o caso deste ambiente de testes). Antes desta correção, cada
// "save*Local()" gravava com um fs.writeFile(FICHEIRO, JSON.stringify(...))
// direto: duas gravações do MESMO ficheiro perto uma da outra (ex.: duas
// mensagens seguidas, cada uma a chamar saveMessagesLocal()) abrem o
// ficheiro cada uma por si (open + truncate + write + close) sem nenhuma
// ordem garantida entre elas — na teoria, isso pode originar tanto conteúdo
// misturado (uma escrita a meio de outra) como uma "escrita perdida" (a mais
// recente é substituída pela mais antiga, que ainda estava a demorar).
//
// NOTA HONESTA sobre este teste: tentei mesmo forçar essa falha diretamente
// (100 escritas concorrentes de ~200KB cada, sem a fila) para confirmar que
// este teste apanhava o bug antes da correção — e não consegui reproduzi-la
// de forma fiável neste disco local rápido (as escritas são demasiado
// rápidas para a janela de corrida abrir a sério aqui). Ou seja: este teste
// NÃO está confirmado a apanhar sempre a regressão se voltar a acontecer —
// mas continua a verificar o comportamento correto que a correção garante
// (fila por ficheiro + troca atómica de nome), e serve de proteção
// razoável mesmo sem ser uma prova definitiva.
//
// Este teste faz duas contas mandarem muitas mensagens SEM esperar pela
// resposta de cada uma — a forma mais direta de gerar dezenas de gravações
// concorrentes do mesmo ficheiro messages.json — e depois lê o ficheiro
// diretamente do disco (não pelo cliente) para confirmar que: (1) continua a
// ser um JSON válido e (2) todas as mensagens enviadas por ambos os lados
// estão mesmo lá.
const MESSAGES_PER_USER = 30;
const DATA_FILE = path.join(__dirname, '..', '..', 'messages.json');

async function registerUser(browser, label) {
  const page = await browser.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION (${label}):`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  await page.fill('#regName', label);
  await page.fill('#regUsername', 'jw_' + label.toLowerCase() + '_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'jw_' + label.toLowerCase() + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const phone = await page.evaluate(() => APP.user.phone);
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const alice = await registerUser(browser, 'Alice');
  const bob = await registerUser(browser, 'Bob');

  // Contacto direto dos dois lados (o objetivo aqui é o stress da escrita em
  // disco, não a descoberta de utilizadores — já testada noutro lado).
  await alice.page.evaluate((phone) => socket.emit('add_contact', { phone }), bob.phone);
  await bob.page.evaluate((phone) => socket.emit('add_contact', { phone }), alice.phone);
  await alice.page.waitForTimeout(600);
  await bob.page.waitForTimeout(600);

  await alice.page.click('.chat-item:has-text("Bob")');
  await bob.page.click('.chat-item:has-text("Alice")');
  await alice.page.waitForTimeout(300);
  await bob.page.waitForTimeout(300);

  const chatId = await alice.page.evaluate(() => APP.currentChatId);

  // Dispara N mensagens de cada lado SEM esperar pela resposta de cada uma —
  // é isto que gera as gravações concorrentes do mesmo messages.json.
  await Promise.all([
    alice.page.evaluate(async (n) => {
      for (let i = 0; i < n; i++) {
        document.getElementById('messageInput').value = 'ALICE_MARKER_' + i;
        await sendMessage('messageInput');
      }
    }, MESSAGES_PER_USER),
    bob.page.evaluate(async (n) => {
      for (let i = 0; i < n; i++) {
        document.getElementById('messageInput').value = 'BOB_MARKER_' + i;
        await sendMessage('messageInput');
      }
    }, MESSAGES_PER_USER)
  ]);

  // Espera a fila de escrita no servidor assentar — em vez de um tempo fixo
  // arriscado, tenta ler e interpretar o ficheiro repetidamente até parar de
  // mudar (ou esgotar o tempo).
  let raw = null;
  let stableCount = 0;
  for (let i = 0; i < 40 && stableCount < 3; i++) {
    await new Promise((r) => setTimeout(r, 150));
    let current;
    try { current = fs.readFileSync(DATA_FILE, 'utf-8'); } catch (e) { continue; }
    stableCount = (current === raw) ? stableCount + 1 : 0;
    raw = current;
  }

  let parsed = null;
  let parseError = null;
  try { parsed = JSON.parse(raw); } catch (e) { parseError = e.message; }
  console.log('O ficheiro messages.json continua um JSON válido depois de escritas concorrentes:', !parseError);
  if (parseError) console.log('  (erro de parse:', parseError, ')');

  // Nota: as contas já têm as chaves públicas trocadas nesta altura (a conta
  // é registada com a sua chave logo publicada), por isso estas mensagens
  // vão encriptadas (ver E2EE em sendMessage() no index.html) — "text" fica
  // sempre "🔒 Mensagem encriptada" no que é gravado no servidor, nunca o
  // marcador original. Por isso a contagem usa "senderPhone" (nunca
  // encriptado) em vez do texto, para funcionar tanto encriptado como não.
  const roomMessages = parsed ? (parsed[chatId] || []) : [];
  const aliceMessages = roomMessages.filter(m => m.senderPhone === alice.phone);
  const bobMessages = roomMessages.filter(m => m.senderPhone === bob.phone);
  console.log(`Todas as ${MESSAGES_PER_USER} mensagens da Alice estão no ficheiro (nenhuma perdida numa escrita concorrente):`, aliceMessages.length === MESSAGES_PER_USER);
  console.log(`Todas as ${MESSAGES_PER_USER} mensagens do Bob estão no ficheiro (nenhuma perdida numa escrita concorrente):`, bobMessages.length === MESSAGES_PER_USER);
  console.log(`O total na sala é exatamente ${MESSAGES_PER_USER * 2} (nenhuma duplicada nem perdida):`, roomMessages.length === MESSAGES_PER_USER * 2);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
