// Gemini falso (porta 3029) para os testes: responde no formato real do
// generateContent. Pedidos com áudio devolvem uma "transcrição"; pedidos em
// modo JSON (respostas sugeridas) devolvem um array com 3 respostas; o resto
// devolve uma resposta de texto. Guarda o último pedido em GET /last.
const http = require('http');
let last = null;
http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/last') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(last)); }
  let body = '';
  req.on('data', (c) => body += c);
  req.on('end', () => {
    let json = {};
    try { json = JSON.parse(body); } catch (e) {}
    last = { url: req.url, body: json };
    const parts = (json.contents || []).flatMap((c) => c.parts || []);
    const hasAudio = parts.some((p) => p.inline_data && /^audio\//.test(p.inline_data.mime_type));
    const wantsJson = json.generationConfig?.responseMimeType === 'application/json';
    let text = 'Olá! Sou o Gemini de teste.';
    if (hasAudio) text = 'Olá, chego daqui a dez minutos.';
    else if (wantsJson) text = JSON.stringify(['Combinado! 👍', 'Pode ser às 21h?', 'Hoje não dá, amanhã?']);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] }));
  });
}).listen(3029);
