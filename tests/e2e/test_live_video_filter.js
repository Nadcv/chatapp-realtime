// Filtros de vídeo ao vivo em chamadas — diferente do "tirar self" (só fotos
// paradas), aqui cada frame do vídeo da própria chamada é desenhado num
// <canvas> escondido com um filtro CSS (mesma lista do "tirar self") e a
// faixa capturada substitui a que está a ser ENVIADA (mesmo mecanismo já
// usado por "Compartilhar vídeo/tela", getActiveSenders) — por isso chega
// filtrado a quem está do outro lado, não é só um efeito visual local.
// Mesmo setup de dispositivos de media falsos e chamadas de função diretas
// via evaluate já usado em test_ice_restart_group.js / test_audio_room.js.
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
  const a = await register(ctxA, 'Filter Test A', 'vfilt_a_');
  const b = await register(ctxB, 'Filter Test B', 'vfilt_b_');

  const groupName = 'Grupo Filtro Video ' + Date.now();
  await a.page.evaluate((name) => { socket.emit('create_group', { name }); }, groupName);
  await a.page.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  await b.page.waitForFunction((name) => APP.groupsList.some(g => g.name === name), groupName, { timeout: 5000 });
  const groupId = await a.page.evaluate((name) => APP.groupsList.find(g => g.name === name).id, groupName);
  for (const p of [a.page, b.page]) {
    await p.evaluate((gid) => { APP.currentChatId = gid; socket.emit('join_room', { chatId: gid }); }, groupId);
  }
  await a.page.waitForTimeout(300);

  // --- A entra numa videochamada de grupo — o botão de filtro deve aparecer. ---
  await a.page.evaluate(() => joinGroupCall('video'));
  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  const filterBtnVisibleForVideo = await a.page.evaluate(() => getComputedStyle(document.getElementById('callFilterBtn')).display !== 'none');
  console.log('O botão de filtro aparece numa videochamada:', filterBtnVisibleForVideo);

  // --- A aplica um filtro — a faixa ENVIADA (não só a pré-visualização local) muda. ---
  const rawTrackId = await a.page.evaluate(() => APP.callStream.getVideoTracks()[0].id);
  await a.page.evaluate(() => setLiveVideoFilter('bw'));
  await a.page.waitForTimeout(300);
  const localPreviewFilterApplied = await a.page.evaluate(() => document.getElementById('pipVideo').style.filter.includes('grayscale'));
  console.log('A pré-visualização local reflete o filtro escolhido:', localPreviewFilterApplied);
  const canvasCreated = await a.page.evaluate(() => !!LIVE_FILTER.canvas && !!LIVE_FILTER.filteredTrack);
  console.log('É criado um canvas de processamento com uma faixa de vídeo filtrada:', canvasCreated);

  // --- B entra na chamada DEPOIS do filtro já estar ativo — deve receber já filtrado desde o início. ---
  await b.page.evaluate(() => joinGroupCall('video'));
  await b.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  await a.page.waitForTimeout(1000);
  const bSocketId = await b.page.evaluate(() => socket.id);
  const newPeerGotFilteredTrack = await a.page.evaluate((bId) => {
    const sender = GROUP_CALL.peers[bId]?.getSenders().find(s => s.track && s.track.kind === 'video');
    return !!sender && sender.track === LIVE_FILTER.filteredTrack;
  }, bSocketId);
  console.log('Quem entra a meio de um filtro já ativo recebe logo a versão filtrada (sem precisar de reaplicar):', newPeerGotFilteredTrack);

  const sentTrackDiffersFromRawCamera = await a.page.evaluate(({ rawId, bId }) => {
    const sender = GROUP_CALL.peers[bId]?.getSenders().find(s => s.track && s.track.kind === 'video');
    return !!sender && sender.track.id !== rawId;
  }, { rawId: rawTrackId, bId: bSocketId });
  console.log('A faixa realmente enviada já não é a câmara crua (mudou de identidade):', sentTrackDiffersFromRawCamera);

  // --- Voltar a "Normal" restaura a faixa crua da câmara em todas as ligações ativas. ---
  await a.page.evaluate(() => setLiveVideoFilter('none'));
  await a.page.waitForTimeout(300);
  const revertedToRawTrack = await a.page.evaluate(({ rawId, bId }) => {
    const sender = GROUP_CALL.peers[bId]?.getSenders().find(s => s.track && s.track.kind === 'video');
    return sender && sender.track.id === rawId;
  }, { rawId: rawTrackId, bId: bSocketId });
  console.log('Escolher "Normal" restaura a faixa crua da câmara na ligação já existente:', revertedToRawTrack);
  const processingStoppedAfterNone = await a.page.evaluate(() => LIVE_FILTER.canvas === null && LIVE_FILTER.rafId === null);
  console.log('O processamento por canvas para de correr depois de voltar a "Normal" (poupa CPU/bateria):', processingStoppedAfterNone);
  const localPreviewFilterCleared = await a.page.evaluate(() => document.getElementById('pipVideo').style.filter === 'none' || document.getElementById('pipVideo').style.filter === '');
  console.log('A pré-visualização local também volta ao normal:', localPreviewFilterCleared);

  // --- Numa chamada só de voz, o botão de filtro não aparece (não há vídeo para filtrar). ---
  await a.page.evaluate(() => endCall());
  await a.page.waitForTimeout(300);
  await a.page.evaluate(() => joinGroupCall('voice'));
  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 8000 });
  const filterBtnHiddenForVoice = await a.page.evaluate(() => getComputedStyle(document.getElementById('callFilterBtn')).display === 'none');
  console.log('O botão de filtro fica escondido numa chamada só de voz:', filterBtnHiddenForVoice);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
