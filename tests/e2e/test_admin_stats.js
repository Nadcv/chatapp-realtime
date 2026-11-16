// Painel de estatísticas do administrador: registos, ativos, mensagens,
// chamadas e funcionalidades mais usadas; guardado em stats.json (que vai
// para o MongoDB) e por isso sobrevive a reinícios. Servidor próprio.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3097;
const B = `http://localhost:${PORT}`;
const post = (url, body) => fetch(B + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

(async () => {
  const root = path.join(__dirname, '..', '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-'));
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
    const mk = (n, i) => post('/api/register', { name: n, username: n.toLowerCase() + ts, phone: `+3519${i}${ts}`, country: 'PT', email: `${n.toLowerCase()}${ts}@example.com`, password: 'Zq8!vRt2mLp' });
    const admin = await mk('Admin', 1), ana = await mk('Ana', 2);
    // A Ana entra na app e manda 2 mensagens ao administrador.
    const page = await browser.newPage();
    await page.goto(B);
    await page.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('authUser', JSON.stringify(u)); }, [ana.token, ana.user]);
    await page.reload(); await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
    await page.evaluate((p) => startChatWithFoundUser(p), admin.user.phone);
    await page.waitForTimeout(1200);
    await page.evaluate(() => openChat(APP.chats.find(c => c.name === 'Admin').id));
    for (const t of ['olá', 'tudo bem?']) { await page.fill('#messageInput', t); await page.press('#messageInput', 'Enter'); await page.waitForTimeout(300); }
    await fetch(B + '/api/weather?lat=38.7&lon=-9.1').catch(() => {});
    await fetch(B + '/api/weather?lat=38.7&lon=-9.1').catch(() => {});
    await fetch(B + '/api/news').catch(() => {});

    const st = await fetch(B + '/api/admin/stats?days=7', { headers: { 'x-auth-token': admin.token } }).then(r => r.json());
    const today = st.series?.[st.series.length - 1];
    console.log('Conta registos e contas no total:', st.totals?.users === 2 && today?.registrations === 2);
    console.log('Conta pessoas ativas hoje:', st.totals?.activeToday === 1 && today?.active === 1);
    console.log('Conta mensagens enviadas:', today?.messages === 2);
    const weather = st.topFeatures?.find(f => f.name === 'weather');
    console.log('Funcionalidades mais usadas (meteorologia 2x, à frente das notícias):', weather?.count === 2 && st.topFeatures[0].name === 'weather' && st.topFeatures.some(f => f.name === 'news'));
    console.log('Não conta login/registo como funcionalidade:', !st.topFeatures.some(f => ['register', 'login', 'admin'].includes(f.name)));
    const forbidden = await fetch(B + '/api/admin/stats', { headers: { 'x-auth-token': ana.token } });
    console.log('Só o administrador vê as estatísticas (403 para os outros):', forbidden.status === 403);

    // Painel no browser do administrador.
    const ap = await browser.newPage();
    await ap.goto(B);
    await ap.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('authUser', JSON.stringify(u)); }, [admin.token, admin.user]);
    await ap.reload(); await ap.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
    await ap.evaluate(() => openAdminModal());
    await ap.click('#modalAdmin button:has-text("Estatísticas")');
    await ap.waitForSelector('#adminStatsBody .stats-kpi', { timeout: 5000 });
    const txt = await ap.textContent('#adminStatsBody');
    console.log('Painel mostra totais, gráficos e funcionalidades:', txt.includes('contas no total') && txt.includes('Mensagens por dia') && txt.includes('Meteorologia'));
    const bars = await ap.locator('#modalAdminStats .stats-chart').first().locator('.stats-bar').count();
    console.log('Gráfico tem uma barra por dia (14 por omissão):', bars === 14);
    await ap.click('.stats-range[data-days="7"]');
    await ap.waitForFunction(() => document.querySelector('#modalAdminStats .stats-chart .stats-bars')?.children.length === 7, { timeout: 5000 }).catch(() => {});
    console.log('Botão "7 dias" muda o período:', await ap.evaluate(() => document.querySelector('#modalAdminStats .stats-chart .stats-bars')?.children.length === 7));
    await ap.locator('#modalAdminStats .stats-chart').nth(2).locator('.stats-bar').last().hover();
    const tip = await ap.evaluate(() => document.querySelector('.stats-tip')?.textContent || '');
    console.log('Passar por cima de uma barra mostra o valor:', /: \d+ /.test(tip));

    // Sobrevive a reinícios.
    await new Promise(r => setTimeout(r, 6000)); // as estatísticas gravam-se com 5 s de atraso
    await stop(); await start();
    const st2 = await fetch(B + '/api/admin/stats?days=7', { headers: { 'x-auth-token': admin.token } }).then(r => r.json());
    console.log('Estatísticas continuam depois de reiniciar o servidor:', st2.series?.[6]?.messages === 2 && st2.topFeatures?.find(f => f.name === 'weather')?.count === 2);
  } finally {
    await browser.close(); srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
