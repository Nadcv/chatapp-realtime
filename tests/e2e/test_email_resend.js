const { chromium } = require('playwright');

// Regressão para a nova via de envio de email (Resend, API HTTPS) que
// substitui o SMTP direto como caminho principal — o SMTP puro falha com
// "Connection timeout" quando o servidor está hospedado numa plataforma na
// nuvem (a Google e outros provedores bloqueiam/ignoram ligações SMTP vindas
// de gamas de IP de alojamento, prevenção de spam). O Resend usa uma API
// HTTPS normal, como o resto das integrações externas desta app, e por isso
// nunca esbarra nesse bloqueio.
//
// Corre num lote PRÓPRIO (ver RESEND_ENV_OVERRIDES em tests/run-all.js), com
// RESEND_API_KEY/RESEND_API_BASE a apontar para o mock local (porta 3026) —
// os outros testes de email (test_2fa.js, test_password_reset.js,
// test_register_email_verification.js) continuam a testar especificamente o
// caminho SMTP, sem Resend configurado, exatamente como antes.
async function getLastEmailFrom(port, to) {
  const res = await fetch(`http://127.0.0.1:${port}/?to=` + encodeURIComponent(to));
  const data = await res.json();
  return data.lastMessage;
}
function extractCode(emailBody) {
  const matches = [...(emailBody || '').matchAll(/(?<![a-zA-Z0-9])(\d{6})(?![a-zA-Z0-9])/g)].map(m => m[1]);
  const counts = {};
  matches.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
  const repeated = Object.entries(counts).find(([, n]) => n >= 2);
  return repeated ? repeated[0] : (matches[matches.length - 1] || null);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // --- 1) Caminho normal: o código de confirmação de registo chega via
  // Resend (mock na porta 3026), NUNCA via SMTP (a "falsa" caixa de correio
  // SMTP na 2526 tem de continuar vazia para este destinatário).
  const page1 = await browser.newPage();
  page1.on('pageerror', err => console.log('PAGE EXCEPTION (normal):', err.message));
  await page1.goto('http://localhost:3000');
  await page1.click('.login-switch');
  const ts1 = Date.now();
  const email1 = 'resend_ok_' + ts1 + '@test.com';
  await page1.fill('#regName', 'Resend OK');
  await page1.fill('#regUsername', 'resend_ok_' + ts1);
  await page1.fill('#regPhone', '+3519' + ts1.toString().slice(-8));
  await page1.selectOption('#regCountry', 'Portugal');
  await page1.fill('#regEmail', email1);
  await page1.fill('#regPassword', 'senha1234forte');
  await page1.click('button:has-text("Criar conta")');
  await page1.waitForSelector('#registerVerifyBox', { state: 'visible', timeout: 5000 });
  await page1.waitForTimeout(500);

  const resendBody = await getLastEmailFrom(3026, email1);
  console.log('O código de confirmação chega via Resend (API HTTPS), não SMTP:', !!resendBody && /confirma/i.test(resendBody));
  const smtpBodyShouldBeEmpty = await getLastEmailFrom(2526, email1);
  console.log('O SMTP direto NUNCA chega a ser usado quando o Resend funciona:', !smtpBodyShouldBeEmpty);

  const code1 = extractCode(resendBody);
  await page1.fill('#registerVerifyCodeInput', code1);
  await page1.click('#registerVerifyBox button:has-text("Confirmar")');
  await page1.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  console.log('O registo completa-se normalmente com o código recebido via Resend:', await page1.evaluate(() => document.getElementById('mainApp').style.display === 'flex'));

  // --- 2) Recuo para o SMTP: o mock do Resend simula uma falha (500) para
  // este destinatário específico — sendAppEmail() tem de tentar o SMTP a
  // seguir em vez de desistir logo, exatamente como as outras integrações
  // desta app em cascata (ex.: validação de telemóvel Numverify → Veriphone → AbstractAPI).
  const page2 = await browser.newPage();
  page2.on('pageerror', err => console.log('PAGE EXCEPTION (fallback):', err.message));
  await page2.goto('http://localhost:3000');
  await page2.click('.login-switch');
  const ts2 = Date.now() + 1;
  const email2 = 'falha@resend-mock.test';
  await page2.fill('#regName', 'Resend Fallback');
  await page2.fill('#regUsername', 'resend_fb_' + ts2);
  await page2.fill('#regPhone', '+3519' + ts2.toString().slice(-8));
  await page2.selectOption('#regCountry', 'Portugal');
  await page2.fill('#regEmail', email2);
  await page2.fill('#regPassword', 'senha1234forte');
  await page2.click('button:has-text("Criar conta")');
  await page2.waitForSelector('#registerVerifyBox', { state: 'visible', timeout: 5000 });
  await page2.waitForTimeout(500);

  const smtpBodyFallback = await getLastEmailFrom(2526, email2);
  console.log('Quando o Resend falha, o código chega mesmo assim via SMTP (recuo automático):', !!smtpBodyFallback && /confirma/i.test(smtpBodyFallback));

  const code2 = extractCode(smtpBodyFallback);
  await page2.fill('#registerVerifyCodeInput', code2);
  await page2.click('#registerVerifyBox button:has-text("Confirmar")');
  await page2.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  console.log('O registo completa-se normalmente mesmo com o Resend em baixo:', await page2.evaluate(() => document.getElementById('mainApp').style.display === 'flex'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
