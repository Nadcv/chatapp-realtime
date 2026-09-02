// Verifies the per-peer disconnect-recovery timers don't cross-fire in a
// group call with 3+ participants — only the peer connection that actually
// went "disconnected" should get a real restart; the healthy one must stay
// untouched (no wasted/incorrect renegotiation on an unrelated peer).
const { chromium } = require('playwright');

async function register(page, name, prefix) {
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3513' + ts.toString().slice(-8);
  await page.fill('#regName', name);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-web-security']
  });
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxC = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const c = await ctxC.newPage();
  await register(a, 'Multi Disc A', 'mdisca_');
  await register(b, 'Multi Disc B', 'mdiscb_');
  await register(c, 'Multi Disc C', 'mdiscc_');

  const groupName = 'Grupo Multi Disc ' + Date.now();
  await a.evaluate((name) => { socket.emit('create_group', { name }); }, groupName);
  await a.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  await b.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  await c.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  const groupId = await a.evaluate((name) => APP.groupsList.find(g => g.name === name).id, groupName);
  for (const p of [a, b, c]) {
    await p.evaluate((gid) => { APP.currentChatId = gid; socket.emit('join_room', { chatId: gid }); }, groupId);
  }
  await a.waitForTimeout(300);

  // A joins first, then B, then C — so B and C are both offerers toward A
  // (existing_call_participants path), and A is answerer to both.
  await a.evaluate(() => joinGroupCall('video'));
  await a.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  await b.evaluate(() => joinGroupCall('video'));
  await b.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  await c.evaluate(() => joinGroupCall('video'));
  await c.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  await a.waitForTimeout(1500);

  const aSocketId = await a.evaluate(() => socket.id);
  const bSocketId = await b.evaluate(() => socket.id);
  const cSocketId = await c.evaluate(() => socket.id);

  // Only B's connection to A goes "disconnected" — C's connection to A stays healthy.
  await b.evaluate((aId) => {
    const pc = GROUP_CALL.peers[aId];
    Object.defineProperty(pc, 'iceConnectionState', { get: () => 'disconnected', configurable: true });
    pc.oniceconnectionstatechange();
  }, aSocketId);

  await b.waitForTimeout(5500);

  const aGotOfferFromB = await a.evaluate((bId) => GROUP_CALL.peers[bId].remoteDescription?.type === 'offer', bSocketId);
  console.log('A ligação B->A (que ficou "disconnected") recebe a renegociação real:', aGotOfferFromB);

  const cLinkUntouched = await c.evaluate((aId) => {
    const pc = GROUP_CALL.peers[aId];
    return pc.signalingState === 'stable' && pc.iceConnectionState !== 'disconnected';
  }, aSocketId);
  console.log('A ligação C->A (que nunca ficou "disconnected") NÃO é afetada:', cLinkUntouched);

  const aLinkToUntouched = await a.evaluate((cId) => GROUP_CALL.peers[cId].signalingState === 'stable', cSocketId);
  console.log('Do lado de A, a ligação com C continua "stable" (sem renegociação desnecessária):', aLinkToUntouched);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
