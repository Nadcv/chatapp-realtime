const http = require('http');
const fs = require('fs');
// Ficheiro GTFS real da GUIMABUS (dados abertos, sem informação sensível),
// guardado como fixture do projeto em vez de depender de um upload da sessão.
const zipPath = __dirname + '/fixtures/guimaraes_gtfs.zip';
http.createServer((req, res) => {
  const buf = fs.readFileSync(zipPath);
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
  res.end(buf);
}).listen(3005, () => console.log('mock guimaraes gtfs server on :3005'));
