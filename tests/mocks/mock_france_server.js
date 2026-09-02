const http = require('http');
const fs = require('fs');
const path = require('path');

const zipPath = path.join(__dirname, 'mock_france_gtfs.zip');
http.createServer((req, res) => {
  if (req.url.startsWith('/gtfs_france.zip')) {
    const buf = fs.readFileSync(zipPath);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
    res.end(buf);
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3020, () => console.log('mock França (Transilien) server on :3020'));
