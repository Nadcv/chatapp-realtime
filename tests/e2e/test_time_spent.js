const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  const phone = '+3515' + ts.toString().slice(-8);
  await page.fill('#regName', 'Time Spent Teste');
  await page.fill('#regUsername', 'time_spent_' + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'timespent' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  const initial = await page.textContent('#timeSpentValue');
  console.log('Initial display (should be 0m for a brand new account):', initial);

  // Speed things up: directly bump the in-memory counter forward instead of waiting 65 real seconds.
  await page.evaluate(() => { APP.user.totalTimeSpentSec += 65; updateTimeSpentDisplay(); });
  const afterBump = await page.textContent('#timeSpentValue');
  console.log('After +65s bump (should show 1h? no: 1m):', afterBump);

  // Confirm the ticking interval is actually incrementing (wait ~2.2s real time, foreground tab).
  await page.waitForTimeout(2200);
  const afterTick = await page.evaluate(() => APP.user.totalTimeSpentSec);
  console.log('totalTimeSpentSec after ~2s of real ticking (should be > 65):', afterTick, afterTick > 65);

  // Force a flush now (normally happens every 30s) and check the server-side total via the endpoint.
  await page.evaluate(() => flushTimeSpent());
  await page.waitForTimeout(300);
  const serverCheck = await page.evaluate(async () => {
    const r = await fetch('/api/time-spent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: APP.token, seconds: 0 })
    });
    return r.json();
  });
  console.log('Server-side persisted total (0-second no-op call, just to read back):', serverCheck);

  // Simulate tab going to background: hidden ticks should NOT increment the counter.
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { value: true, configurable: true }));
  const beforeHiddenWait = await page.evaluate(() => APP.user.totalTimeSpentSec);
  await page.waitForTimeout(2200);
  const afterHiddenWait = await page.evaluate(() => APP.user.totalTimeSpentSec);
  console.log('Counter frozen while document.hidden=true:', beforeHiddenWait === afterHiddenWait, beforeHiddenWait, afterHiddenWait);

  // Logout should flush pending seconds too.
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { value: false, configurable: true }));
  await page.waitForTimeout(1200);
  const pendingBeforeLogout = await page.evaluate(() => TIME_SPENT.pendingSec);
  console.log('Has pending seconds before logout:', pendingBeforeLogout > 0);
  await page.click('button[onclick="logout()"]');
  await page.waitForTimeout(300);
  const pendingAfterLogout = await page.evaluate(() => TIME_SPENT.pendingSec).catch(() => 'N/A (var still exists but should be 0)');
  console.log('Pending seconds flushed to 0 on logout:', pendingAfterLogout);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
