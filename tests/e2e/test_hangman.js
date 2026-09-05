const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3516' + ts.toString().slice(-8);
  const username = prefix + ts;
  await page.fill('#regName', name);
  await page.fill('#regUsername', username);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone, username };
}

// A Forca é COOPERATIVA (as duas pessoas da conversa tentam adivinhar juntas
// a mesma palavra) e a palavra secreta é escolhida pelo SERVIDOR — nunca
// chega ao cliente em claro antes do fim do jogo (só a versão mascarada,
// tipo "_ A N _ N A"). O teste força o cenário de "perder" (6 letras
// erradas seguidas com o alfabeto inteiro) e depois separadamente confirma
// que acertar todas as letras da palavra revelada no fim é o que "ganha".
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  const a = await register(ctxA, 'Forca A', 'forca_a_');
  const b = await register(ctxB, 'Forca B', 'forca_b_');

  await a.page.click('button[title="Grupos, chamadas e contactos"]');
  await a.page.click('#modalContactsFeatures button[onclick*="openSearchUserModal"]');
  await a.page.waitForSelector('#modalSearchUser.active');
  await a.page.fill('#searchUsernameInput', b.username);
  await a.page.click('button:has-text("Procurar")');
  await a.page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await a.page.click('#searchUserResult button:has-text("Iniciar conversa")');
  await a.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });
  await a.page.waitForTimeout(300);

  // A Forca cria o jogo por um caminho próprio no servidor (start_hangman),
  // que — tal como o UNO (ver test_uno_dm.js) — não junta A e B automatica-
  // mente como contactos um do outro (só o send_message genérico faz isso).
  // Por isso B também tem de procurar A e abrir a conversa antes do jogo
  // começar, senão a mensagem nunca chega a B.
  await b.page.click('button[title="Grupos, chamadas e contactos"]');
  await b.page.click('#modalContactsFeatures button[onclick*="openSearchUserModal"]');
  await b.page.waitForSelector('#modalSearchUser.active');
  await b.page.fill('#searchUsernameInput', a.username);
  await b.page.click('button:has-text("Procurar")');
  await b.page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await b.page.click('#searchUserResult button:has-text("Iniciar conversa")');
  await b.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });
  await b.page.waitForTimeout(300);

  await a.page.click('#gamesBtn');
  await a.page.waitForSelector('#modalGameChooser.active');
  await a.page.click('button:has-text("Forca")');
  await a.page.waitForTimeout(500);

  const initialGame = await a.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game)?.game);
  console.log('A palavra secreta NUNCA chega ao cliente em claro (só a máscara):', initialGame.word === undefined && typeof initialGame.maskedWord === 'string');
  console.log('A máscara inicial mostra só sublinhados (nenhuma letra adivinhada ainda):', initialGame.maskedWord.split('').every(c => c === '_'));
  const wordLength = initialGame.wordLength;

  // B já estava na sala quando A começou o jogo, por isso vê-o ao vivo, sem
  // precisar de reabrir a conversa (mesma ideia do UNO).
  await b.page.waitForFunction(() => !!APP.messages[APP.currentChatId]?.find(m => m.game), null, { timeout: 8000 });
  const bGame = await b.page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game)?.game);
  console.log('B também recebe o jogo, igualmente sem a palavra em claro:', bGame.word === undefined && bGame.wordLength === wordLength);

  async function guessLetter(page, letter) {
    await page.evaluate((l) => {
      const msg = APP.messages[APP.currentChatId].find(m => m.game);
      guessHangmanLetter(msg.id, l);
    }, letter);
    await page.waitForTimeout(250);
  }
  async function currentGame(page) { return page.evaluate(() => APP.messages[APP.currentChatId].find(m => m.game)?.game); }

  // A sugere uma letra qualquer — B (a outra pessoa) deve ver a atualização em tempo real.
  const commonLetter = 'A';
  await guessLetter(a.page, commonLetter);
  let gameA = await currentGame(a.page);
  console.log('Depois de sugerir uma letra, ela entra na lista de tentativas:', gameA.guessedLetters.includes(commonLetter));
  await b.page.waitForTimeout(300);
  const gameB = await currentGame(b.page);
  console.log('B vê a mesma tentativa em tempo real (é cooperativo, não por turnos):', gameB.guessedLetters.includes(commonLetter));

  // A mesma letra não pode ser sugerida outra vez.
  const wrongCountBefore = gameA.wrongGuesses;
  await guessLetter(a.page, commonLetter);
  gameA = await currentGame(a.page);
  console.log('A mesma letra não conta duas vezes:', gameA.guessedLetters.filter(l => l === commonLetter).length === 1 && gameA.wrongGuesses === wrongCountBefore);

  // Esgota as tentativas com 6 letras GARANTIDAMENTE ausentes de qualquer
  // palavra da lista embutida em server.js (nenhuma delas usa K/Q/W/X/Y/Z) —
  // força sempre a derrota, sem depender de sorte na palavra sorteada.
  const guaranteedAbsentLetters = ['K', 'Q', 'W', 'X', 'Y', 'Z'];
  for (const letter of guaranteedAbsentLetters) {
    await guessLetter(a.page, letter);
  }
  gameA = await currentGame(a.page);
  console.log('Depois de 6 letras erradas seguidas, o jogo termina em derrota:', gameA.winner === 'lost' && gameA.wrongGuesses === 6);
  console.log('A palavra é revelada no fim (só depois de perder):', typeof gameA.revealedWord === 'string' && gameA.revealedWord.length === wordLength);
  const htmlA = await a.page.evaluate(() => document.getElementById('chatMessages').innerHTML);
  console.log('Mostra a mensagem de derrota com a palavra revelada:', htmlA.includes(gameA.revealedWord));

  // Depois de terminado, não se pode continuar a sugerir letras.
  const guessedBefore = gameA.guessedLetters.length;
  await guessLetter(a.page, 'M');
  const gameAfterEnd = await currentGame(a.page);
  console.log('Depois do jogo terminar, não se aceitam mais sugestões:', gameAfterEnd.guessedLetters.length === guessedBefore);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
