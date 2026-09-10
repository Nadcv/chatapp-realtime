// Mock do Resend (resend.com) — usado por sendAppEmail() no server.js como
// via principal de envio de email (API HTTPS), em vez do SMTP direto que
// falha com "Connection timeout" quando o servidor está hospedado numa
// plataforma na nuvem (a Google e outros provedores bloqueiam/ignoram
// ligações SMTP vindas de gamas de IP de alojamento, como prevenção de spam).
//
// Simula /emails: recusa sem "Authorization: Bearer ..." correto (mesmo
// comportamento da API real), e devolve um erro 500 quando o destinatário é
// "falha@resend-mock.test" — para testar que sendAppEmail() cai para o SMTP
// a seguir, em vez de desistir logo. Guarda um histórico dos emails
// "enviados" com o mesmo formato do inspetor do fake_smtp.js (GET /?to=...
// devolve {lastMessage}), para os testes poderem reutilizar exatamente os
// mesmos ajudantes (getLastEmail/extractCode) que já usam com o SMTP falso.
const http = require('http');
const { URL } = require('url');

const MAX_HISTORY = 50;
const messages = []; // { to, body }, oldest first

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'GET') {
    const to = u.searchParams.get('to');
    let lastMessage = null;
    if (to) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].to.toLowerCase() === to.toLowerCase()) { lastMessage = messages[i].body; break; }
      }
    } else if (messages.length) {
      lastMessage = messages[messages.length - 1].body;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ lastMessage }));
    return;
  }
  if (req.method !== 'POST' || u.pathname !== '/emails') {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ') || auth.slice(7).length === 0) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Chave de API inválida.' }));
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) { parsed = {}; }
    if (parsed.to === 'falha@resend-mock.test') {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: 'Erro simulado do Resend, para testar o recuo para o SMTP.' }));
      return;
    }
    messages.push({ to: parsed.to || '', body: `${parsed.subject || ''}\n${parsed.text || ''}\n${parsed.html || ''}` });
    if (messages.length > MAX_HISTORY) messages.shift();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'mock-resend-id-' + Date.now() }));
  });
}).listen(3026);
