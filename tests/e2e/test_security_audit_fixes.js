const { chromium } = require('playwright');
const http = require('http');
const os = require('os');

// Regressão para 4 das 5 vulnerabilidades encontradas numa auditoria de
// segurança formal (a 5ª, SSRF em /api/gemini-chat, partilha o mesmo
// mecanismo de proteção do teste 3/4 abaixo — safeFetchNoSSRF — mas não tem
// teste próprio aqui porque exigiria uma chave real da API do Gemini, que
// este ambiente de testes não tem):
//
// 1) Falsificação de identidade por Socket.IO: um socket já ligado
//    conseguia dizer-se "dono" de QUALQUER telefone só ao emitir
//    'user_login' com esse número — nunca validava contra uma sessão real
//    (sessions[token], o mesmo mecanismo usado em todas as rotas HTTP).
//    Corrigido: o telefone só vem de sessions[token], nunca do que o
//    cliente diz ser.
// 2) XSS armazenado: o nome de exibição (sem restrição de caracteres no
//    registo) era inserido em vários innerHTML (lista de conversas, nome
//    do remetente, citações em resposta) sem escapeHtml() — uma conta
//    registada com "<img onerror=...>" como nome executava JS no browser
//    de quem a visse, incluindo quem nem sequer a tinha como contacto
//    antes (o primeiro DM já adiciona automaticamente).
// 3) SSRF em /api/news/read: aceitava qualquer URL (incluindo endereços
//    internos/privados) sem nenhuma validação, e devolvia o conteúdo lido.
// 4) SSRF por redirecionamento em /api/link-preview: validava o endereço
//    da URL original, mas seguia (`redirect: 'follow'`) qualquer
//    redirecionamento HTTP sem validar o destino final — um site com
//    endereço válido que respondesse com "Location: <endereço interno>"
//    contornava a proteção por completo.
const ADMIN_SECRET = process.env.ADMIN_SIGNUP_SECRET || 'segredo-teste-123';

