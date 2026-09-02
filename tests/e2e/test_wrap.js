const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Wrap Teste');
  await page.fill('#regUsername', 'wrap_test_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'wraptest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('#mediaBtn');
  await page.click('#modalMediaFeatures button[onclick*="openTvScreen"]');
  await page.waitForSelector('#tvScreen.active');
  await page.waitForTimeout(500);

  // A fila de canais usa scroll horizontal por design (overflow-x:auto — ver
  // test_all_channels.js/test_tvs_scroll.js), não "wrap" — com 7 canais reais
  // (nomes completos), nem todos cabem de uma vez num ecrã de telemóvel de
  // 412px, e não seria suposto caberem. O que interessa aqui é que os
  // primeiros ficam visíveis sem precisar de deslizar, e nenhum fica cortado
  // a meio (todos com a largura completa, mesmo os que só aparecem ao deslizar).
  const names = ['Euronews (Português)', 'Euronews (Español)', 'France 24', 'TVS (site)', 'Record News', 'DW Español', 'El Doce'];
  let firstVisibleNoScroll = true;
  let noneClipped = true;
  for (const name of names) {
    const btn = page.locator('#tvTabs button', { hasText: name }).first();
    const box = await btn.boundingBox();
    const inViewportNoScroll = box && box.y < 915 && box.x >= 0 && box.x + box.width <= 412;
    if (name === 'Euronews (Português)' && !inViewportNoScroll) firstVisibleNoScroll = false;
    if (!box || box.width <= 0) noneClipped = false;
    console.log(name, '-> visible without any scroll:', inViewportNoScroll, box ? `x=${box.x.toFixed(0)} y=${box.y.toFixed(0)}` : 'no box');
  }
  console.log('O primeiro canal aparece logo, sem precisar de deslizar:', firstVisibleNoScroll);
  console.log('Nenhum botão de canal aparece cortado/com largura zero:', noneClipped);

  await page.screenshot({ path: __dirname + '/../output/tv_wrapped.png' });

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
