const http = require('http');
const fs = require('fs');
const path = require('path');

const files = {
  '/emt.zip': 'mock_emt_madrid.zip',
  '/metro.zip': 'mock_metro_madrid.zip',
  '/metro_ligero.zip': 'mock_metro_ligero_madrid.zip',
  '/cercanias.zip': 'mock_cercanias_madrid.zip'
};

http.createServer((req, res) => {
  const filename = files[req.url];
  if (filename) {
    const buf = fs.readFileSync(path.join(__dirname, filename));
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
    res.end(buf);
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3017, () => console.log('mock Madrid server on :3017'));
