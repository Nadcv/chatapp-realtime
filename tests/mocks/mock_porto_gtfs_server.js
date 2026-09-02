const http = require('http');
const fs = require('fs');
http.createServer((req, res) => {
  let file = null;
  if (req.url.startsWith('/metro.zip')) file = __dirname + '/mock_metro_porto.zip';
  else if (req.url.startsWith('/stcp.zip')) file = __dirname + '/mock_stcp.zip';
  if (!file) { res.writeHead(404); return res.end(); }
  const buf = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
  res.end(buf);
}).listen(3006, () => console.log('mock porto gtfs server on :3006'));
