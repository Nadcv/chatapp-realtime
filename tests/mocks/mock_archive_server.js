// Mock do Internet Archive (archive.org) — usado por /api/library/archive no
// server.js para a segunda fonte de livros da Biblioteca, independente do
// Gutendex. Simula os 3 endpoints reais usados: /advancedsearch.php (lista),
// /metadata/{identifier} (ficheiros disponíveis) e /download/{identifier}/{nome}
// (o ficheiro em si) — serve mesmo um EPUB válido (construído com adm-zip,
// já uma dependência do projeto), tal como o mock do Gutendex.
const http = require('http');
const url = require('url');
const AdmZip = require('adm-zip');

const BOOKS = [
  { identifier: 'os-maias-archive', title: 'Os Maias', creator: 'Eça de Queirós' },
  { identifier: 'iracema-archive', title: 'Iracema', creator: 'José de Alencar' }
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
    `<body><h1>${title}</h1><p>Conteúdo de teste do mock do Internet Archive.</p></body></html>`
  ));
  return zip.toBuffer();
}

http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/advancedsearch.php') {
    const q = String(parsed.query.q || '').toLowerCase();
    // O "identifier" sem EPUB nenhum disponível — testa o caminho de erro
    // "Este livro não tem um EPUB disponível" do proxy do ficheiro.
    // O server.js só põe o termo pesquisado entre parênteses (ver
    // "(${search}) AND mediatype:..." em /api/library/archive); sem pesquisa,
    // a query é só os filtros fixos (mediatype/language/format), sem
    // parênteses — por isso "termo" fica vazio e mostra a lista toda.
    const termMatch = q.match(/^\(([^)]*)\)/);
    const term = termMatch ? termMatch[1] : '';
    const results = BOOKS.filter((b) => !term || b.title.toLowerCase().includes(term) || b.creator.toLowerCase().includes(term));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ response: { docs: results.map((b) => ({ identifier: b.identifier, title: b.title, creator: b.creator })) } }));
    return;
  }

  const metaMatch = parsed.pathname.match(/^\/metadata\/(.+)$/);
  if (metaMatch) {
    const identifier = decodeURIComponent(metaMatch[1]);
    res.setHeader('Content-Type', 'application/json');
    if (identifier === 'sem-epub-archive') {
      res.end(JSON.stringify({ files: [{ name: 'capa.jpg', format: 'JPEG' }] }));
      return;
    }
    const book = BOOKS.find((b) => b.identifier === identifier);
    if (!book) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.end(JSON.stringify({ files: [{ name: identifier + '.epub', format: 'EPUB' }] }));
    return;
  }

  const downloadMatch = parsed.pathname.match(/^\/download\/([^/]+)\/(.+)$/);
  if (downloadMatch) {
    const identifier = decodeURIComponent(downloadMatch[1]);
    const book = BOOKS.find((b) => b.identifier === identifier);
    res.setHeader('Content-Type', 'application/epub+zip');
    res.end(buildMinimalEpub(book ? book.title : 'Livro de teste'));
    return;
  }

  res.statusCode = 404;
  res.end('not found');
}).listen(3025);
