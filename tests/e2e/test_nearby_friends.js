const { chromium } = require('playwright');

// "Amigos por perto" só mostra contactos MÚTUOS (as duas contas já se têm
// uma à outra — exige uma mensagem trocada, não só "Iniciar conversa" de um
// lado) que TAMBÉM tenham isto ativado, dentro de um raio curto, e só a
// distância aproximada — nunca as coordenadas de outra pessoa chegam ao
// cliente. Usa context.setGeolocation() do Playwright para simular posições
// GPS diferentes sem hardware nenhum.
async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3517' + ts.toString().slice(-8);
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

// Lisboa (Praça do Comércio) como base — deslocamentos pequenos em graus de
// latitude/longitude para simular "perto" (~500 m) e "longe" (~50 km).
const BASE = { latitude: 38.7071, longitude: -9.1355 };
const NEAR = { latitude: 38.7116, longitude: -9.1355 }; // ~500 m a norte
const FAR = { latitude: 39.1600, longitude: -9.1355 }; // ~50 km a norte

async function openAndActivateNearby(page, coords) {
  await page.context().setGeolocation(coords);
  await page.click('button[title="Grupos, chamadas e contactos"]');
  await page.waitForSelector('#modalContactsFeatures.active');
  await page.click('#modalContactsFeatures button:has-text("Amigos por perto")');
  await page.waitForSelector('#modalNearbyFriends.active');
  await page.check('#nearbyToggle');
  await page.waitForTimeout(600);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await browser.newContext({ permissions: ['geolocation'], geolocation: BASE });
  const ctxB = await browser.newContext({ permissions: ['geolocation'], geolocation: NEAR });
  const ctxC = await browser.newContext({ permissions: ['geolocation'], geolocation: NEAR });

  const a = await register(ctxA, 'Nearby A', 'nearby_a_');
  const b = await register(ctxB, 'Nearby B', 'nearby_b_');
  const c = await register(ctxC, 'Nearby C', 'nearby_c_');

  // A e B tornam-se contactos MÚTUOS: A procura B e inicia, depois manda uma
  // mensagem a sério (só aí é que B também ganha A como contacto — ver
  // comentário no server.js sobre add_contact vs. reciprocidade em send_message).
  await a.page.click('button[title="Grupos, chamadas e contactos"]');
  await a.page.click('#modalContactsFeatures button[onclick*="openSearchUserModal"]');
  await a.page.waitForSelector('#modalSearchUser.active');
  await a.page.fill('#searchUsernameInput', b.username);
  await a.page.click('button:has-text("Procurar")');
  await a.page.waitForSelector('#searchUserResult button:has-text("Iniciar conversa")', { timeout: 8000 });
  await a.page.click('#searchUserResult button:has-text("Iniciar conversa")');
  await a.page.waitForFunction(() => APP.currentChatId && APP.currentChatId.startsWith('dm_'), null, { timeout: 8000 });
  await a.page.fill('#messageInput', 'olá, para ficarmos contactos');
  await a.page.press('#messageInput', 'Enter');
  await a.page.waitForTimeout(400);

  // --- Ainda sem ninguém ativado, A não vê nenhum amigo por perto ---
  await openAndActivateNearby(a.page, BASE);
  const emptyBeforeB = await a.page.evaluate(() => document.getElementById('nearbyFriendsList').textContent.includes('Nenhum amigo por perto'));
  console.log('Sem mais ninguém ativado, a lista começa vazia:', emptyBeforeB);

  // --- B (contacto mútuo) ativa perto de A: deve aparecer ---
  await openAndActivateNearby(b.page, NEAR);
  await a.page.evaluate(() => socket.emit('nearby_request'));
  await a.page.waitForTimeout(600);
  const seesB = await a.page.evaluate(() => document.getElementById('nearbyFriendsList').textContent.includes('Nearby B'));
  console.log('A vê B (contacto mútuo, perto, ambos ativados):', seesB);
  const showsApproxDistance = await a.page.evaluate(() => /\d+(\.\d+)?\s?(m|km)/.test(document.getElementById('nearbyFriendsList').textContent));
  console.log('Mostra uma distância aproximada (não coordenadas):', showsApproxDistance);
  const neverLeaksCoords = await a.page.evaluate(() => !/-?\d+\.\d{4,}/.test(document.getElementById('nearbyFriendsList').innerHTML));
  console.log('Nunca mostra coordenadas GPS na interface (só a distância):', neverLeaksCoords);

  // --- C (perto fisicamente, mas NUNCA falou com A — não é contacto mútuo) não deve aparecer ---
  await openAndActivateNearby(c.page, NEAR);
  await a.page.evaluate(() => socket.emit('nearby_request'));
  await a.page.waitForTimeout(600);
  const neverSeesC = await a.page.evaluate(() => !document.getElementById('nearbyFriendsList').textContent.includes('Nearby C'));
  console.log('C (perto mas sem ser contacto mútuo) NUNCA aparece:', neverSeesC);

  // --- B move-se para longe (fora do raio): deixa de aparecer. Para o GPS
  // simulado (watchPosition) e emite manualmente a posição — controla o
  // timing com precisão em vez de depender de quando o navegador decide
  // reavisar o watcher com a nova posição emulada. ---
  await b.page.evaluate(() => { if (NEARBY.watchId != null) navigator.geolocation.clearWatch(NEARBY.watchId); });
  await ctxB.setGeolocation(FAR);
  await b.page.evaluate(() => socket.emit('nearby_update', { lat: 39.1600, lng: -9.1355 }));
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => socket.emit('nearby_request'));
  await a.page.waitForTimeout(600);
  const disappearsWhenFar = await a.page.evaluate(() => !document.getElementById('nearbyFriendsList').textContent.includes('Nearby B'));
  console.log('B desaparece da lista quando fica fora do raio (~50 km):', disappearsWhenFar);

  // --- B volta para perto e depois DESATIVA — A não deve mais vê-lo ---
  await ctxB.setGeolocation(NEAR);
  await b.page.evaluate(() => socket.emit('nearby_update', { lat: 38.7116, lng: -9.1355 }));
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => socket.emit('nearby_request'));
  await a.page.waitForTimeout(600);
  const seesBAgain = await a.page.evaluate(() => document.getElementById('nearbyFriendsList').textContent.includes('Nearby B'));
  console.log('B volta a aparecer quando está perto de novo:', seesBAgain);

  await b.page.uncheck('#nearbyToggle');
  await a.page.waitForTimeout(400);
  await a.page.evaluate(() => socket.emit('nearby_request'));
  await a.page.waitForTimeout(500);
  const goneAfterOptOut = await a.page.evaluate(() => !document.getElementById('nearbyFriendsList').textContent.includes('Nearby B'));
  console.log('B desaparece assim que desativa "Amigos por perto":', goneAfterOptOut);

  // --- Se o próprio A desativar, a sua lista também limpa ---
  await a.page.uncheck('#nearbyToggle');
  await a.page.waitForTimeout(300);
  const clearedForA = await a.page.evaluate(() => document.getElementById('nearbyFriendsList').textContent.includes('Ativa para veres'));
  console.log('Ao desativar, A volta ao estado "por ativar":', clearedForA);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
