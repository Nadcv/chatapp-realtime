// Mock do Google (accounts.google.com + oauth2.googleapis.com +
// www.googleapis.com/calendar/v3) — tudo num único servidor, na porta 3027,
// para os testes de integração do Google Calendar (ver server.js, secção
// "GOOGLE CALENDAR") não dependerem de rede real nenhuma. Os três "hosts"
// reais viram três variáveis de ambiente distintas (GOOGLE_ACCOUNTS_BASE/
// GOOGLE_OAUTH_TOKEN_BASE/GOOGLE_CALENDAR_API_BASE) todas a apontar para
// aqui — o servidor não precisa de saber que, na vida real, são domínios
// diferentes.
//
// Simula um "consentimento" automático (sem ecrã de login nenhum): ao
// abrir /o/oauth2/v2/auth, redireciona logo para o redirect_uri com um
// código — o mesmo que aconteceria depois de uma pessoa a sério clicar
// "Aceitar" no ecrã da Google.
const http = require('http');
const { URL } = require('url');

const PORT = 3027;
let calendars = {}; // calendarId -> { summary, events: { eventId -> {summary, description, start, end} } }
let calendarSeq = 0;
let eventSeq = 0;

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
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'Token de acesso em falta ou inválido.' } }));
    return false;
  }
  return true;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // ---- Endpoint só de testes: inspeciona o estado atual (que calendários
  // existem, e que eventos têm) — os testes usam isto para confirmar que o
  // servidor real chamou mesmo a API do Google, sem ter de decifrar nada. ----
  if (req.method === 'GET' && u.pathname === '/__test/calendars') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(calendars));
    return;
  }

  // ---- Endpoint só de testes: injeta um evento "criado diretamente na
  // Google Calendar" (sem passar pelo nosso servidor), para testar o
  // sentido Google → app. ----
  if (req.method === 'POST' && u.pathname === '/__test/inject-event') {
    const body = JSON.parse(await readBody(req) || '{}');
    const cal = calendars[body.calendarId];
    if (!cal) { res.statusCode = 404; res.end('calendário desconhecido'); return; }
    const id = 'gev_injected_' + (++eventSeq);
    cal.events[id] = { summary: body.summary, description: body.description || '', start: { date: body.date }, end: { date: body.date }, status: 'confirmed' };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id }));
    return;
  }

  // ---- accounts.google.com: ecrã de consentimento (aqui, automático) ----
  if (req.method === 'GET' && u.pathname === '/o/oauth2/v2/auth') {
    const redirectUri = u.searchParams.get('redirect_uri');
    const state = u.searchParams.get('state');
    const code = 'mock_auth_code_' + Date.now();
    const dest = new URL(redirectUri);
    dest.searchParams.set('code', code);
    dest.searchParams.set('state', state);
    res.statusCode = 302;
    res.setHeader('Location', dest.toString());
    res.end();
    return;
  }

  // ---- oauth2.googleapis.com: troca de código/refresh_token por access_token ----
  if (req.method === 'POST' && u.pathname === '/token') {
    const body = new URLSearchParams(await readBody(req));
    const grantType = body.get('grant_type');
    if (grantType === 'authorization_code' && !body.get('code')) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'invalid_grant' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      access_token: 'mock_access_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      refresh_token: grantType === 'authorization_code' ? 'mock_refresh_' + Date.now() : undefined,
      expires_in: 3600
    }));
    return;
  }
  if (req.method === 'POST' && u.pathname === '/revoke') {
    res.statusCode = 200;
    res.end('{}');
    return;
  }

  // ---- www.googleapis.com/calendar/v3: calendários e eventos ----
  if (req.method === 'POST' && u.pathname === '/calendar/v3/calendars') {
    if (!requireBearer(req, res)) return;
    const body = JSON.parse(await readBody(req) || '{}');
    const id = 'cal_' + (++calendarSeq);
    calendars[id] = { summary: body.summary, events: {} };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id, summary: body.summary }));
    return;
  }
  const eventsMatch = u.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
  if (eventsMatch) {
    if (!requireBearer(req, res)) return;
    const calendarId = decodeURIComponent(eventsMatch[1]);
    const cal = calendars[calendarId];
    if (!cal) { res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'Calendário desconhecido.' } })); return; }
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const id = 'gev_' + (++eventSeq);
      cal.events[id] = { ...body, status: 'confirmed' };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id, ...body }));
      return;
    }
    if (req.method === 'GET') {
      const items = Object.entries(cal.events).map(([id, ev]) => ({ id, ...ev }));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ items }));
      return;
    }
  }
  const eventMatch = u.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/);
  if (eventMatch && req.method === 'DELETE') {
    if (!requireBearer(req, res)) return;
    const calendarId = decodeURIComponent(eventMatch[1]);
    const eventId = decodeURIComponent(eventMatch[2]);
    const cal = calendars[calendarId];
    if (!cal || !cal.events[eventId]) { res.statusCode = 410; res.end(JSON.stringify({ error: { message: 'Já não existe.' } })); return; }
    delete cal.events[eventId];
    res.statusCode = 204;
    res.end();
    return;
  }

  res.statusCode = 404;
  res.end('not found');
}).listen(PORT);
