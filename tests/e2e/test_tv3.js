const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text()); });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'TV Teste3');
  await page.fill('#regUsername', 'tv_test3_' + ts);
  await page.fill('#regPhone', '+3515' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'tvtest3' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.click('#mediaBtn');
  await page.click('#modalMediaFeatures button[onclick*="openTvScreen"]');
  await page.waitForSelector('#tvScreen.active');
  await page.waitForTimeout(500);

  console.log('Category tabs:', (await page.textContent('#tvCategoryTabs')).replace(/\s+/g, ' ').trim());
  console.log('News iframe src:', await page.getAttribute('#tvFrame', 'src'));

  await page.click('#tvCategoryTabs button:has-text("Filmes")');
  await page.waitForTimeout(300);
  console.log('Genre tabs:', (await page.textContent('#tvTabs')).replace(/\s+/g, ' ').trim());
  console.log('Movie list (comedia default):', (await page.textContent('#tvMovieList')).replace(/\s+/g, ' ').trim());
  console.log('Iframe after entering Filmes (should be blank):', await page.getAttribute('#tvFrame', 'src'));

  await page.click('#tvMovieList button:has-text("His Girl Friday")');
  await page.waitForTimeout(300);
  console.log('Iframe after picking His Girl Friday:', await page.getAttribute('#tvFrame', 'src'));

  await page.click('#tvTabs button:has-text("Terror")');
  await page.waitForTimeout(300);
  console.log('Movie list (terror):', (await page.textContent('#tvMovieList')).replace(/\s+/g, ' ').trim());
  console.log('Iframe after switching genre (should reset to blank):', await page.getAttribute('#tvFrame', 'src'));

  await page.click('#tvMovieList button:has-text("Nosferatu")');
  await page.waitForTimeout(300);
  console.log('Iframe after picking Nosferatu:', await page.getAttribute('#tvFrame', 'src'));

  // Back to news
  await page.click('#tvCategoryTabs button:has-text("Notícias")');
  await page.waitForTimeout(300);
  console.log('Back to news, iframe src:', await page.getAttribute('#tvFrame', 'src'));
  console.log('Movie list hidden?', await page.evaluate(() => document.getElementById('tvMovieList').style.display));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
