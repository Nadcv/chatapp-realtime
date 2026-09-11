// Mock do Slack (slack.com) — usado pelos testes da ponte de mensagens com o
// Slack (ver server.js, secção "SLACK"). Cobre só o que o servidor real
// chama: /oauth/v2/authorize (redireciona logo com um código, tal como o
// mock do Google Calendar simula o consentimento automático),
// /api/oauth.v2.access (troca o código por um "bot token"),
// /api/chat.postMessage (guarda a mensagem — sentido app → Slack) e
// /api/users.info (nome de exibição — usado no sentido Slack → app).
//
// O sentido Slack → app em si NÃO passa por aqui — a Slack a sério manda o
// evento diretamente para o /api/slack/events do nosso próprio servidor
// (Events API), por isso é o teste que simula isso, assinando o pedido com
// o mesmo SLACK_SIGNING_SECRET de teste e chamando o servidor a sério.
const http = require('http');
const { URL } = require('url');

const PORT = 3028;
const postedMessages = []; // { channel, text, botToken }, mais recente por último
const FAKE_TEAM = { id: 'T0MOCKTEAM', name: 'Workspace de Teste' };

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}
function requireBearer(req, res) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ') || auth.slice(7).length === 0) {
    res.statusCode = 200; // a API real do Slack devolve sempre 200, com {ok:false} no corpo
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'not_authed' }));
    return false;
  }
  return true;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // ---- Endpoint só de testes: inspeciona as mensagens "postadas" no Slack. ----
  if (req.method === 'GET' && u.pathname === '/__test/messages') {
    const channel = u.searchParams.get('channel');
    const items = channel ? postedMessages.filter(m => m.channel === channel) : postedMessages;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ items }));
    return;
  }

  // ---- /oauth/v2/authorize: "ecrã de consentimento" (aqui, automático) ----
  if (req.method === 'GET' && u.pathname === '/oauth/v2/authorize') {
    const redirectUri = u.searchParams.get('redirect_uri');
    const state = u.searchParams.get('state');
    const dest = new URL(redirectUri);
    dest.searchParams.set('code', 'mock_slack_code_' + Date.now());
    dest.searchParams.set('state', state);
    res.statusCode = 302;
    res.setHeader('Location', dest.toString());
    res.end();
    return;
  }

  if (req.method === 'POST' && u.pathname === '/api/oauth.v2.access') {
    const body = new URLSearchParams(await readBody(req));
    if (!body.get('code')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'invalid_code' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, access_token: 'mock-bot-token-' + Date.now(), team: FAKE_TEAM }));
    return;
  }

  if (req.method === 'POST' && u.pathname === '/api/chat.postMessage') {
    if (!requireBearer(req, res)) return;
    const auth = req.headers['authorization'];
    const body = JSON.parse(await readBody(req) || '{}');
    if (body.channel === 'C_FALHA') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'channel_not_found' }));
      return;
    }
    postedMessages.push({ channel: body.channel, text: body.text, botToken: auth.slice(7) });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, ts: (Date.now() / 1000).toFixed(6) }));
    return;
  }

  if (req.method === 'GET' && u.pathname === '/api/users.info') {
    if (!requireBearer(req, res)) return;
    const userId = u.searchParams.get('user');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, user: { id: userId, name: userId, real_name: 'Utilizador Slack de Teste', profile: { display_name: 'Utilizador Slack de Teste' } } }));
    return;
  }

  res.statusCode = 404;
  res.end('not found');
}).listen(PORT);
