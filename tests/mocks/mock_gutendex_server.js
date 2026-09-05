// Mock do Gutendex (gutendex.com) — usado por /api/library/gutenberg no
// server.js para listar livros de domínio público em português com EPUB
// disponível. Devolve sempre a mesma pequena lista fixa, no mesmo formato
// da API real (results[].formats['application/epub+zip']).
const http = require('http');

http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    count: 2,
    results: [
      {
        id: 1001,
        title: 'Os Lusíadas',
        authors: [{ name: 'Luís de Camões' }],
        formats: { 'application/epub+zip': 'http://localhost:3024/books/1001.epub' }
      },
      {
        id: 1002,
        title: 'O Primo Basílio',
        authors: [{ name: 'Eça de Queirós' }],
        formats: { 'application/epub+zip': 'http://localhost:3024/books/1002.epub' }
      }
    ]
  }));
}).listen(3024);
