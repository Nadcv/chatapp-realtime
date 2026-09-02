const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');

  // Mock fetch for /api/quote-of-day BEFORE registering, so it's active when
  // enterApp() calls loadQuoteOfDay() automatically.
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      if (typeof url === 'string' && url.startsWith('/api/quote-of-day')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ quote: 'A vida é o que acontece <script>enquanto fazes outros planos.', author: 'John Lennon' })
        });
      }
      return realFetch(url, opts);
    };
  });

  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Quote Teste');
  await page.fill('#regUsername', 'quote_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'quote' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(500);

  const visible = await page.locator('#quoteOfDayBar').evaluate(el => getComputedStyle(el).display !== 'none');
  const text = await page.textContent('#quoteOfDayBar');
  const html = await page.evaluate(() => document.getElementById('quoteOfDayBar').innerHTML);
  console.log('Quote bar visible:', visible);
  console.log('Quote text:', text);
  console.log('Author shown:', text.includes('John Lennon'));
  console.log('Attribution to ZenQuotes.io shown:', text.includes('ZenQuotes.io'));
  console.log('Rendered via textContent, no raw <script> tag in DOM:', !html.includes('<script>enquanto'));

  // Failure case: mock a failed response and confirm the bar stays hidden (fresh page).
  const page2 = await browser.newPage();
  await page2.goto('http://localhost:3000');
  await page2.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      if (typeof url === 'string' && url.startsWith('/api/quote-of-day')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'sem frase hoje' }) });
      }
      return realFetch(url, opts);
    };
  });
  await page2.click('.login-switch');
  const ts2 = Date.now() + 7;
  await page2.fill('#regName', 'Quote Fail Teste');
  await page2.fill('#regUsername', 'quote_fail_' + ts2);
  await page2.fill('#regPhone', '+3518' + ts2.toString().slice(-8));
  await page2.selectOption('#regCountry', 'Portugal');
  await page2.fill('#regEmail', 'quotefail' + ts2 + '@test.com');
  await page2.fill('#regPassword', 'senha123');
  await page2.click('button:has-text("Criar conta")');
  await page2.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page2.waitForTimeout(500);
  const visible2 = await page2.locator('#quoteOfDayBar').evaluate(el => getComputedStyle(el).display !== 'none');
  console.log('Quote bar stays hidden on failure (no ugly error text shown):', !visible2);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
