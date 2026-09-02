const http = require('http');
let tokenCallCount = 0;
let statusCallCount = 0;
http.createServer((req, res) => {
  if (req.url === '/token' && req.method === 'POST') {
    tokenCallCount++;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const auth = req.headers['authorization'] || '';
      if (!auth.startsWith('Basic ')) { res.writeHead(401); return res.end('{"error":"no basic auth"}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'mocktoken_' + tokenCallCount, expires_in: 2 }));
    });
    return;
  }
  if (req.url === '/estadoServicoML/1.0.1/estadoLinha/todos') {
    statusCallCount++;
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer mocktoken_')) { res.writeHead(401); return res.end('{"error":"bad token"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      codigo: '200',
      resposta: {
        azul: 'Serviço Normal', tipo_msg_az: 0,
        amarela: 'Circulação Perturbada', tipo_msg_am: 1,
        vermelha: 'Serviço Normal', tipo_msg_vm: 0,
        verde: 'Serviço Normal', tipo_msg_vd: 0
      }
    }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3004, () => console.log('mock metro server on :3004, tokenCalls=' + tokenCallCount));
