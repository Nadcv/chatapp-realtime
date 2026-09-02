const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Status ZIndex Test');
  await page.fill('#regUsername', 'statuszidx_' + ts);
  await page.fill('#regPhone', '+3512' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'statuszidx' + ts + '@test.com');
  await page.fill('#regPassword', 'senhaforte1234');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => openStatusScreen());
  await page.waitForSelector('#statusScreen.active', { timeout: 3000 });
  await page.click('#statusPanel .chat-item'); // "O meu estado" -> abre modalNewStatus (sem estado ainda)
  await page.waitForSelector('#modalNewStatus.active', { timeout: 3000 });

  // Regressão do mesmo bug já corrigido no Turismo: o modal tinha z-index
  // por defeito (20), mais baixo que o ecrã de Estados (100), por isso ficava
  // aberto mas escondido atrás dele até o ecrã de Estados ser fechado.
  const modalZIndex = await page.evaluate(() => parseInt(getComputedStyle(document.getElementById('modalNewStatus')).zIndex, 10));
  const screenZIndex = await page.evaluate(() => parseInt(getComputedStyle(document.getElementById('statusScreen')).zIndex, 10));
  console.log('The "Novo estado" modal has a higher z-index than the Estados screen behind it:', modalZIndex > screenZIndex);

  const topElementIsInsideModal = await page.evaluate(() => {
    const modal = document.getElementById('modalNewStatus');
    const rect = modal.getBoundingClientRect();
    const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 20);
    return modal.contains(el);
  });
  console.log('The topmost element at the modal\'s position is actually part of the modal (not hidden behind the Estados screen):', topElementIsInsideModal);

  // Confirma que o modal continua realmente funcional (não é só o z-index): escrever e publicar.
  await page.fill('#newStatusText', 'Teste de estado depois da correção');
  await page.click('button:has-text("Publicar")');
  await page.waitForTimeout(400);
  const modalClosedAfterPost = await page.evaluate(() => !document.getElementById('modalNewStatus').classList.contains('active'));
  console.log('Publishing a status closes the modal normally:', modalClosedAfterPost);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
