// Visita guiada: na primeira entrada de uma conta, 5 balões mostram onde
// estão as coisas; não volta a aparecer; pode rever-se em ⋯ → Visita guiada.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { window.__forceTour = true; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch[onclick*="register"]');
  const ts = Date.now();
  await page.fill('#regName', 'Tour Teste'); await page.fill('#regUsername', 'tour_' + ts);
  await page.fill('#regPhone', '+3510' + String(ts).slice(-8)); await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', `tour${ts}@test.com`); await page.fill('#regPassword', 'senha123');
  await page.click('button[onclick="doRegister()"]');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForSelector('#tourTip', { timeout: 5000 }).catch(() => {});
  const first = await page.textContent('#tourTip').catch(() => '');
  console.log('Primeira entrada mostra a visita guiada:', first.includes('Bem-vindo à NADIO') && first.includes('1/5'));

  const titles = [];
  for (let i = 0; i < 4; i++) { await page.click('#tourTip .tour-next'); titles.push(await page.textContent('#tourTip h4')); }
  console.log('Mostra os 5 passos (contactos, ferramentas, TV, perfil):', titles[0].includes('Contactos') && titles[1].includes('ferramentas') && titles[2].includes('TV') && titles[3].includes('perfil'));
  await page.waitForTimeout(400); // o destaque desliza até ao elemento (transição de 0,25 s)
  const spotOnAvatar = await page.evaluate(() => {
    const s = document.getElementById('tourSpot').getBoundingClientRect(), a = document.getElementById('headerAvatar').getBoundingClientRect();
    return Math.abs((s.left + s.width / 2) - (a.left + a.width / 2)) < 4 && Math.abs((s.top + s.height / 2) - (a.top + a.height / 2)) < 4;
  });
  console.log('O destaque fica por cima do elemento explicado:', spotOnAvatar);
  await page.click('#tourTip .tour-next');
  console.log('"Começar!" fecha a visita:', (await page.$('#tourTip')) === null && (await page.$('#tourSpot')) === null);

  await page.reload();
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(2000);
  console.log('Não volta a aparecer na entrada seguinte:', (await page.$('#tourTip')) === null);

  await page.evaluate(() => openMoreFeaturesModal());
  await page.click('#modalMoreFeatures button:has-text("Visita guiada")');
  console.log('Pode rever-se em ⋯ → Visita guiada:', !!(await page.$('#tourTip')));
  await page.click('#tourTip .tour-skip');
  console.log('"Saltar" fecha a visita:', (await page.$('#tourTip')) === null);
  await browser.close();
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
