// Feed: fotos e vídeos vão DIRETAMENTE do browser para o Cloudinary (assinatura
// pedida a /api/upload/sign), por isso aceitam vídeos grandes (aqui 20 MB, acima
// do antigo limite de 14 MB) e mostram a percentagem do envio.
// Servidor próprio + Cloudinary falso local (porta 3030) que confirma a assinatura.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3100, CLD = 3030;
const B = `http://localhost:${PORT}`;
const SECRET = 'segredo-cloudinary-teste';

(async () => {
  const uploads = [];
  const cld = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const text = body.toString('latin1');
      const field = (n) => (text.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`)) || [])[1];
      const ts = field('timestamp'), folder = field('folder'), sig = field('signature');
      const expected = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${ts}${SECRET}`).digest('hex');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'POST') return res.end('{}'); // o browser a ir buscar o vídeo para o mostrar (não é um envio)
      uploads.push({ url: req.url, bytes: body.length, sigOk: sig === expected, apiKey: field('api_key'), folder });
      if (sig !== expected) { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'Invalid Signature' } })); }
      res.end(JSON.stringify({ secure_url: `http://localhost:${CLD}/demo/video/upload/v1/nadio-feed/teste.mp4` }));
    });
  }).listen(CLD);

  const root = path.join(__dirname, '..', '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedup-'));
  for (const f of ['server.js', 'package.json', 'index.html', 'manifest.json', 'sw.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  for (const d of ['js', 'css']) if (fs.existsSync(path.join(root, d))) fs.cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const env = { ...process.env, PORT: String(PORT), MONGO_URI: '', CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'chave123', CLOUDINARY_API_SECRET: SECRET, CLOUDINARY_UPLOAD_BASE: `http://localhost:${CLD}` };
  delete env.RESEND_API_KEY; delete env.EMAIL_USER;
  const srv = spawn(process.execPath, ['server.js'], { cwd: dir, env, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(B + '/'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
    const ts = String(Date.now()).slice(-7);
    const reg = await fetch(B + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Video', username: 'video' + ts, phone: '+35191' + ts, country: 'PT', email: `v${ts}@example.com`, password: 'Zq8!vRt2mLp' }) }).then(r => r.json());

    const noSess = await fetch(B + '/api/upload/sign', { method: 'POST' });
    console.log('Pedir assinatura sem sessão é recusado (401):', noSess.status === 401);
    const sig = await fetch(B + '/api/upload/sign', { method: 'POST', headers: { 'x-auth-token': reg.token } }).then(r => r.json());
    console.log('A assinatura não expõe o segredo do Cloudinary:', sig.configured && !JSON.stringify(sig).includes(SECRET) && sig.maxVideoMB === 100);

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
    await page.goto(B);
    await page.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('authUser', JSON.stringify(u)); }, [reg.token, reg.user]);
    await page.reload(); await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => openFeedScreen());
    await page.waitForSelector('#feedSentinel');
    await page.waitForTimeout(500);

    // Vídeo de 20 MB (antes era recusado acima de 14 MB).
    const big = Buffer.alloc(20 * 1024 * 1024, 7);
    await page.setInputFiles('#feedFileInput', { name: 'ferias.mp4', mimeType: 'video/mp4', buffer: big });
    await page.waitForTimeout(400);
    console.log('Um vídeo de 20 MB é aceite e mostra o tamanho:', (await page.textContent('#feedComposerStatus')).includes('20.0 MB') && await page.isVisible('#feedMediaPreview video'));
    const seen = [];
    const poll = setInterval(async () => { try { seen.push(await page.textContent('#feedComposerStatus')); } catch (e) {} }, 30);
    await page.fill('#feedText', 'As minhas férias 🎬');
    await page.click('#feedPublishBtn');
    await page.waitForSelector('#feedList .feed-card video', { timeout: 20000 }).catch(() => {});
    clearInterval(poll);
    console.log('Mostra a percentagem do envio:', seen.some(t => /A enviar o vídeo… \d+%/.test(t || '')));
    const up = uploads[uploads.length - 1] || {};
    console.log('O vídeo vai diretamente para o Cloudinary, com assinatura válida e na pasta do feed:', up.sigOk === true && up.bytes > 20 * 1024 * 1024 && up.apiKey === 'chave123' && up.folder === 'nadio-feed');
    console.log('A publicação aparece no feed com o vídeo:', (await page.textContent('#feedList .feed-card .feed-text')).includes('As minhas férias') && (await page.getAttribute('#feedList .feed-card video', 'src')).includes('/nadio-feed/teste.mp4'));

    // Vídeo acima de 100 MB: recusado com uma mensagem clara (sem enviar nada).
    const before = uploads.length;
    const hugePath = path.join(dir, 'enorme.mp4');
    fs.writeFileSync(hugePath, Buffer.alloc(101 * 1024 * 1024, 1));
    await page.setInputFiles('#feedFileInput', hugePath);
    await page.waitForTimeout(400);
    console.log('Vídeo acima de 100 MB é recusado com o tamanho e o limite:', (await page.textContent('#feedComposerStatus')).includes('máx. 100 MB') && uploads.length === before);
  } finally {
    await browser.close(); srv.kill(); cld.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
