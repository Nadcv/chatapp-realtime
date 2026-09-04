// Sala de áudio ao vivo (tipo Clubhouse/Spaces) — construída em cima da
// chamada de grupo em malha já existente (mesmo padrão de setup usado em
// test_ice_restart_group.js: dispositivos de media falsos, grupo real criado
// por socket direto, chamadas de função diretas via evaluate para maior
// fiabilidade do que cliques na UI). O que testamos aqui é específico desta
// funcionalidade: quem entra primeiro é anfitrião (fala já), quem entra a
// seguir começa silenciado ("ouvinte"), só fala depois de "levantar a mão"
// e o anfitrião aprovar — e o servidor impede qualquer participante de se
// auto-aprovar ou de silenciar outros sem ser mesmo o anfitrião.
const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3519' + ts.toString().slice(-8);
  await page.fill('#regName', name);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-web-security']
  });
  const ctxA = await browser.newContext({ permissions: ['microphone'] });
  const ctxB = await browser.newContext({ permissions: ['microphone'] });
  const ctxC = await browser.newContext({ permissions: ['microphone'] });
  const a = await register(ctxA, 'Audio Room Host', 'aroom_a_');
  const b = await register(ctxB, 'Audio Room Listener', 'aroom_b_');
  const c = await register(ctxC, 'Audio Room Third', 'aroom_c_');

  const groupName = 'Sala de Audio Teste ' + Date.now();
  await a.page.evaluate((name) => { socket.emit('create_group', { name }); }, groupName);
  await a.page.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  await b.page.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  await c.page.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  const groupId = await a.page.evaluate((name) => APP.groupsList.find(g => g.name === name).id, groupName);
  for (const p of [a.page, b.page, c.page]) {
    await p.evaluate((gid) => { APP.currentChatId = gid; socket.emit('join_room', { chatId: gid }); }, groupId);
  }
  await a.page.waitForTimeout(300);

  // --- A entra primeiro na sala de áudio — torna-se anfitrião. ---
  await a.page.evaluate(() => startAudioRoom());
  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  const aIsHost = await a.page.evaluate(() => GROUP_CALL.isHost);
  console.log('Quem entra primeiro na sala torna-se anfitrião:', aIsHost === true);
  const aMuteBtnVisible = await a.page.evaluate(() => getComputedStyle(document.getElementById('callMuteBtn')).display !== 'none');
  console.log('O anfitrião vê o botão de silenciar normal:', aMuteBtnVisible);

  // --- B entra a seguir — deve começar "ouvinte" (silenciado). ---
  await b.page.evaluate(() => startAudioRoom());
  await b.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  await a.page.waitForTimeout(1000);
  const bIsHost = await b.page.evaluate(() => GROUP_CALL.isHost);
  console.log('Quem entra a seguir NÃO é anfitrião:', bIsHost === false);
  const bStartsMuted = await b.page.evaluate(() => APP.isMuted === true && APP.callStream.getAudioTracks().every(t => t.enabled === false));
  console.log('Quem entra a seguir começa silenciado ("ouvinte"):', bStartsMuted);
  const bSeesRaiseHandBtn = await b.page.evaluate(() => getComputedStyle(document.getElementById('audioRoomRaiseHandBtn')).display !== 'none');
  const bMuteBtnHidden = await b.page.evaluate(() => getComputedStyle(document.getElementById('callMuteBtn')).display === 'none');
  console.log('Um ouvinte vê o botão "Pedir para falar" e NÃO vê o botão de silenciar normal:', bSeesRaiseHandBtn && bMuteBtnHidden);

  const aSocketId = await a.page.evaluate(() => socket.id);
  const bSocketId = await b.page.evaluate(() => socket.id);

  // --- B levanta a mão — A vê o pedido. ---
  await b.page.evaluate(() => raiseHandToSpeak());
  await a.page.waitForTimeout(400);
  const aSeesRaisedHand = await a.page.evaluate((bId) => GROUP_CALL.raisedHands[bId] === 'Audio Room Listener', bSocketId);
  console.log('O anfitrião recebe o pedido de "levantar a mão" de B:', aSeesRaisedHand);
  const aListShowsApprove = await a.page.evaluate(() => document.getElementById('audioRoomRaisedHandsList').innerHTML.includes('grantSpeak'));
  console.log('A lista do anfitrião mostra um botão para aprovar:', aListShowsApprove);

  // --- A aprova — B passa a poder falar (sem re-negociação, só destrava a faixa já existente). ---
  await a.page.evaluate((bId) => grantSpeak(bId), bSocketId);
  await b.page.waitForTimeout(400);
  const bCanSpeakNow = await b.page.evaluate(() => APP.isMuted === false && APP.callStream.getAudioTracks().every(t => t.enabled === true));
  console.log('Depois de aprovado, B já pode falar (faixa de áudio ativa):', bCanSpeakNow);
  const bSeesSelfMuteBtn = await b.page.evaluate(() => getComputedStyle(document.getElementById('audioRoomSelfMuteBtn')).display !== 'none');
  console.log('B passa a ver o botão "Silenciar-me outra vez":', bSeesSelfMuteBtn);

  // --- A silencia B remotamente. ---
  await a.page.evaluate((bId) => revokeSpeak(bId), bSocketId);
  await b.page.waitForTimeout(400);
  const bMutedAgain = await b.page.evaluate(() => APP.isMuted === true && APP.callStream.getAudioTracks().every(t => t.enabled === false));
  console.log('O anfitrião consegue silenciar B remotamente:', bMutedAgain);

  // --- Segurança: B (não anfitrião) tenta aprovar-se a si próprio diretamente por socket — o servidor recusa. ---
  await b.page.evaluate((bId) => { socket.emit('audio_room_grant_speak', { roomId: APP.currentChatId, targetSocketId: bId }); }, bSocketId);
  await b.page.waitForTimeout(400);
  const bStillMutedAfterSelfGrantAttempt = await b.page.evaluate(() => APP.isMuted === true);
  console.log('Um participante comum NÃO consegue aprovar-se a si próprio (só o anfitrião pode):', bStillMutedAfterSelfGrantAttempt);

  // --- C entra também, depois A (o anfitrião original) sai — B (o mais antigo a seguir) deve ser promovido. ---
  await c.page.evaluate(() => startAudioRoom());
  await c.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => endCall());
  await b.page.waitForTimeout(600);
  const bPromotedToHost = await b.page.evaluate(() => GROUP_CALL.isHost === true);
  console.log('Quando o anfitrião original sai, o participante mais antigo é promovido a anfitrião:', bPromotedToHost);
  const cNotHost = await c.page.evaluate(() => GROUP_CALL.isHost === false);
  console.log('Quem entrou por último não é promovido (fica ouvinte):', cNotHost);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
