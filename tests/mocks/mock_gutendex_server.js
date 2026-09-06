// Mock do Gutendex (gutendex.com) — usado por /api/library/gutenberg no
// server.js para listar livros de domínio público em português com EPUB
// disponível, e por /api/library/gutenberg/file (proxy que descarrega o
// ficheiro em si) para testar a leitura de verdade — por isso este mock
// serve mesmo um EPUB válido (construído com adm-zip, já uma dependência do
// projeto) nos caminhos /books/*.epub, ao contrário de um JSON qualquer.
const http = require('http');
const url = require('url');
const AdmZip = require('adm-zip');

const BOOKS = [
  { id: 1001, title: 'Os Lusíadas', authors: [{ name: 'Luís de Camões' }] },
  { id: 1002, title: 'O Primo Basílio', authors: [{ name: 'Eça de Queirós' }] }
];

function buildMinimalEpub(title) {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from(
    '<?xml version="1.0"?>\n' +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
    '</container>'
  ));
  zip.addFile('OEBPS/content.opf', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">' +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title>` +
    '<dc:language>pt</dc:language><dc:identifier id="BookId">urn:uuid:mock-book</dc:identifier></metadata>' +
    '<manifest><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>' +
    '<spine toc="ncx"><itemref idref="chapter1"/></spine></package>'
  ));
  zip.addFile('OEBPS/toc.ncx', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
    '<head><meta name="dtb:uid" content="urn:uuid:mock-book"/></head>' +
    `<docTitle><text>${title}</text></docTitle>` +
    '<navMap><navPoint id="navpoint-1" playOrder="1"><navLabel><text>Capítulo 1</text></navLabel>' +
    '<content src="chapter1.xhtml"/></navPoint></navMap></ncx>'
  ));
  zip.addFile('OEBPS/chapter1.xhtml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capítulo 1</title></head>' +
    `<body><h1>${title}</h1><p>Conteúdo de teste do mock do Gutendex.</p></body></html>`
  ));
  return zip.toBuffer();
}

http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // Simula o Project Gutenberg a devolver uma página de aviso/limite de
  // pedidos em HTML com estado 200 (em vez de um EPUB real) — testa que o
  // proxy do servidor deteta isto pela assinatura ZIP e não confia
  // cegamente no Content-Type/estado HTTP.
  if (parsed.pathname === '/books/ratelimited.epub') {
    res.setHeader('Content-Type', 'application/epub+zip'); // mesmo Content-Type — o corpo é que não é mesmo um ZIP
    res.end('<html><body>Too many requests, please try again later.</body></html>');
    return;
  }

  const epubMatch = parsed.pathname.match(/^\/books\/(\d+)\.epub$/);
  if (epubMatch) {
    const book = BOOKS.find((b) => String(b.id) === epubMatch[1]);
    res.setHeader('Content-Type', 'application/epub+zip');
    res.end(buildMinimalEpub(book ? book.title : 'Livro de teste'));
    return;
  }

  // Simula o Gutendex indisponível (já aconteceu em produção: HTTP 503) —
  // testa que o servidor cai para a lista de reserva em vez de deixar a
  // Biblioteca vazia.
  const search = (parsed.query.search || '').toLowerCase();
  if (search === 'trigger503') {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Service Unavailable');
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  const results = search
    ? BOOKS.filter((b) => b.title.toLowerCase().includes(search) || b.authors[0].name.toLowerCase().includes(search))
    : BOOKS;
  res.end(JSON.stringify({
    count: results.length,
    results: results.map((b) => ({
      id: b.id,
      title: b.title,
      authors: b.authors,
      formats: { 'application/epub+zip': `http://localhost:3024/books/${b.id}.epub` }
    }))
  }));
}).listen(3024);
