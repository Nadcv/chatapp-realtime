// 📝 Transcrever mensagens de voz e 💡 Respostas sugeridas (Gemini).
// Arranca o seu próprio server.js com GEMINI_API_KEY e um Gemini falso
// (tests/mocks/mock_gemini_server.js, porta 3029).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3098;
const B = `http://localhost:${PORT}`;
const post = (url, body, token) => fetch(B + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) }, body: JSON.stringify(body) });
const waitHttp = async (u) => { for (let i = 0; i < 60; i++) { try { await fetch(u); return; } catch { await new Promise(r => setTimeout(r, 300)); } } };

(async () => {
  const root = path.join(__dirname, '..', '..');
  const mock = spawn(process.execPath, [path.join(root, 'tests', 'mocks', 'mock_gemini_server.js')], { stdio: 'ignore' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-'));
  for (const f of ['server.js', 'package.json', 'index.html', 'manifest.json', 'sw.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  for (const d of ['js', 'css']) if (fs.existsSync(path.join(root, d))) fs.cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const env = { ...process.env, PORT: String(PORT), MONGO_URI: '', GEMINI_API_KEY: 'mock-gemini-key', GEMINI_API_BASE: 'http://localhost:3029' };
  delete env.RESEND_API_KEY; delete env.EMAIL_USER;
  const srv = spawn(process.execPath, ['server.js'], { cwd: dir, env, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    await waitHttp('http://localhost:3029/last'); await waitHttp(B + '/');
    const ts = String(Date.now()).slice(-7);
    const mk = (n, i) => post('/api/register', { name: n, username: n.toLowerCase() + ts, phone: `+3519${i}${ts}`, country: 'PT', email: `${n.toLowerCase()}${ts}@example.com`, password: 'Zq8!vRt2mLp' }).then(r => r.json());
    const rita = await mk('Rita', 1), joao = await mk('Joao', 2);

    // Sem sessão: recusado.
    const noSess1 = await post('/api/transcribe', { fileData: 'data:audio/webm;base64,AAAA', fileType: 'audio/webm' });
    const noSess2 = await post('/api/smart-replies', { messages: [{ from: 'them', text: 'olá' }] });
    console.log('Sem sessão, transcrever e sugerir respostas são recusados (401):', noSess1.status === 401 && noSess2.status === 401);
    const notAudio = await post('/api/transcribe', { fileData: 'data:image/png;base64,AAAA', fileType: 'image/png' }, rita.token);
    console.log('Transcrever recusa ficheiros que não são áudio:', notAudio.status === 400);

    const open = async (acc) => {
      const p = await browser.newPage();
      p.on('dialog', d => d.accept());
      await p.goto(B);
      await p.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('authUser', JSON.stringify(u)); }, [acc.token, acc.user]);
      await p.reload(); await p.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
      return p;
    };
    const a = await open(rita);
    await a.evaluate((ph) => startChatWithFoundUser(ph), joao.user.phone);
    await a.waitForTimeout(1200);
    await a.evaluate(() => openChat(APP.chats.find(c => c.name === 'Joao').id));
    await a.fill('#messageInput', 'Vens ao jantar hoje?'); await a.press('#messageInput', 'Enter');
    const b = await open(joao);
    await b.waitForFunction(() => APP.chats.some(c => c.name === 'Rita'), { timeout: 8000 });
    await b.evaluate(() => openChat(APP.chats.find(c => c.name === 'Rita').id));
    await b.waitForFunction(() => (APP.messages[APP.currentChatId] || []).some(m => m.text === 'Vens ao jantar hoje?'), { timeout: 8000 });

    // 💡 Respostas sugeridas: o botão só aparece; nada é enviado ao Gemini antes de carregar.
    await b.waitForSelector('#smartRepliesBar .smart-reply-chip', { timeout: 5000 });
    const before = await fetch('http://localhost:3029/last').then(r => r.json());
    console.log('Aparece "💡 Sugerir respostas" e nada vai para o Gemini sem carregar:', (await b.textContent('#smartRepliesBar')).includes('Sugerir respostas') && before === null);
    await b.click('#smartRepliesBar button:has-text("Sugerir respostas")');
    await b.waitForFunction(() => document.querySelectorAll('#smartRepliesBar .smart-reply-chip').length === 4, { timeout: 8000 }).catch(() => {});
    const chips = await b.$$eval('#smartRepliesBar .smart-reply-chip', els => els.map(e => e.textContent.trim()));
    console.log('Mostra 3 sugestões (e o ✕):', chips.length === 4 && chips.includes('Combinado! 👍') && chips[3] === '✕');
    const sent = await fetch('http://localhost:3029/last').then(r => r.json());
    const prompt = JSON.stringify(sent?.body?.contents || '');
    console.log('O Gemini recebe a conversa com a última mensagem:', prompt.includes('Vens ao jantar hoje?') && sent.body.generationConfig?.responseMimeType === 'application/json');
    await b.click('#smartRepliesBar button:has-text("Combinado!")');
    console.log('Tocar numa sugestão põe-na na caixa de texto (para enviar ou editar):', (await b.inputValue('#messageInput')) === 'Combinado! 👍' && !(await b.isVisible('#smartRepliesBar')));

    // 📝 Transcrever uma mensagem de voz recebida.
    await a.evaluate(() => {
      const chatId = APP.currentChatId;
      APP.messages[chatId].push({ id: 'voz_teste_1', sender: 'Joao', text: '', time: '10:00', type: 'received', fileData: 'data:audio/webm;base64,GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYU4BnQI0VSalmQCgq17FAAw9CQE2AQAZ3aGFtbXlXQUAGd2hhbW15', fileType: 'audio/webm' });
      renderMessages();
    });
    await a.waitForSelector('.transcribe-btn');
    await a.click('.transcribe-btn');
    await a.waitForSelector('.msg-transcript', { timeout: 8000 }).catch(() => {});
    const tr = await a.textContent('.msg-transcript').catch(() => '');
    console.log('"📝 Transcrever" mostra o texto do áudio:', tr.includes('Olá, chego daqui a dez minutos.'));
    const lastReq = await fetch('http://localhost:3029/last').then(r => r.json());
    console.log('O áudio vai para o Gemini como anexo de áudio:', JSON.stringify(lastReq.body.contents).includes('"mime_type":"audio/webm"'));
    // A transcrição é mostrada como texto (nunca HTML).
    await a.evaluate(() => { const m = APP.messages[APP.currentChatId].find(x => x.id === 'voz_teste_1'); m.transcript = '<img src=x onerror="window.__xss=1">'; renderMessages(); });
    await a.waitForTimeout(300);
    console.log('Transcrição é mostrada como texto, sem executar HTML:', !(await a.evaluate(() => window.__xss)) && (await a.textContent('.msg-transcript')).includes('<img'));
  } finally {
    await browser.close(); srv.kill(); mock.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