async function registerUser(browser, label, customName) {
  const page = await browser.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION (${label}):`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  await page.fill('#regName', customName || label);
  await page.fill('#regUsername', 'sec_' + label.toLowerCase() + '_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'sec_' + label.toLowerCase() + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const phone = await page.evaluate(() => APP.user.phone);
  const email = await page.evaluate(() => APP.user.email);
  const username = await page.evaluate(() => APP.user.username);
  return { page, phone, email, username };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ==================== 1) FALSIFICAÇÃO DE IDENTIDADE (Socket.IO) ====================
  const alice = await registerUser(browser, 'AliceSec');
  const bob = await registerUser(browser, 'BobSec');

  // Do PRÓPRIO browser da Alice (mas isto representa qualquer socket.io
  // "cru", nunca autenticado de verdade), tenta dizer-se "dona" do telefone
  // do Bob com um token inválido — exatamente o ataque que a auditoria
  // encontrou. Se a correção funcionar, o servidor NUNCA associa este
  // socket ao telefone do Bob, e a alteração de email seguinte não tem
  // qualquer efeito na conta dele.
  await alice.page.evaluate((bobPhone) => {
    socket.emit('user_login', { name: 'Attacker', phone: bobPhone, token: 'token-invalido-forjado' });
    socket.emit('set_email', { email: 'attacker-takeover@evil.example' });
  }, bob.phone);
  await alice.page.waitForTimeout(600);

  // Confirma diretamente no servidor (login real como Bob) que o email dele
  // continua o mesmo — nunca foi sequestrado pelo ataque acima.
  const bobLoginCheck = await alice.page.evaluate(async (phone) => {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password: 'senha1234forte', deviceId: 'security-test-device-' + Date.now(), deviceName: 'Security Test Device' })
    });
    const data = await r.json();
    return { ok: r.ok, status: r.status, error: data.error, email: data.user?.email };
  }, bob.phone);
  console.log('A conta do Bob continua com o email original (não foi sequestrada por um socket sem sessão real):', bobLoginCheck.ok && bobLoginCheck.email === bob.email);

  // Repõe o login real da Alice na própria página (o ataque acima confundiu
  // o socket dela) antes de continuar com o resto do teste.
  await alice.page.evaluate(() => socket.emit('user_login', { name: APP.user.name, phone: APP.user.phone, token: APP.token }));

  // ==================== 2) XSS ARMAZENADO (nome de conta) ====================
  const xssPayload = '<img src=x onerror="window.__xss_fired = true">';
  const victim = await registerUser(browser, 'XssVictim');
  const attacker = await registerUser(browser, 'XssAttacker', xssPayload);

  // O atacante manda UMA mensagem normal ao alvo pela UI real — isto já
  // adiciona o atacante automaticamente aos contactos do alvo (ver
  // server.js, addContact em send_message), exatamente como aconteceria
  // com qualquer conta nova que manda um primeiro DM.
  await attacker.page.evaluate(() => openSearchUserModal());
  await attacker.page.fill('#searchUsernameInput', victim.username);
  await attacker.page.evaluate(() => doSearchUser());
  await attacker.page.waitForTimeout(500);
  await attacker.page.click('button:has-text("Iniciar conversa")');
  await attacker.page.waitForTimeout(500);
  await attacker.page.fill('#messageInput', 'primeira mensagem');
  await attacker.page.press('#messageInput', 'Enter');
  await attacker.page.waitForTimeout(300);
  // O atacante responde à própria mensagem — testa o segundo sink
  // confirmado (a citação de resposta, "replyTo.sender").
  await attacker.page.evaluate(() => {
    const msgs = APP.messages[APP.currentChatId] || [];
    const last = msgs[msgs.length - 1];
    APP.replyingTo = last ? { id: last.id, sender: APP.user.name, text: last.text } : null;
  });
  await attacker.page.fill('#messageInput', 'resposta à própria mensagem');
  await attacker.page.press('#messageInput', 'Enter');
  await attacker.page.waitForTimeout(700);

  // No lado da VÍTIMA (nunca abriu nada do atacante antes deste DM chegar):
  await victim.page.waitForTimeout(500);
  const chatListHtml = await victim.page.evaluate(() => document.getElementById('chatList')?.innerHTML || '');
  console.log('O payload malicioso NÃO executou no browser da vítima (onerror nunca disparou):', await victim.page.evaluate(() => window.__xss_fired !== true));
  console.log('O nome do atacante aparece ESCAPADO na lista de conversas (nunca como tag <img> real):', chatListHtml.includes('&lt;img') && !chatListHtml.includes('<img src=x onerror'));

  const dmChatId = await victim.page.evaluate((attackerPhone) => (APP.chats.find(c => c.phone === attackerPhone) || {}).id, attacker.phone);
  await victim.page.evaluate((chatId) => openChat(chatId), dmChatId);
  await victim.page.waitForTimeout(400);
  const msgAreaHtml = await victim.page.evaluate(() => document.getElementById('chatMessages')?.innerHTML || '');
  console.log('A citação de resposta também mostra o nome do atacante escapado (renderMessages, reply-quote):', msgAreaHtml.includes('&lt;img') && !msgAreaHtml.includes('<img src=x onerror'));
  console.log('Nenhum onerror chegou mesmo a executar (segunda confirmação, depois de ver a mensagem inteira):', await victim.page.evaluate(() => window.__xss_fired !== true));

  // ==================== 3) e 4) SSRF (news/read e link-preview c/ redirecionamento) ====================
  // "Alvo interno": um servidor local que nunca deveria ser alcançável a
  // partir de um pedido feito por outra pessoa através do proxy da app.
  const secretMarker = 'SEGREDO_INTERNO_' + Date.now();
  const internalServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><head><title>${secretMarker}</title></head><body>conteúdo interno</body></html>`);
  });
  await new Promise((resolve) => internalServer.listen(0, '127.0.0.1', resolve));
  const internalPort = internalServer.address().port;
  const internalUrl = `http://127.0.0.1:${internalPort}/`;

  // 3) /api/news/read — pedido direto a um endereço privado.
  const newsReadResult = await alice.page.evaluate(async (url) => {
    const r = await fetch('/api/news/read?url=' + encodeURIComponent(url));
    return r.json();
  }, internalUrl);
  console.log('/api/news/read RECUSA um endereço privado/interno (nunca lê o conteúdo):', newsReadResult.success === false);

  // 4) /api/link-preview — pedido direto a um endereço privado (proteção de base).
  const linkPreviewDirect = await alice.page.evaluate(async (url) => {
    const r = await fetch('/api/link-preview?url=' + encodeURIComponent(url));
    return r.json();
  }, internalUrl);
  console.log('/api/link-preview RECUSA um endereço privado/interno diretamente (sem título/descrição):', !linkPreviewDirect.title && !linkPreviewDirect.description);

  // 4b) O CASO REAL da auditoria: um endereço que PASSA a validação inicial
  // (não é privado — usa o próprio endereço de rede deste contentor, fora
  // dos intervalos bloqueados) mas responde com um REDIRECIONAMENTO HTTP
  // para o endereço interno acima. Antes da correção, `redirect: 'follow'`
  // seguia isto às cegas; agora cada salto é validado.
  let hopHost = null;
  const nets = os.networkInterfaces();
  for (const ifaceName of Object.keys(nets)) {
    for (const addr of nets[ifaceName]) {
      if (addr.family === 'IPv4' && addr.address !== '127.0.0.1') hopHost = addr.address;
    }
  }
  if (hopHost) {
    const hopServer = http.createServer((req, res) => {
      res.statusCode = 302;
      res.setHeader('Location', internalUrl);
      res.end();
    });
    await new Promise((resolve) => hopServer.listen(0, hopHost, resolve));
    const hopPort = hopServer.address().port;
    const redirectUrl = `http://${hopHost}:${hopPort}/`;
    const redirectBypassResult = await alice.page.evaluate(async (url) => {
      const r = await fetch('/api/link-preview?url=' + encodeURIComponent(url));
      return r.json();
    }, redirectUrl);
    console.log('/api/link-preview RECUSA quando um endereço válido redireciona para um endereço interno (não segue às cegas):', !redirectBypassResult.title && !redirectBypassResult.description);
    hopServer.close();
  } else {
    console.log('(salto de redirecionamento não testado — este contentor não tem um endereço de rede utilizável para simular um "endereço público")');
  }

  internalServer.close();

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
