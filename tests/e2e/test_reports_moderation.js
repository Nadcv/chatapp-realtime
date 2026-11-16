// Denúncias: quem denuncia bloqueia a pessoa e a denúncia fica guardada
// (reports.json, que vai para o MongoDB). O administrador vê-a no painel,
// marca-a como resolvida, e ela sobrevive a um reinício do servidor.
// Arranca o seu próprio server.js (a 1ª conta registada fica administradora).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3096;
const B = `http://localhost:${PORT}`;
const post = (url, body, token) => fetch(B + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) }, body: JSON.stringify(body) }).then(r => r.json());

(async () => {
  const root = path.join(__dirname, '..', '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
  for (const f of ['server.js', 'package.json', 'index.html', 'manifest.json', 'sw.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const env = { ...process.env, PORT: String(PORT), MONGO_URI: '' };
  delete env.RESEND_API_KEY; delete env.EMAIL_USER; delete env.ADMIN_PHONE;
  let srv;
  const start = async () => {
    srv = spawn(process.execPath, ['server.js'], { cwd: dir, env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { await fetch(B + '/'); return; } catch { await new Promise(r => setTimeout(r, 500)); } }
  };
  const stop = () => new Promise((r) => { srv.on('exit', r); srv.kill('SIGTERM'); });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    await start();
    const ts = String(Date.now()).slice(-7);
    const mk = (n, i) => post('/api/register', { name: n, username: n.toLowerCase() + ts, phone: `+3519${i}${ts}`, country: 'PT', email: `${n.toLowerCase()}${ts}@example.com`, password: 'Zq8!vRt2mLp' });
    const admin = await mk('Admin', 1);
    const ana = await mk('Ana', 2);
    const rui = await mk('Rui', 3);
    console.log('Primeira conta é administradora:', admin.user?.isAdmin === true && ana.user?.isAdmin === false);

    // A Ana denuncia o Rui pela própria app.
    const page = await browser.newPage();
    await page.goto(B);
    await page.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('authUser', JSON.stringify(u)); }, [ana.token, ana.user]);
    await page.reload();
    await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
    await page.evaluate((p) => {
      APP.chats.push({ id: 'dm_rui', name: 'Rui', phone: p, type: 'user' });
      APP.currentChatId = 'dm_rui';
    }, rui.user.phone);
    page.on('dialog', (d) => d.type() === 'prompt' ? d.accept('Mensagens ofensivas') : d.accept());
    await page.evaluate(() => openReportUserPrompt());
    await page.waitForTimeout(800);

    const r1 = await fetch(B + '/api/admin/reports', { headers: { 'x-auth-token': admin.token } }).then(r => r.json());
    const rep = r1.reports?.[0];
    console.log('Denúncia aparece ao administrador com motivo e nomes:', !!rep && rep.reason === 'Mensagens ofensivas' && rep.reporterName === 'Ana' && rep.targetName === 'Rui' && r1.open === 1);
    const forbidden = await fetch(B + '/api/admin/reports', { headers: { 'x-auth-token': ana.token } });
    console.log('Quem não é administrador não vê as denúncias (403):', forbidden.status === 403);

    // Painel de administração mostra a denúncia e permite marcá-la como resolvida.
    const adminPage = await browser.newPage();
    adminPage.on('dialog', (d) => d.accept());
    await adminPage.goto(B);
    await adminPage.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('authUser', JSON.stringify(u)); }, [admin.token, admin.user]);
    await adminPage.reload();
    await adminPage.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
    await adminPage.evaluate(() => openAdminModal());
    await adminPage.waitForFunction(() => document.getElementById('adminReportsBtn').textContent.includes('(1)'), { timeout: 5000 }).catch(() => {});
    console.log('Botão do painel mostra 1 denúncia aberta:', (await adminPage.textContent('#adminReportsBtn')).includes('(1)'));
    await adminPage.evaluate(() => openAdminReportsModal());
    await adminPage.waitForSelector('.admin-report');
    await adminPage.click('.admin-report button:has-text("Resolvida")');
    await adminPage.waitForFunction(() => document.querySelector('.admin-report-status')?.textContent.includes('Resolvida'), { timeout: 5000 }).catch(() => {});
    console.log('Administrador marca a denúncia como resolvida no painel:', (await adminPage.textContent('.admin-report-status')).includes('Resolvida'));

    // Sobrevive a um reinício (no Render isto vem do MongoDB; aqui do reports.json).
    await stop(); await start();
    const r2 = await fetch(B + '/api/admin/reports', { headers: { 'x-auth-token': admin.token } }).then(r => r.json());
    console.log('Denúncia continua guardada depois de reiniciar o servidor:', r2.reports?.length === 1 && r2.reports[0].status === 'resolvida' && r2.open === 0);
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
