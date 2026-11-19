// Feed: publicações dos contactos (texto, foto, vídeo), gostos/reações,
// comentários, apagar, denunciar e privacidade (só contactos, nunca bloqueados).
// Servidor próprio (precisa de contas "limpas" para saber quem vê o quê).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3099;
const B = `http://localhost:${PORT}`;
const req = (method, url, token, body) => fetch(B + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

(async () => {
  const root = path.join(__dirname, '..', '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-'));
  for (const f of ['server.js', 'package.json', 'index.html', 'manifest.json', 'sw.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  for (const d of ['js', 'css']) if (fs.existsSync(path.join(root, d))) fs.cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const env = { ...process.env, PORT: String(PORT), MONGO_URI: '' };
  delete env.RESEND_API_KEY; delete env.EMAIL_USER; delete env.ADMIN_PHONE;
  let srv;
  const start = async () => { srv = spawn(process.execPath, ['server.js'], { cwd: dir, env, stdio: 'ignore' }); for (let i = 0; i < 60; i++) { try { await fetch(B + '/'); return; } catch { await new Promise(r => setTimeout(r, 500)); } } };
  const stop = () => new Promise((r) => { srv.on('exit', r); srv.kill('SIGTERM'); });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    await start();
    const ts = String(Date.now()).slice(-7);
    const mk = (n, i) => req('POST', '/api/register', null, { name: n, username: n.toLowerCase() + ts, phone: `+3519${i}${ts}`, country: 'PT', email: `${n.toLowerCase()}${ts}@example.com`, password: 'Zq8!vRt2mLp' }).then(r => r.data);
    const admin = await mk('Admin', 0), ana = await mk('Ana', 1), rui = await mk('Rui', 2), eva = await mk('Eva', 3);

    // A Ana adiciona o Rui pela app (como "procurar utilizador" → conversar).
    const open = async (acc) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const p = await ctx.newPage();
      p.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
      p.on('dialog', d => d.type() === 'prompt' ? d.accept('Spam') : d.accept());
      await p.goto(B);
      await p.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('authUser', JSON.stringify(u)); }, [acc.token, acc.user]);
      await p.reload(); await p.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
      return p;
    };
    const pa = await open(ana);
    await pa.evaluate((ph) => startChatWithFoundUser(ph), rui.user.phone);
    await pa.waitForTimeout(1000);

    // Sem sessão: recusado.
    console.log('Sem sessão o feed é recusado (401):', (await req('GET', '/api/feed')).status === 401);
    // O Rui publica uma foto (link do Cloudinary) e um texto.
    const bad = await req('POST', '/api/feed', rui.token, { text: 'olá', mediaUrl: 'https://evil.example.com/x.jpg', mediaType: 'image' });
    console.log('Só aceita fotos/vídeos do Cloudinary (outros links recusados):', bad.status === 400);
    const p1 = await req('POST', '/api/feed', rui.token, { text: 'Fim de semana na praia 🏖️', mediaUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg', mediaType: 'image' });
    const p2 = await req('POST', '/api/feed', rui.token, { text: 'Bom dia a todos!' });
    console.log('Publicar texto e foto funciona:', p1.status === 200 && p2.status === 200 && p1.data.post.media?.type === 'image');

    const feedOf = async (acc) => (await req('GET', '/api/feed', acc.token)).data.posts || [];
    const anaFeed = await feedOf(ana), evaFeed = await feedOf(eva), ruiFeed = await feedOf(rui);
    console.log('A Ana (contacto) vê as 2 publicações do Rui, a mais recente primeiro:', anaFeed.length === 2 && anaFeed[0].text === 'Bom dia a todos!');
    console.log('O próprio Rui vê as suas publicações:', ruiFeed.length === 2 && ruiFeed[0].mine === true);
    console.log('A Eva (não é contacto) não vê nada:', evaFeed.length === 0 && (await req('POST', `/api/feed/${p1.data.post.id}/react`, eva.token, { emoji: '❤️' })).status === 404);

    // Reações e comentários pela API.
    await req('POST', `/api/feed/${p1.data.post.id}/react`, ana.token, { emoji: '🔥' });
    const r2 = await req('POST', `/api/feed/${p1.data.post.id}/react`, ana.token, { emoji: '❤️' });
    console.log('Trocar de reação substitui a anterior (1 reação por pessoa):', r2.data.post.reactions['❤️'] === 1 && !r2.data.post.reactions['🔥'] && r2.data.post.myReaction === '❤️');
    const c1 = await req('POST', `/api/feed/${p1.data.post.id}/comments`, ana.token, { text: 'Que inveja! 😍' });
    const cl = await req('GET', `/api/feed/${p1.data.post.id}/comments`, rui.token);
    console.log('Comentar funciona e o autor vê o comentário:', c1.status === 200 && cl.data.comments?.[0]?.text === 'Que inveja! 😍' && cl.data.comments[0].author.name === 'Ana');

    // UI: abrir o feed, ver a publicação, gostar, reagir, comentar, publicar.
    await pa.evaluate(() => openFeedScreen());
    await pa.waitForSelector('#feedList .feed-card', { timeout: 5000 });
    const cards = await pa.$$eval('#feedList .feed-card', els => els.map(e => e.querySelector('.feed-text')?.textContent || ''));
    console.log('Ecrã do feed mostra as publicações dos contactos:', cards.length === 2 && cards.includes('Fim de semana na praia 🏖️'));
    const card2 = `#post_${p2.data.post.id}`;
    await pa.click(`${card2} .feed-like`);
    await pa.waitForFunction((s) => document.querySelector(s + ' .feed-like')?.classList.contains('reacted'), card2, { timeout: 5000 }).catch(() => {});
    console.log('Botão "Gosto" marca o gosto e mostra a contagem:', (await pa.textContent(`${card2} .feed-summary`)).includes('❤️ 1'));
    await pa.click(`${card2} .feed-react-btn`);
    await pa.click(`${card2} .feed-reaction-picker button[data-emoji="😂"]`);
    await pa.waitForFunction((s) => document.querySelector(s + ' .feed-summary')?.textContent.includes('😂'), card2, { timeout: 5000 }).catch(() => {});
    console.log('Escolher a reação 😂 troca o gosto pela reação:', (await pa.textContent(`${card2} .feed-summary`)).includes('😂 1'));
    await pa.click(`${card2} .feed-comment-btn`);
    await pa.waitForSelector('#modalFeedComments.active');
    await pa.fill('#feedCommentInput', 'Bom dia Rui!');
    await pa.press('#feedCommentInput', 'Enter');
    await pa.waitForSelector('#feedCommentsList .feed-comment', { timeout: 5000 }).catch(() => {});
    console.log('Comentar pelo ecrã mostra o comentário e atualiza a contagem:', (await pa.textContent('#feedCommentsList')).includes('Bom dia Rui!') && (await pa.textContent(`${card2} .feed-summary`)).includes('1 comentário'));
    await pa.evaluate(() => closeModal('modalFeedComments'));
    await pa.fill('#feedText', 'A minha primeira publicação <b>na NADIO</b>');
    await pa.click('#feedPublishBtn');
    await pa.waitForFunction(() => document.querySelector('#feedList .feed-card .feed-text')?.textContent.includes('primeira publicação'), { timeout: 5000 }).catch(() => {});
    const firstText = await pa.$eval('#feedList .feed-card .feed-text', e => ({ text: e.textContent, html: e.innerHTML }));
    console.log('Publicar pelo ecrã põe a publicação no topo, mostrada como texto (sem HTML):', firstText.text.includes('<b>na NADIO</b>') && !firstText.html.includes('<b>'));
    const ruiNow = await feedOf(rui);
    console.log('O Rui (contacto da Ana) vê a publicação da Ana:', ruiNow.some(p => p.text.startsWith('A minha primeira publicação')));

    // Vídeo: toca sozinho só quando está no ecrã (verificado pelos atributos).
    const v = await req('POST', '/api/feed', rui.token, { text: 'vídeo', mediaUrl: 'https://res.cloudinary.com/demo/video/upload/dog.mp4', mediaType: 'video' });
    await pa.evaluate(() => refreshFeed());
    await pa.waitForSelector(`#post_${v.data.post.id} video`, { timeout: 5000 }).catch(() => {});
    const vattrs = await pa.$eval(`#post_${v.data.post.id} video`, el => ({ muted: el.muted, playsinline: el.hasAttribute('playsinline'), observed: el.dataset.observed === '1' })).catch(() => ({}));
    console.log('Vídeos ficam prontos para tocar sozinhos sem som ao rolar:', vattrs.muted && vattrs.playsinline && vattrs.observed);

    // Denunciar e apagar.
    const rep = await req('POST', `/api/feed/${p1.data.post.id}/report`, ana.token, { reason: 'Spam' });
    const reports = await req('GET', '/api/admin/reports', admin.token);
    console.log('Denunciar uma publicação chega ao administrador:', rep.status === 200 && reports.data.reports?.some(r => r.postId === p1.data.post.id && r.reason.includes('Spam')));
    console.log('Só o autor pode apagar (a Ana não pode apagar a do Rui):', (await req('DELETE', `/api/feed/${p2.data.post.id}`, ana.token)).status === 403);
    console.log('O autor apaga a sua publicação:', (await req('DELETE', `/api/feed/${p2.data.post.id}`, rui.token)).status === 200 && !(await feedOf(ana)).some(p => p.id === p2.data.post.id));

    // Bloquear: quem bloqueia deixa de ver (e de ser visto).
    await pa.evaluate((ph) => socket.emit('block_user', { phone: ph }), rui.user.phone);
    await pa.waitForTimeout(500);
    console.log('Depois de bloquear o Rui, a Ana deixa de ver as publicações dele e ele as dela:', (await feedOf(ana)).every(p => p.author.phone !== rui.user.phone) && (await feedOf(rui)).every(p => p.author.phone !== ana.user.phone));
    await pa.evaluate((ph) => socket.emit('unblock_user', { phone: ph }), rui.user.phone);
    await pa.waitForTimeout(500);

    // Sobrevive a reinícios (no Render vem do MongoDB; aqui do posts.json).
    await new Promise(r => setTimeout(r, 2500));
    await stop(); await start();
    const after = await feedOf(ana);
    console.log('As publicações, reações e comentários continuam depois de reiniciar:', after.some(p => p.id === p1.data.post.id && p.reactions['❤️'] === 1 && p.commentCount === 1));
  } finally {
    await browser.close(); srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
