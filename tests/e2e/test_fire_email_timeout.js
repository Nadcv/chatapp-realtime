const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Fire Email Test');
  await page.fill('#regUsername', 'fireemail_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'fireemail' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 38.7, longitude: -9.1 });

  // Simulate the server hanging forever (never resolves) — before the fix, the UI
  // would be stuck at "A enviar email..." indefinitely with no feedback.
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      if (typeof url === 'string' && url.includes('/api/fires/send-email')) {
        return new Promise((resolve, reject) => {
          if (opts?.signal) {
            opts.signal.addEventListener('abort', () => {
              const err = new Error('The user aborted a request.');
              err.name = 'AbortError';
              reject(err);
            });
          }
          // Never resolves on its own — simulates a hung SMTP connection.
        });
      }
      return realFetch(url, opts);
    };
  });

  await page.evaluate(() => { document.getElementById('fireEmailContact').value = 'someone@example.com'; saveFireEmailContact('someone@example.com'); });
  await page.evaluate(() => sendFireEmail());
  await page.waitForTimeout(1000);
  const statusWhileSending = await page.evaluate(() => document.getElementById('fireEmailStatus').textContent);
  console.log('Status shows "A enviar email..." immediately after clicking send:', statusWhileSending.includes('A enviar'));

  // Wait past the 15s client-side abort timeout.
  await page.waitForTimeout(15500);
  const statusAfterTimeout = await page.evaluate(() => document.getElementById('fireEmailStatus').textContent);
  console.log('After ~15s with no server response, the UI shows a clear timeout error instead of staying stuck:', statusAfterTimeout.includes('demorou demasiado'));
  console.log('Status text (for reference):', statusAfterTimeout);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
