// Nova aba "📚 Biblioteca" (Mais funcionalidades): lista livros de domínio
// público via Project Gutenberg (indexados pelo Gutendex, através de
// /api/library/gutenberg no servidor — nunca diretamente do browser, tal
// como as outras integrações externas desta app) e permite ler qualquer
// EPUB próprio. Este teste usa um mock local do Gutendex (porta 3024) em
// vez do serviço real. O mock não serve bytes de EPUB reais (só devolve a
// mesma lista JSON em qualquer caminho), por isso não testamos ler um livro
// até ao fim — testamos o que É verificável sem isso: a lista carrega
// corretamente do servidor, clicar num livro transita para o leitor e trata
// um EPUB inválido/inacessível de forma amigável (sem crashar), e "Voltar à
// lista" funciona.
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

  await page.click('button:has-text("Carregar livros gratuitos")');
  await page.waitForFunction(() => document.getElementById('libraryBookList').children.length > 0, { timeout: 8000 }).catch(() => {});

  const bookTitles = await page.evaluate(() => [...document.querySelectorAll('#libraryBookList h4')].map(h => h.textContent));
  console.log('A lista mostra o livro "Os Lusíadas":', bookTitles.includes('Os Lusíadas'));
  console.log('A lista mostra o livro "O Primo Basílio":', bookTitles.includes('O Primo Basílio'));

  const bookAuthors = await page.evaluate(() => [...document.querySelectorAll('#libraryBookList p')].map(p => p.textContent));
  console.log('Mostra o autor correto ("Luís de Camões"):', bookAuthors.includes('Luís de Camões'));

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
