// Mock do AbstractAPI Phone Validation — terceiro e último provedor da
// cascata de validação de telemóvel (ver PHONE_VALIDATION_PROVIDERS no
// server.js). Só é consultado quando os dois provedores anteriores estão
// sem quota/indisponíveis.
const http = require('http');
const url = require('url');

http.createServer((req, res) => {
  const { query } = url.parse(req.url, true);
  const phone = query.phone || '';
  res.setHeader('Content-Type', 'application/json');

  if (phone.includes('111111111')) {
    // Último elo da cascata também sem quota — com os três provedores
    // indisponíveis, o servidor deve deixar o registo seguir em frente
    // (falha aberta, nunca bloqueia por não conseguir validar).
    res.end(JSON.stringify({ error: { type: 'quota_exceeded', message: 'Monthly quota exceeded.' } }));
    return;
  }

  res.end(JSON.stringify({
    phone,
    valid: true,
    format: { international: phone, local: phone },
    country: { name: 'Portugal', code: 'PT', prefix: '+351' },
    location: '',
    type: 'mobile',
    carrier: 'MEO'
  }));
}).listen(3023);
