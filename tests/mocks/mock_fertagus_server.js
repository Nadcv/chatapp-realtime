const http = require('http');
const fs = require('fs');
const path = require('path');

const zipPath = path.join(__dirname, 'mock_fertagus_gtfs.zip');
http.createServer((req, res) => {
  if (req.url.startsWith('/gtfs_fertagus.zip')) {
    const buf = fs.readFileSync(zipPath);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
    res.end(buf);
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3016, () => console.log('mock Fertagus server on :3016'));
