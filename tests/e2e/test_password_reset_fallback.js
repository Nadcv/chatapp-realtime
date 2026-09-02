// Server run here has NO EMAIL_USER/EMAIL_PASS set — confirms the graceful
// degradation paths (no email on file, no mail transporter configured) give
// clear errors instead of crashing or silently doing nothing.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto('http://localhost:3000');
  await page1.click('.login-switch');
  const ts = Date.now();
  const phone = '+3518' + ts.toString().slice(-8);
  await page1.fill('#regName', 'NoMail Test');
  await page1.fill('#regUsername', 'nomail_' + ts);
  await page1.fill('#regPhone', phone);
  await page1.selectOption('#regCountry', 'Portugal');
  // No email on purpose.
  await page1.fill('#regPassword', 'senhaOriginal123');
  await page1.click('button:has-text("Criar conta")');
  await page1.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // --- No email on file ---
  const noEmailRes = await page1.evaluate(async (p) => {
    const r = await fetch('/api/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p }) });
    return { status: r.status, body: await r.json() };
  }, phone);
  console.log('Sem email na conta, dá um erro claro (não trava nem finge sucesso):', noEmailRes.status === 400 && noEmailRes.body.error.includes('não tem email'));

  // --- Set an email, but server has no mail transporter configured in THIS run ---
  await page1.evaluate((email) => {
    return new Promise((resolve) => { socket.once('email_updated', resolve); socket.emit('set_email', { email }); });
  }, 'nomail' + ts + '@test.com');
  const noMailConfiguredRes = await page1.evaluate(async (p) => {
    const r = await fetch('/api/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p }) });
    return { status: r.status, body: await r.json() };
  }, phone);
  console.log('Com email mas sem servidor de email configurado, dá um erro claro (não bloqueia nem finge sucesso):', noMailConfiguredRes.status === 503);

  // --- Confirm can't be used to skip the request step (no pending code -> rejected) ---
  const noPendingRes = await page1.evaluate(async (p) => {
    const r = await fetch('/api/password-reset/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p, code: '123456', newPassword: 'outraSenhaForte123' }) });
    return { status: r.status, body: await r.json() };
  }, phone);
  console.log('Confirmar sem ter pedido um código primeiro é recusado (não dá para saltar o passo 1):', noPendingRes.status === 400);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
