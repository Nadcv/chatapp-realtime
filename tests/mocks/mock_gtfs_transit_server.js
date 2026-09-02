const http = require('http');
const fs = require('fs');
const path = require('path');

const zipPath = path.join(__dirname, 'mock_gtfs_transit.zip');
http.createServer((req, res) => {
  if (req.url.startsWith('/gtfs_transit.zip')) {
    const buf = fs.readFileSync(zipPath);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
    res.end(buf);
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3015, () => console.log('mock GTFS (comboios em trânsito) server on :3015'));
