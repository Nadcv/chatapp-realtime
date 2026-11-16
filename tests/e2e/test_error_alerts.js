// Aviso de erros: um erro de JavaScript no browser chega ao servidor
// (/api/client-error) e o servidor manda um email-resumo ao administrador.
// Arranca o seu próprio server.js e um "Resend" falso que só guarda os emails.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3094, MAIL_PORT = 3095;
const B = `http://localhost:${PORT}`;

(async () => {
  const emails = [];
  const mail = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => body += c);
    req.on('end', () => { try { emails.push(JSON.parse(body)); } catch {} res.setHeader('Content-Type', 'application/json'); res.end('{"id":"x"}'); });
  }).listen(MAIL_PORT);

  const root = path.join(__dirname, '..', '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erroralert-'));
  for (const f of ['server.js', 'package.json', 'index.html', 'manifest.json', 'sw.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  for (const d of ['js', 'css']) if (fs.existsSync(path.join(root, d))) fs.cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const env = { ...process.env, PORT: String(PORT), MONGO_URI: '', RESEND_API_KEY: 'mock', RESEND_API_BASE: `http://localhost:${MAIL_PORT}`,
    ALERT_EMAIL: 'admin@example.com', ERROR_ALERT_CHECK_SECONDS: '2', ERROR_ALERT_INTERVAL_HOURS: '0.0001' };
  delete env.EMAIL_USER;
  const srv = spawn(process.execPath, ['server.js'], { cwd: dir, env, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(B + '/'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
    const page = await browser.newPage();
    await page.goto(B);
    await page.waitForTimeout(500);
    const sentReq = page.waitForRequest((r) => r.url().endsWith('/api/client-error'), { timeout: 5000 }).catch(() => null);
    await page.evaluate(() => setTimeout(() => { throw new Error('erro de teste do aviso'); }, 0));
    const req = await sentReq;
    console.log('Erro no browser é enviado para /api/client-error:', !!req && JSON.parse(req.postData()).message.includes('erro de teste do aviso'));

    // O mesmo erro repetido não é enviado outra vez.
    let repeats = 0;
    page.on('request', (r) => { if (r.url().endsWith('/api/client-error')) repeats++; });
    await page.evaluate(() => setTimeout(() => { throw new Error('erro de teste do aviso'); }, 0));
    await page.waitForTimeout(800);
    console.log('O mesmo erro não é enviado duas vezes:', repeats === 0);

    for (let i = 0; i < 20 && !emails.length; i++) await new Promise(r => setTimeout(r, 500));
    const email = emails[0];
    console.log('Servidor manda email de aviso ao administrador:', !!email && email.to === 'admin@example.com');
    console.log('Email traz o erro do browser e o assunto da NADIO:', !!email && /erro de teste do aviso/.test(email.text) && /NADIO/.test(email.subject));
  } finally {
    await browser.close();
    srv.kill(); mail.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
