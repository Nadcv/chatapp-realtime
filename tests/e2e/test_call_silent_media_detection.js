// Um utilizador reportou que chamadas 1-para-1 (voz e vídeo) "ligam" (o ecrã
// mostra "Conectado ✅") mas ninguém ouve/vê nada dos dois lados — mesmo em
// redes diferentes ou na mesma Wi-Fi. Investigação: o ICE pode negociar e
// chegar a "connected" mesmo quando o relay TURN (o gratuito público usado
// por omissão, ver TURN_FALLBACK no server.js) começa a falhar/está
// sobrecarregado DEPOIS da negociação inicial — nenhum pacote real chega,
// mas nada no código anterior detetava isso: o indicador de sinal
// (classifyQuality) até mostrava "🟢 Sinal bom", porque 0 pacotes perdidos
// em 0 pacotes recebidos calculava 0% de perda.
//
// Este teste simula esse cenário exato (força getStats() a devolver sempre
// zero pacotes nos dois lados, mesmo com a ligação real de sinalização a
// funcionar) e confirma a correção: o indicador passa a mostrar "⚠️ Sem
// sinal" em vez de "🟢 Sinal bom", o estado da chamada avisa claramente, e
// quem ligou tenta mesmo recuperar a ligação (reenvia uma oferta ICE nova).
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

// Faz getStats() devolver sempre "zero pacotes recebidos, zero perdidos" —
// simula um relay TURN que deixou de encaminhar media a sério, mesmo com o
// ICE/sinalização a completar normalmente (candidate-pair "succeeded").
async function forceZeroMediaStats(page) {
  await page.evaluate(() => {
    RTCPeerConnection.prototype.getStats = async function () {
      return new Map([
        ['fakepair', { type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.05 }],
        ['fakeinbound', { type: 'inbound-rtp', isRemote: false, packetsReceived: 0, packetsLost: 0 }]
      ]);
    };
  });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });

  const a = await register(ctxA, 'Silent Media A', 'sma_');
  const b = await register(ctxB, 'Silent Media B', 'smb_');

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
  await a.page.click('.chat-item:has-text("Silent Media B")');
  await a.page.waitForTimeout(300);

  // Espia o socket.emit de A para confirmar que uma tentativa real de
  // recuperação (nova oferta ICE) é mesmo enviada, não só a mensagem no ecrã.
  await a.page.evaluate(() => {
    window.__emittedEvents = [];
    const origEmit = socket.emit.bind(socket);
    socket.emit = (event, ...args) => { window.__emittedEvents.push(event); return origEmit(event, ...args); };
  });

  await a.page.evaluate(() => startCall('voice'));
  await a.page.waitForTimeout(800);
  await b.page.evaluate(() => acceptIncomingCall());

  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 }).catch(() => {});
  await b.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 }).catch(() => {});

  // Só agora força as estatísticas falsas — depois de "Conectado", tal como
  // aconteceria com um relay que falha DEPOIS da negociação inicial.
  await forceZeroMediaStats(a.page);
  await forceZeroMediaStats(b.page);

  // 2 amostras a cada 4s = ~8s até o "streak" confirmar silêncio total.
  await a.page.waitForFunction(() => document.getElementById('callQuality').textContent.includes('Sem sinal'), { timeout: 12000 }).catch(() => {});
  await b.page.waitForTimeout(500);

  const aQuality = await a.page.evaluate(() => document.getElementById('callQuality').textContent);
  const bQuality = await b.page.evaluate(() => document.getElementById('callQuality').textContent);
  console.log('A indicador de sinal mostra "Sem sinal" (não "Sinal bom" enganador) quando 0 pacotes chegam:', aQuality.includes('Sem sinal'));
  console.log('B indicador de sinal também mostra "Sem sinal":', bQuality.includes('Sem sinal'));

  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('a tentar recuperar'), { timeout: 5000 }).catch(() => {});
  const aStatus = await a.page.evaluate(() => document.getElementById('callStatus').textContent);
  const bStatus = await b.page.evaluate(() => document.getElementById('callStatus').textContent);
  console.log('A (quem ligou) vê o aviso "Sem áudio/vídeo — a tentar recuperar":', aStatus.includes('a tentar recuperar'));
  console.log('B (quem recebeu) também vê o mesmo aviso:', bStatus.includes('a tentar recuperar'));

  const aTriedRestart = await a.page.evaluate(() => window.__emittedEvents.includes('renegotiate_offer'));
  console.log('A (quem ligou) tenta mesmo recuperar a ligação (envia uma nova oferta ICE):', aTriedRestart);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
