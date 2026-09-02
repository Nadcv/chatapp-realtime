const http = require('http');
const fs = require('fs');
// Dados sintéticos (ver build_mock_guimaraes_gtfs.js) — um excerto real da
// GUIMABUS tem horários fixos do dia e fica sem partidas a certas horas,
// tornando os testes de "próxima partida" instáveis consoante a hora do dia.
const zipPath = __dirname + '/mock_guimaraes.zip';
http.createServer((req, res) => {
  const buf = fs.readFileSync(zipPath);
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
  res.end(buf);
}).listen(3005, () => console.log('mock guimaraes gtfs server on :3005'));
