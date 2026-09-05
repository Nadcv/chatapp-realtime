// A "partilha de vídeo" numa chamada (assistir um vídeo/URL em conjunto)
// usava HTMLVideoElement.captureStream() para transmitir — o Safari (em
// TODAS as versões, incluindo iOS) nunca implementou esse método, e por
// isso a função simplesmente recusava com um alerta, mesmo achando (por
// engano do utilizador) que era "o ecrã" que faltava permitir partilhar.
// A correção (ver getSharedVideoStream em index.html) desenha os frames do
// vídeo num <canvas> próprio e captura ESSE canvas via canvas.captureStream()
// — que o Safari suporta — sem depender de captura de ecrã nenhuma (isso
// continua mesmo impossível no Safari iOS, por não implementarem
// getDisplayMedia(); não é isto que este teste tenta resolver).
//
// Este teste simula o Safari (remove captureStream/mozCaptureStream do
// protótipo de <video>, ANTES da app carregar) e confirma: nenhum alerta
// bloqueia a partilha, o vídeo continua a chegar de verdade ao OUTRO lado
// da chamada (frames reais, com dimensões > 0), e parar a partilha limpa
// mesmo o loop de desenho (sem o qual ficaria a desenhar para sempre).
const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
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

// Gera um pequeno vídeo real (poucos frames, canvas com uma cor a mudar)
// inteiramente no browser, via MediaRecorder — evita depender de nenhum
// ficheiro de vídeo externo/fixture.
async function generateTestVideoObjectUrl(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 120;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(10);
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    let frame = 0;
    const drawInterval = setInterval(() => {
      ctx.fillStyle = frame % 2 === 0 ? '#ff0000' : '#00ff00';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      frame++;
    }, 100);
    await new Promise((r) => setTimeout(r, 600));
    clearInterval(drawInterval);
    recorder.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    return URL.createObjectURL(blob);
  });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });

  // Simula o Safari em A (quem vai partilhar o vídeo) — remove os dois
  // métodos ANTES de qualquer script da página correr, tal como aconteceria
  // de verdade num navegador que nunca os implementou.
  await ctxA.addInitScript(() => {
    // captureStream()/mozCaptureStream() são herdados de HTMLMediaElement.prototype
    // (partilhado entre <video> e <audio>), não definidos diretamente em
    // HTMLVideoElement.prototype — apagar do sítio errado não removeria nada.
    delete HTMLMediaElement.prototype.captureStream;
    delete HTMLMediaElement.prototype.mozCaptureStream;
  });

  const a = await register(ctxA, 'Video Share Safari A', 'vssa_');
  const b = await register(ctxB, 'Video Share Safari B', 'vssb_');

  const usernameB = await b.page.evaluate(() => APP.user.username);
  await a.page.evaluate((uname) => {
    document.getElementById('modalSearchUser').classList.add('active');
    document.getElementById('searchUsernameInput').value = uname;
  }, usernameB);
  await a.page.evaluate(() => doSearchUser());
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => {
    const btn = [...document.querySelectorAll('#searchUserResult button')].find(b => b.textContent.includes('conversa'));
    if (btn) btn.click();
  });
  await a.page.waitForTimeout(500);
  await a.page.click('.chat-item:has-text("Video Share Safari B")');
  await a.page.waitForTimeout(300);

  const captureStreamMissing = await a.page.evaluate(() => !document.createElement('video').captureStream);
  console.log('Simulação do Safari em A: <video>.captureStream não existe:', captureStreamMissing);

  await a.page.evaluate(() => startCall('video'));
  await a.page.waitForTimeout(800);
  await b.page.evaluate(() => acceptIncomingCall());
  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 }).catch(() => {});
  await b.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 }).catch(() => {});

  const dialogs = [];
  a.page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

  const objectUrl = await generateTestVideoObjectUrl(a.page);
  await a.page.evaluate((url) => playSharedVideo(url), objectUrl);
  await a.page.waitForFunction(() => APP.videoShare.active === true, { timeout: 8000 }).catch(() => {});

  const noBlockingAlert = dialogs.length === 0;
  console.log('Nenhum alerta bloqueia a partilha no Safari (usa o canvas em vez de recusar):', noBlockingAlert);

  const shareActive = await a.page.evaluate(() => APP.videoShare.active === true);
  console.log('A partilha de vídeo fica ativa mesmo sem captureStream no <video>:', shareActive);

  // A prova real: o vídeo tem mesmo de chegar a B com frames reais (dimensões
  // > 0), não só a app achar que está "ativa" no lado de quem partilha.
  await b.page.waitForFunction(() => document.getElementById('mainVideo').videoWidth > 0, { timeout: 8000 }).catch(() => {});
  const bReceivesRealFrames = await b.page.evaluate(() => document.getElementById('mainVideo').videoWidth > 0 && document.getElementById('mainVideo').videoHeight > 0);
  console.log('B recebe frames reais do vídeo partilhado por A (via canvas no Safari):', bReceivesRealFrames);

  await a.page.evaluate(() => stopVideoShare());
  await a.page.waitForTimeout(300);
  const captureStoppedAfterEnd = await a.page.evaluate(() => APP.videoShare.stream === null && APP.videoShare.stopCapture === null);
  console.log('Parar a partilha limpa a stream/loop de desenho (não fica a correr para sempre):', captureStoppedAfterEnd);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
