const http = require('http');
const fs = require('fs');
const path = require('path');

const files = {
  '/emt_valencia.zip': 'mock_emt_valencia.zip',
  '/metro_valencia.zip': 'mock_metro_valencia.zip'
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
}).listen(3018, () => console.log('mock Valencia server on :3018'));
