const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Events Test');
  await page.fill('#regUsername', 'eventstest_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'eventstest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => openEventsScreen());
  await page.waitForTimeout(600);

  const listText = await page.evaluate(() => document.getElementById('eventsList').textContent);
  console.log('Mostra o evento "Vertigens":', listText.includes('Vertigens'));
  console.log('Mostra o local "Teatro São Luiz":', listText.includes('Teatro São Luiz'));
  console.log('Mostra as datas "12 a 20 de setembro":', listText.includes('12 a 20 de setembro'));
  console.log('Mostra a descrição (junta o array e limpa o HTML):', listText.includes('Uma peça sobre o equilíbrio e a queda') && !listText.includes('<strong>'));
  console.log('Mostra as categorias como etiquetas (Dança, Teatro):', listText.includes('Dança') && listText.includes('Teatro'));
  const vertigensLink = await page.evaluate(() => {
    const links = [...document.querySelectorAll('#eventsList a')];
    const l = links.find((a) => a.closest('div').parentElement.textContent.includes('Vertigens'));
    return l ? l.getAttribute('href') : null;
  });
  console.log('Usa o campo "link" direto da API, não um URL construído a partir do slug:', vertigensLink === 'https://www.agendalx.pt/events/event/vertigens-real-link/');
  console.log('Mostra o segundo evento "Vitorino ao vivo":', listText.includes('Vitorino ao vivo'));
  console.log('Mostra o terceiro evento com categorias em formato de objeto (Feira do Livro):', listText.includes('Feira do Livro'));
  const status1 = await page.evaluate(() => document.getElementById('eventsStatus').textContent);
  console.log('Estado mostra "3 de 3 eventos":', status1.includes('3 de 3'));

  // Filter by category
  await page.fill('#eventsSearchInput', 'música');
  await page.waitForTimeout(300);
  const filteredText = await page.evaluate(() => document.getElementById('eventsList').textContent);
  console.log('Filtro por categoria "música" mostra só Vitorino:', filteredText.includes('Vitorino') && !filteredText.includes('Vertigens'));

  await page.fill('#eventsSearchInput', 'livros');
  await page.waitForTimeout(300);
  const catObjText = await page.evaluate(() => document.getElementById('eventsList').textContent);
  console.log('Filtro por categoria em formato de objeto ("livros") encontra a Feira do Livro:', catObjText.includes('Feira do Livro'));

  // Filter with no matches
  await page.fill('#eventsSearchInput', 'inexistente123');
  await page.waitForTimeout(300);
  const noMatchText = await page.evaluate(() => document.getElementById('eventsList').textContent);
  console.log('Sem correspondência mostra mensagem amigável:', noMatchText.includes('Nenhum evento'));

  // Clear filter shows all again
  await page.fill('#eventsSearchInput', '');
  await page.waitForTimeout(300);
  const clearedText = await page.evaluate(() => document.getElementById('eventsList').textContent);
  console.log('Limpar filtro mostra os 3 eventos novamente:', clearedText.includes('Vertigens') && clearedText.includes('Vitorino') && clearedText.includes('Feira do Livro'));

  await page.click('#eventsScreen button:has-text("✖️")');
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => !document.getElementById('eventsScreen').classList.contains('active'));
  console.log('Fecha o ecrã corretamente:', closed);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
