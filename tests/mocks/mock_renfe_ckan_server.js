const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Simula o portal CKAN da Renfe (data.renfe.com): package_show devolve os
// recursos do dataset pedido (por "id"), depois o servidor descarrega o
// recurso .zip certo — tal como o mock da GIRA, mas com dois datasets.
const DATASETS = {
  'horarios-cercanias': { resourceUrl: 'http://localhost:3019/renfe_cercanias.zip', format: 'GTFS' },
  'horarios-de-alta-velocidad-larga-distancia-y-media-distancia': { resourceUrl: 'http://localhost:3019/renfe_ave.zip', format: 'GTFS' }
};
const FILES = {
  '/renfe_cercanias.zip': 'mock_renfe_cercanias.zip',
  '/renfe_ave.zip': 'mock_renfe_ave.zip'
};

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/3/action/package_show') {
    const id = u.searchParams.get('id');
    const dataset = DATASETS[id];
    if (!dataset) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, result: { id, resources: [{ id: 'res-1', format: dataset.format, url: dataset.resourceUrl }] } }));
    return;
  }
  const filename = FILES[u.pathname];
  if (filename) {
    const buf = fs.readFileSync(path.join(__dirname, filename));
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
    res.end(buf);
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3019, () => console.log('mock Renfe CKAN server on :3019'));
