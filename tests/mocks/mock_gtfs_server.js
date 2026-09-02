const http = require('http');
const fs = require('fs');
const path = require('path');

const zipPath = path.join(__dirname, 'mock_gtfs.zip');
http.createServer((req, res) => {
  if (req.url.startsWith('/gtfs_cp.zip')) {
    const buf = fs.readFileSync(zipPath);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
    res.end(buf);
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3002, () => console.log('mock GTFS server on :3002'));
