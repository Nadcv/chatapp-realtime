// Same "disconnected never actually recovers" bug/fix, but for group calls.
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
  return phone;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-web-security']
  });
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await register(a, 'Group Disc A', 'gdisca_');
  await register(b, 'Group Disc B', 'gdiscb_');

  const groupName = 'Grupo Disc Teste ' + Date.now();
  await a.evaluate((name) => { socket.emit('create_group', { name }); }, groupName);
  await a.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  await b.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  const groupId = await a.evaluate((name) => APP.groupsList.find(g => g.name === name).id, groupName);
  await b.evaluate((gid) => { APP.currentChatId = gid; socket.emit('join_room', { chatId: gid }); }, groupId);
  await a.evaluate((gid) => { APP.currentChatId = gid; socket.emit('join_room', { chatId: gid }); }, groupId);
  await a.waitForTimeout(300);

  // A joins first (existing participant), B joins second -> B is offerer to A.
  await a.evaluate(() => joinGroupCall('video'));
  await a.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  await b.evaluate(() => joinGroupCall('video'));
  await b.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  await a.waitForTimeout(1000);

  const aSocketId = await a.evaluate(() => socket.id);
  const bSocketId = await b.evaluate(() => socket.id);

  // Simulate B's connection to A going "disconnected".
  await b.evaluate((aId) => {
    const pc = GROUP_CALL.peers[aId];
    Object.defineProperty(pc, 'iceConnectionState', { get: () => 'disconnected', configurable: true });
    pc.oniceconnectionstatechange();
  }, aSocketId);

  await b.waitForTimeout(2000);
  const aStillStableAt2s = await a.evaluate((bId) => GROUP_CALL.peers[bId].signalingState === 'stable', bSocketId);
  console.log('Não dispara logo aos 2s (dá tempo de recuperar sozinho primeiro):', aStillStableAt2s);

  await b.waitForTimeout(3500);
  const aGotRealOffer = await a.evaluate((bId) => GROUP_CALL.peers[bId].remoteDescription?.type === 'offer', bSocketId);
  console.log('BUG CORRIGIDO (grupo): ao fim de ~5s ainda "disconnected", dispara uma renegociação REAL:', aGotRealOffer);
  const bBackToStable = await b.evaluate((aId) => GROUP_CALL.peers[aId].signalingState === 'stable', aSocketId);
  console.log('B volta a "stable" (prova que A respondeu de verdade):', bBackToStable);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
