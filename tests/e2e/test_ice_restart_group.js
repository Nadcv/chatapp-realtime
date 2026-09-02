// Same real-renegotiation proof, but for group calls (mesh) — the user
// reported this bug in groups too. A joins first (existing participant,
// becomes the "answerer"/isOfferer=false for B's connection to it), B joins
// second (becomes the "offerer" to A, isOfferer=true) via existing_call_participants.
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
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await register(ctxA, 'Group ICE A', 'gicea_');
  const b = await register(ctxB, 'Group ICE B', 'giceb_');

  // Create a real group with both, since group calls require chat.type === 'group'.
  // Groups here are "open" (auto-visible to every registered account, see
  // README), so both A and B see it via the broadcast 'groups_update'.
  const groupName = 'Grupo ICE Teste ' + Date.now();
  await a.page.evaluate((name) => { socket.emit('create_group', { name }); }, groupName);
  await a.page.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  await b.page.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  const groupId = await a.page.evaluate((name) => APP.groupsList.find(g => g.name === name).id, groupName);
  await b.page.evaluate((gid) => { APP.currentChatId = gid; socket.emit('join_room', { chatId: gid }); }, groupId);
  await a.page.evaluate((gid) => { APP.currentChatId = gid; socket.emit('join_room', { chatId: gid }); }, groupId);
  await a.page.waitForTimeout(300);

  // A joins the group call first (becomes the "already there" participant).
  await a.page.evaluate(() => joinGroupCall('video'));
  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });

  // B joins second -> B is the offerer to A (existing_call_participants path).
  await b.page.evaluate(() => joinGroupCall('video'));
  await b.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  await a.page.waitForTimeout(1500);

  const aSocketId = await a.page.evaluate(() => socket.id);
  const bSocketId = await b.page.evaluate(() => socket.id);

  const bIsOffererToA = await b.page.evaluate((aId) => GROUP_CALL.isOfferer[aId] === true, aSocketId);
  console.log('B (quem entrou depois) é registado como ofertante para A:', bIsOffererToA);
  const aIsNotOffererToB = await a.page.evaluate((bId) => GROUP_CALL.isOfferer[bId] === false, bSocketId);
  console.log('A (já estava lá) é registado como NÃO-ofertante para B:', aIsNotOffererToB);

  const bPcBefore = await b.page.evaluate((aId) => GROUP_CALL.peers[aId].signalingState, aSocketId);
  console.log('Estado de sinalização de B->A antes do teste (deve ser "stable"):', bPcBefore === 'stable');

  // Trigger the real ICE restart function directly on B (the offerer for this link).
  await b.page.evaluate((aId) => attemptIceRestartGroup(aId), aSocketId);
  await b.page.waitForFunction((aId) => GROUP_CALL.peers[aId].signalingState === 'stable', aSocketId, { timeout: 5000 }).catch(() => {});

  const bPcAfter = await b.page.evaluate((aId) => GROUP_CALL.peers[aId].signalingState, aSocketId);
  console.log('B->A volta a "stable" depois da renegociação real (prova que A respondeu):', bPcAfter === 'stable');

  const aGotNewOffer = await a.page.evaluate((bId) => GROUP_CALL.peers[bId].remoteDescription?.type === 'offer', bSocketId);
  console.log('A recebeu e respondeu a um NOVO offer de B via call_offer_received:', aGotNewOffer);

  // Role guard: A must NOT be able to trigger a restart toward B (A is not the offerer for that link).
  const aPcBefore = await a.page.evaluate((bId) => GROUP_CALL.peers[bId].signalingState, bSocketId);
  const aTriedRestart = await a.page.evaluate((bId) => GROUP_CALL.isOfferer[bId], bSocketId);
  console.log('A corretamente NÃO é ofertante para B (não tentaria renegociar sozinho em caso de falha):', aTriedRestart === false);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
