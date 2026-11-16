// Limite de tentativas (login, registo, recuperação de senha).
// Arranca o seu próprio server.js numa porta à parte, com
// RATE_LIMIT_INCLUDE_LOCALHOST=1 (o servidor principal dos testes corre em
// localhost, onde o limite por IP está desligado para não travar a suite).
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3093;
const B = `http://localhost:${PORT}`;
const post = (url, body) => fetch(B + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

(async () => {
  // Cópia isolada da app, para não mexer nos ficheiros de dados do servidor principal.
  const root = path.join(__dirname, '..', '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratelimit-'));
  for (const f of ['server.js', 'package.json', 'index.html']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  for (const d of ['js', 'css']) if (fs.existsSync(path.join(root, d))) fs.cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const env = { ...process.env, PORT: String(PORT), RATE_LIMIT_INCLUDE_LOCALHOST: '1', MONGO_URI: '' };
  delete env.RESEND_API_KEY; delete env.EMAIL_USER;
  const srv = spawn(process.execPath, ['server.js'], { cwd: dir, env, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(B + '/'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
    const ts = String(Date.now()).slice(-8);
    const phone = '+35191' + ts;
    const pass = 'Zq8!vRt2mLp';
    const reg = await post('/api/register', { name: 'Limite', username: 'limite' + ts, phone, country: 'PT', email: `limite${ts}@example.com`, password: pass });
    console.log('Registo normal funciona:', reg.status === 200);

    const login = (password, p = phone) => post('/api/login', { phone: p, password, deviceId: 'dev-limite' });
    const ok1 = await login(pass);
    console.log('Login certo à primeira funciona:', ok1.status === 200);

    const statuses = [];
    for (let i = 0; i < 10; i++) statuses.push((await login('errada')).status);
    console.log('10 senhas erradas dão 401:', statuses.every(s => s === 401));
    const blocked = await login(pass);
    const body = await blocked.json();
    console.log('À 11ª tentativa fica bloqueado (429), mesmo com a senha certa:', blocked.status === 429);
    console.log('Resposta traz Retry-After e mensagem em português:', !!blocked.headers.get('retry-after') && /Tenta novamente daqui a/.test(body.error || ''));
    const other = await login('x', '+351910000001');
    console.log('Outro número continua a poder tentar:', other.status === 401);

    const regs = [];
    for (let i = 0; i < 15; i++) regs.push((await post('/api/register', {})).status);
    console.log('Registo fica limitado por IP depois de 15 pedidos por hora:', regs.slice(0, 14).every(s => s !== 429) && regs[14] === 429);

    const resets = [];
    for (let i = 0; i < 6; i++) resets.push((await post('/api/password-reset/request', { phone })).status);
    console.log('Recuperação de senha limitada a 5 pedidos por hora por número:', resets.slice(0, 5).every(s => s !== 429) && resets[5] === 429);
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
