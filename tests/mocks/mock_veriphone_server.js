// Mock do Veriphone (api.veriphone.io/v2/verify) — segundo provedor da
// cascata de validação de telemóvel (ver PHONE_VALIDATION_PROVIDERS no
// server.js). Só é consultado quando o Numverify está sem quota/indisponível.
const http = require('http');
const url = require('url');

http.createServer((req, res) => {
  const { query } = url.parse(req.url, true);
  const phone = query.phone || '';
  res.setHeader('Content-Type', 'application/json');

  if (phone.includes('111111111')) {
    // Também sem quota — usado para testar a cascata completa esgotada
    // (Numverify + Veriphone + AbstractAPI todos indisponíveis => o registo
    // não é bloqueado).
    res.end(JSON.stringify({ status: 'error', error: 'Reached API request quota, upgrade your subscription.' }));
    return;
  }
  if (phone.includes('222222222')) {
    // Resposta definitiva "inválido" — testa que a cascata usa a decisão
    // deste 2º provedor (depois do Numverify ficar sem quota) sem chegar a
    // consultar o AbstractAPI.
    res.end(JSON.stringify({ status: 'success', phone_valid: false, phone_type: null, phone_region: null, country: null, carrier: null }));
    return;
  }

  res.end(JSON.stringify({
    status: 'success',
    phone_valid: true,
    phone_type: 'mobile',
    phone_region: 'Lisboa',
    country: 'Portugal',
    country_code: 'PT',
    carrier: 'MEO',
    international_number: phone,
    local_number: phone
  }));
}).listen(3022);
