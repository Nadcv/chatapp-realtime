// Atualizações sem perder dados: um "deploy" (servidor reinicia com ficheiros
// novos) faz aparecer "Há uma versão nova"; a app NÃO recarrega sozinha; ao
// carregar em "Atualizar agora", a sessão, o rascunho da conversa e a fila de
// mensagens por enviar continuam lá. Servidor próprio.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3102;
const B = `http://localhost:${PORT}`;

(async () => {
  const root = path.join(__dirname, '..', '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-'));
  for (const f of ['server.js', 'package.json', 'index.html', 'manifest.json', 'sw.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  for (const d of ['js', 'css']) fs.cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const env = { ...process.env, PORT: String(PORT), MONGO_URI: '' };
  delete env.RESEND_API_KEY; delete env.EMAIL_USER; delete env.RENDER_GIT_COMMIT;
  let srv;
  const start = async () => { srv = spawn(process.execPath, ['server.js'], { cwd: dir, env, stdio: 'ignore' }); for (let i = 0; i < 60; i++) { try { await fetch(B + '/'); return; } catch { await new Promise(r => setTimeout(r, 300)); } } };
  const stop = () => new Promise((r) => { srv.on('exit', r); srv.kill('SIGTERM'); });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    await start();
    const v1 = (await fetch(B + '/api/version').then(r => r.json())).version;
    console.log('O servidor diz a versão da app:', typeof v1 === 'string' && v1.length >= 8);
    const ts = String(Date.now()).slice(-7);
    const mk = (n, i) => fetch(B + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, username: n.toLowerCase() + ts, phone: `+3519${i}${ts}`, country: 'PT', email: `${n.toLowerCase()}${ts}@example.com`, password: 'Zq8!vRt2mLp' }) }).then(r => r.json());
    const ana = await mk('Ana', 1), rui = await mk('Rui', 2);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
    await page.goto(B);
    await page.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('authUser', JSON.stringify(u)); }, [ana.token, ana.user]);
    await page.reload(); await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
    await page.evaluate((ph) => startChatWithFoundUser(ph), rui.user.phone);
    await page.waitForTimeout(1200);
    await page.evaluate(() => openChat(APP.chats.find(c => c.name === 'Rui').id));
    await page.fill('#messageInput', 'Rascunho que não se pode perder');
    await page.waitForTimeout(700);
    // Uma mensagem "por enviar" na fila offline.
    await page.evaluate(() => { localStorage.setItem('chatapp_offline_queue_' + APP.user.phone, JSON.stringify([{ id: 'q1', text: 'na fila' }])); window.__antesDaAtualizacao = true; });

    // "Deploy": muda um ficheiro e reinicia o servidor.
    fs.appendFileSync(path.join(dir, 'js', 'app.js'), '\n// versão nova\n');
    await stop(); await start();
    const v2 = (await fetch(B + '/api/version').then(r => r.json())).version;
    console.log('Depois do deploy a versão muda:', v2 !== v1);
    await page.waitForSelector('#appUpdateBanner', { timeout: 15000 }).catch(() => {});
    console.log('Aparece "Há uma versão nova" com o botão "Atualizar agora":', (await page.textContent('#appUpdateBanner').catch(() => '')).includes('Há uma versão nova') && await page.isVisible('#appUpdateBtn'));
    console.log('A app não recarregou sozinha (o rascunho continua na caixa):', await page.evaluate(() => window.__antesDaAtualizacao === true) && (await page.inputValue('#messageInput')) === 'Rascunho que não se pode perder');

    // Lê a fila logo no arranque da página nova (antes de a app a enviar).
    await ctx.addInitScript(() => { window.__queueAtLoad = Object.keys(localStorage).filter(k => k.startsWith('chatapp_offline_queue_')).map(k => localStorage.getItem(k)).join(''); });
    await Promise.all([page.waitForNavigation({ timeout: 15000 }), page.click('#appUpdateBtn')]);
    await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 }).catch(() => {});
    console.log('Depois de atualizar continua com sessão iniciada (sem novo login):', await page.isVisible('#mainApp'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => openChat(APP.chats.find(c => c.name === 'Rui').id));
    console.log('O rascunho da conversa volta a aparecer:', (await page.inputValue('#messageInput')) === 'Rascunho que não se pode perder');
    console.log('A fila de mensagens por enviar continua guardada:', await page.evaluate(() => (window.__queueAtLoad || '').includes('na fila')));
    console.log('Já não mostra o aviso (está na versão nova):', !(await page.isVisible('#appUpdateBanner')));

    // Enviar a mensagem apaga o rascunho.
    await page.fill('#messageInput', 'Olá Rui');
    await page.press('#messageInput', 'Enter');
    await page.waitForTimeout(600);
    console.log('Depois de enviar, o rascunho é apagado:', await page.evaluate(() => !localStorage.getItem('draft:chat:' + APP.currentChatId)));
  } finally {
    await browser.close(); srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
