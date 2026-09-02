// Confirms the improved guidance shows up for an Android user (not just
// iPhone, which was the only device with actionable steps before), for all
// three places a camera/mic permission denial can happen: 1-1 outgoing call,
// 1-1 incoming call (accept), and group call join. Reproduces exactly the
// "Erro ao aceder à câmara/microfone: Permission denied" reported live.
const { chromium } = require('playwright');

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

async function register(page, name, prefix) {
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  await page.fill('#regName', name);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', '+3515' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
}

async function stubDeniedPermission(page) {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ userAgent: ANDROID_UA });
  const page = await ctx.newPage();
  await register(page, 'Perm Test', 'permtest_');

  let dialogText = '';
  page.on('dialog', d => { dialogText = d.message(); d.accept(); });

  // --- 1-1 outgoing call (startCall) ---
  await page.evaluate(() => {
    APP.chats.push({ id: 'permdm1', type: 'user', name: 'Alguem', phone: '+351999999999' });
    APP.currentChatId = 'permdm1';
  });
  await stubDeniedPermission(page);
  await page.evaluate(() => startCall('video'));
  await page.waitForTimeout(300);
  console.log('1-para-1 (a ligar): mensagem menciona Chrome do Android:', dialogText.includes('Chrome do Android'));
  console.log('1-para-1 (a ligar): dá a dica de tocar no cadeado/permissões:', dialogText.includes('🔒') && dialogText.includes('Permissões'));

  // --- 1-1 incoming call (acceptIncomingCall) ---
  dialogText = '';
  await page.evaluate(() => {
    incomingCallData = { targetRoomId: 'permdm1', callerPhone: '+351999999999', callerName: 'Alguem', callType: 'video', offer: { type: 'offer', sdp: 'v=0' } };
  });
  await page.evaluate(() => acceptIncomingCall());
  await page.waitForTimeout(300);
  console.log('1-para-1 (a atender): mensagem menciona Chrome do Android:', dialogText.includes('Chrome do Android'));

  // --- Group call join ---
  dialogText = '';
  await page.evaluate(() => {
    APP.chats.push({ id: 'permgroup1', type: 'group', name: 'Grupo Perm' });
    APP.currentChatId = 'permgroup1';
  });
  await page.evaluate(() => joinGroupCall('video'));
  await page.waitForTimeout(300);
  console.log('Chamada em grupo: mensagem menciona Chrome do Android:', dialogText.includes('Chrome do Android'));

  // --- Sanity: a genuinely different error (no camera found) gets DIFFERENT guidance, not the permissions one ---
  dialogText = '';
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no camera', 'NotFoundError'));
  });
  await page.evaluate(() => startCall('video'));
  await page.waitForTimeout(300);
  console.log('Erro diferente (sem câmara) NÃO mostra a dica de permissões, mostra a dica certa:', dialogText.includes('Não foi encontrada nenhuma câmara') && !dialogText.includes('Permissões'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
