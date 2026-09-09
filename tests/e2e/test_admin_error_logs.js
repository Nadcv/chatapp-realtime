const { chromium } = require('playwright');

// Painel de logs de erro para o administrador (/api/admin/logs +
// RECENT_ERROR_LOGS no server.js) — antes disto, diagnosticar um problema em
// produção dependia inteiramente de a pessoa enviar um screenshot da
// mensagem de erro; o servidor não guardava os seus próprios erros nenhures
// visíveis. Agora as últimas ~200 chamadas a console.error ficam num buffer
// em memória, e só o administrador consegue vê-las (mesmo padrão de
// autenticação de /api/admin/users: token de sessão + isAdminPhone).
//
// Para gerar um erro real e determinístico sem depender de rede externa,
// este teste usa o mesmo caminho já validado em test_library_epub.js: o mock
// local do Gutendex (porta 3024) tem um ficheiro "ratelimited.epub" que
// devolve HTML com Content-Type de EPUB — o proxy do servidor deteta isto
// pela assinatura ZIP e chama console.error(), o que é exatamente o que
// queremos capturar aqui.
const ADMIN_SECRET = process.env.ADMIN_SIGNUP_SECRET || 'segredo-teste-123';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch:has-text("Área do administrador")');
  await page.waitForSelector('#modalAdminRegister.active');
  const ts = Date.now();
  await page.fill('#adminRegName', 'Logs Admin');
  await page.fill('#adminRegUsername', 'logsadmin_' + ts);
  await page.fill('#adminRegPhone', '+3513' + ts.toString().slice(-8));
  await page.selectOption('#adminRegCountry', 'Portugal');
  await page.fill('#adminRegEmail', 'logsadmin' + ts + '@test.com');
  await page.fill('#adminRegPassword', 'senha1234forte');
  await page.fill('#adminRegSecret', ADMIN_SECRET);
  await page.click('#modalAdminRegister button:has-text("Criar conta de administrador")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Gera um erro real e determinístico do lado do servidor.
  const marker = 'marker_' + ts;
  const proxyResult = await page.evaluate(async () => {
    const r = await fetch('/api/library/gutenberg/file?url=' + encodeURIComponent('http://localhost:3024/books/ratelimited.epub'));
    return r.status;
  });
  console.log('O pedido que gera o erro de teste devolve 502 (comportamento já esperado):', proxyResult === 502);

  await page.evaluate(() => openAdminModal());
  await page.waitForSelector('#modalAdmin.active', { timeout: 3000 });

  await page.click('button[onclick="openAdminLogsModal()"]');
  await page.waitForSelector('#modalAdminLogs.active', { timeout: 3000 });
  await page.waitForFunction(() => document.getElementById('adminLogsBody').textContent.includes('ZIP/EPUB'), { timeout: 8000 }).catch(() => {});

  const logsShowTheError = await page.evaluate(() => document.getElementById('adminLogsBody').textContent.includes('ZIP/EPUB'));
  console.log('O painel de logs do admin mostra o erro real gerado (não um screenshot, o log a sério):', logsShowTheError);

  const logsAreOrderedNewestFirst = await page.evaluate(() => {
    const times = [...document.querySelectorAll('#adminLogsBody [data-iso-time]')].slice(0, 2).map(d => d.dataset.isoTime);
    return times.length < 2 || new Date(times[0]) >= new Date(times[1]);
  });
  console.log('Os logs vêm ordenados do mais recente para o mais antigo:', logsAreOrderedNewestFirst);

  // Acesso direto à API sem sessão válida (ou com uma conta sem ser admin)
  // tem de ser recusado — isto nunca pode ficar acessível a qualquer pessoa.
  const unauthorizedStatus = await page.evaluate(async () => {
    const r = await fetch('/api/admin/logs?token=isto-nao-e-um-token-valido');
    return r.status;
  });
  console.log('O endpoint de logs recusa um token inválido/sem sessão:', unauthorizedStatus === 403);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
