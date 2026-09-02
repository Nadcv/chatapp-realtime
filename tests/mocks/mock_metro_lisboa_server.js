const http = require('http');
const fs = require('fs');
http.createServer((req, res) => {
  const buf = fs.readFileSync(__dirname + '/mock_metro_lisboa.zip');
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
  res.end(buf);
}).listen(3008, () => console.log('mock metro lisboa gtfs server on :3008'));
