// Nova aba "📚 Biblioteca" (Mais funcionalidades): lista livros de domínio
// público via Project Gutenberg (indexados pelo Gutendex, através de
// /api/library/gutenberg no servidor — nunca diretamente do browser, tal
// como as outras integrações externas desta app) e permite ler qualquer
// EPUB próprio. O FICHEIRO em si também passa pelo servidor
// (/api/library/gutenberg/file), com uma allowlist anti-SSRF (só aceita URLs
// do Project Gutenberg ou de GUTENDEX_API_BASE) — sem isto, o leitor
// dependia de o gutenberg.org enviar CORS correto para este domínio, o que
// deixava o ecrã do leitor em branco, sem erro nenhum, quando isso falhava.
//
// Este teste usa um mock local do Gutendex (porta 3024, com um EPUB válido
// de verdade construído com adm-zip — ver tests/mocks/mock_gutendex_server.js)
// e verifica: a lista carrega da API real com a pesquisa por título/autor, o
// proxy do ficheiro devolve mesmo os bytes do EPUB (prova de que o CORS do
// gutenberg.org deixou de ser um problema) mas RECUSA URLs fora da
// allowlist (SSRF), e a interface trata um EPUB inacessível de forma
// amigável em vez de crashar (a biblioteca epub.js em si não carrega neste
// sandbox — o CDN jsdelivr está bloqueado pelo proxy de saída — por isso não
// dá para testar a página do livro a aparecer de verdade aqui).
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Library Test');
  await page.fill('#regUsername', 'library_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'library' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => openLibraryScreen());
  const screenOpen = await page.evaluate(() => document.getElementById('libraryScreen').classList.contains('active'));
  console.log('O ecrã da Biblioteca abre:', screenOpen);

  await page.click('button:has-text("Ver lista de livros gratuitos")');
  await page.waitForFunction(() => document.getElementById('libraryBookList').children.length > 0, { timeout: 8000 }).catch(() => {});

  const bookTitles = await page.evaluate(() => [...document.querySelectorAll('#libraryBookList h4')].map(h => h.textContent));
  console.log('A lista mostra o livro "Os Lusíadas":', bookTitles.includes('Os Lusíadas'));
  console.log('A lista mostra o livro "O Primo Basílio":', bookTitles.includes('O Primo Basílio'));

  const bookAuthors = await page.evaluate(() => [...document.querySelectorAll('#libraryBookList p')].map(p => p.textContent));
  console.log('Mostra o autor correto ("Luís de Camões"):', bookAuthors.includes('Luís de Camões'));

  // --- Pesquisa por título/autor (novo campo) ---
  await page.fill('#librarySearchInput', 'Eça de Queirós');
  await page.click('button[onclick="doLibrarySearch()"]');
  await page.waitForFunction(() => document.getElementById('libraryBookList').children.length > 0, { timeout: 8000 }).catch(() => {});
  const searchTitles = await page.evaluate(() => [...document.querySelectorAll('#libraryBookList h4')].map(h => h.textContent));
  console.log('Pesquisar "Eça de Queirós" mostra só "O Primo Basílio":', searchTitles.length === 1 && searchTitles.includes('O Primo Basílio'));

  // --- Proxy do ficheiro EPUB: devolve mesmo os bytes (prova que o CORS do
  // gutenberg.org deixou de ser um problema), e recusa URLs fora da
  // allowlist (nunca vira um proxy aberto/SSRF). Testado diretamente via
  // fetch, sem depender de o epub.js estar carregado.
  const fileProxyResult = await page.evaluate(async () => {
    const r = await fetch('/api/library/gutenberg/file?url=' + encodeURIComponent('http://localhost:3024/books/1001.epub'));
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf.slice(0, 2));
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // assinatura "PK" de um ficheiro ZIP/EPUB
    return { ok: r.ok, isZip, contentType: r.headers.get('content-type') };
  });
  console.log('O proxy do ficheiro devolve mesmo os bytes de um EPUB válido (assinatura ZIP "PK"):', fileProxyResult.ok && fileProxyResult.isZip);
  console.log('O proxy do ficheiro devolve o Content-Type correto:', (fileProxyResult.contentType || '').includes('epub'));

  const ssrfBlocked = await page.evaluate(async () => {
    const r = await fetch('/api/library/gutenberg/file?url=' + encodeURIComponent('http://127.0.0.1:3000/api/admin/users'));
    return r.status;
  });
  console.log('O proxy do ficheiro RECUSA um URL fora do Project Gutenberg (não é um SSRF aberto):', ssrfBlocked === 400);

  // O Gutenberg às vezes devolve uma página de aviso/limite de pedidos em
  // HTML com estado 200 em vez do EPUB real — o proxy tem de detetar isto
  // pela assinatura ZIP, não confiar cegamente no HTTP 200/Content-Type.
  const rateLimitedResult = await page.evaluate(async () => {
    const r = await fetch('/api/library/gutenberg/file?url=' + encodeURIComponent('http://localhost:3024/books/ratelimited.epub'));
    const data = await r.json().catch(() => null);
    return { status: r.status, error: data?.error };
  });
  console.log('O proxy recusa um "EPUB" que na verdade é uma página HTML (200 mas não é ZIP):', rateLimitedResult.status === 502 && !!rateLimitedResult.error);

  // Clica no primeiro livro — o mock não serve um EPUB real, por isso deve
  // mostrar o aviso amigável em vez de crashar ou ficar preso a "carregar".
  await page.click('#libraryBookList > div:first-child');
  const listHidden = await page.waitForFunction(() => document.getElementById('libraryListView').style.display === 'none', { timeout: 3000 }).then(() => true).catch(() => false);
  console.log('Clicar num livro esconde a lista e mostra o leitor:', listHidden);

  await page.waitForFunction(() => document.getElementById('libraryReaderContent').textContent.includes('Não foi possível abrir'), { timeout: 8000 }).catch(() => {});
  const friendlyError = await page.evaluate(() => document.getElementById('libraryReaderContent').textContent.includes('Não foi possível abrir'));
  console.log('Um "EPUB" inválido/inacessível mostra um aviso amigável (não crasha a app):', friendlyError);

  await page.click('button:has-text("Voltar à lista")');
  const backToList = await page.evaluate(() => document.getElementById('libraryListView').style.display !== 'none' && document.getElementById('libraryReader').style.display === 'none');
  console.log('"Voltar à lista" funciona corretamente:', backToList);

  // Upload de um ficheiro que não é um EPUB válido — mesmo caminho de erro,
  // mas por um percurso de código diferente (leitura de ficheiro local em
  // vez do fetch do Gutendex), prova que o wiring do upload também funciona.
  const filePath = '/tmp/claude-0/-home-user-chatapp-realtime/905ed831-e796-5cad-a515-875787df2ff2/scratchpad/fake_not_epub.txt';
  require('fs').writeFileSync(filePath, 'isto não é um ficheiro epub');
  await page.setInputFiles('#libraryFileInput', filePath);
  await page.waitForFunction(() => document.getElementById('libraryListView').style.display === 'none', { timeout: 3000 }).catch(() => {});
  await page.waitForFunction(() => document.getElementById('libraryReaderContent').textContent.includes('Não foi possível abrir'), { timeout: 8000 }).catch(() => {});
  const uploadFriendlyError = await page.evaluate(() => document.getElementById('libraryReaderContent').textContent.includes('Não foi possível abrir'));
  console.log('Fazer upload de um ficheiro inválido também mostra o aviso amigável:', uploadFriendlyError);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
