// Mock do Numverify (apilayer.net/api/validate) — primeiro provedor da
// cascata de validação de telemóvel (ver PHONE_VALIDATION_PROVIDERS no
// server.js) — para testar sem gastar o plano gratuito real nem depender da
// rede. Por omissão responde "válido" para qualquer número (a maioria dos
// testes da suite regista contas com números inventados mas com formato
// normal, e não devem ser bloqueados por isto) — só os casos de teste
// específicos abaixo simulam "inválido" ou "sem quota".
const http = require('http');
const url = require('url');

http.createServer((req, res) => {
  const { query } = url.parse(req.url, true);
  const number = query.number || '';
  res.setHeader('Content-Type', 'application/json');

  if (number.includes('000000000')) {
    res.end(JSON.stringify({ valid: false, number, country_name: null, carrier: null, line_type: null }));
    return;
  }
  if (number.includes('111111111') || number.includes('222222222')) {
    // Simula "sem quota" — o servidor deve passar ao próximo provedor da
    // cascata (Veriphone), nunca tratar isto como "número inválido".
    res.end(JSON.stringify({ success: false, error: { code: 104, type: 'usage_limit_reached', info: 'Limite mensal atingido.' } }));
    return;
  }

  res.end(JSON.stringify({
    valid: true,
    number,
    local_format: number.replace(/^\+\d{1,3}/, ''),
    international_format: number,
    country_prefix: '+351',
    country_code: 'PT',
    country_name: 'Portugal',
    location: '',
    carrier: 'MEO',
    line_type: 'mobile'
  }));
}).listen(3021);
