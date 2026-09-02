const http = require('http');
const fs = require('fs');
const path = require('path');

const zipPath = path.join(__dirname, 'mock_gtfs_planner.zip');
http.createServer((req, res) => {
  if (req.url.startsWith('/gtfs_planner.zip')) {
    const buf = fs.readFileSync(zipPath);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
    res.end(buf);
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3013, () => console.log('mock GTFS (planner) server on :3013'));
