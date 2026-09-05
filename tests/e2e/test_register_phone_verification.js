// Valida o telemóvel no registo através do Numverify (apilayer.net) — ver
// validatePhoneNumberReal() no server.js. Este teste usa um mock local
// (tests/mocks/mock_numverify_server.js, porta 3021) em vez do serviço real:
// números com "000000000" simulam "inválido" e com "111111111" simulam um
// erro da própria API (quota esgotada, etc.) — nos dois casos confirma-se o
// comportamento esperado: recusa só quando a API diz mesmo "inválido",
// nunca bloqueia por causa de um erro da API.
const { chromium } = require('playwright');

async function fillRegisterForm(page, { name, username, phone, email }) {
  await page.fill('#regName', name);
  await page.fill('#regUsername', username);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', email);
  await page.fill('#regPassword', 'senha1234forte');
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // --- Número claramente inválido (mock devolve valid:false): registo recusado. ---
  const ctxInvalid = await browser.newContext();
  const pageInvalid = await ctxInvalid.newPage();
  await pageInvalid.goto('http://localhost:3000');
  await pageInvalid.click('.login-switch');
  const tsInvalid = Date.now();
  await fillRegisterForm(pageInvalid, { name: 'Phone Invalid Test', username: 'phoneinvalid_' + tsInvalid, phone: '+351000000000', email: 'phoneinvalid' + tsInvalid + '@test.com' });
  await pageInvalid.click('button:has-text("Criar conta")');
  await pageInvalid.waitForTimeout(600);
  const invalidRejected = await pageInvalid.evaluate(() => document.getElementById('registerError').textContent.includes('não parece ser real'));
  const invalidStillOnRegisterScreen = await pageInvalid.evaluate(() => document.getElementById('mainApp').style.display !== 'flex');
  console.log('Número de telemóvel claramente inválido (Numverify diz "inválido") é recusado:', invalidRejected && invalidStillOnRegisterScreen);

  // --- API do Numverify a falhar (quota esgotada, etc.): NÃO bloqueia o registo. ---
  const ctxApiError = await browser.newContext();
  const pageApiError = await ctxApiError.newPage();
  await pageApiError.goto('http://localhost:3000');
  await pageApiError.click('.login-switch');
  const tsApiError = Date.now();
  await fillRegisterForm(pageApiError, { name: 'Phone API Error Test', username: 'phoneapierr_' + tsApiError, phone: '+351111111111', email: 'phoneapierr' + tsApiError + '@test.com' });
  await pageApiError.click('button:has-text("Criar conta")');
  await pageApiError.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const apiErrorDidNotBlock = await pageApiError.evaluate(() => document.getElementById('mainApp').style.display === 'flex');
  console.log('Uma falha da própria API do Numverify (quota esgotada, etc.) NUNCA bloqueia o registo:', apiErrorDidNotBlock);

  // --- Número normal (mock devolve valid:true): regista normalmente. ---
  const ctxValid = await browser.newContext();
  const pageValid = await ctxValid.newPage();
  await pageValid.goto('http://localhost:3000');
  await pageValid.click('.login-switch');
  const tsValid = Date.now();
  const validPhone = '+3519' + tsValid.toString().slice(-8);
  await fillRegisterForm(pageValid, { name: 'Phone Valid Test', username: 'phonevalid_' + tsValid, phone: validPhone, email: 'phonevalid' + tsValid + '@test.com' });
  await pageValid.click('button:has-text("Criar conta")');
  await pageValid.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const validRegistered = await pageValid.evaluate(() => document.getElementById('mainApp').style.display === 'flex');
  console.log('Um número normal (o Numverify confirma como válido) regista-se normalmente:', validRegistered);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
