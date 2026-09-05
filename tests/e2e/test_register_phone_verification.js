// Valida o telemóvel no registo através de uma cascata de provedores
// (Numverify → Veriphone → AbstractAPI) — ver validatePhoneNumberReal() e
// PHONE_VALIDATION_PROVIDERS no server.js. Este teste usa mocks locais em
// vez dos serviços reais (tests/mocks/mock_numverify_server.js porta 3021,
// mock_veriphone_server.js porta 3022, mock_abstractapi_server.js porta
// 3023): números com "000000000" simulam "inválido" logo no 1º provedor;
// com "111111111" simulam TODOS os provedores sem quota (cascata esgotada);
// com "222222222" simulam só o 1º provedor sem quota, com o 2º a decidir
// "inválido" (prova que a cascata avança e usa a 1ª resposta definitiva que
// encontra). Em nenhum caso um erro/quota de uma API bloqueia o registo —
// só uma resposta explícita de "inválido" o faz.
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

  // --- Toda a cascata sem quota (Numverify + Veriphone + AbstractAPI): NÃO bloqueia o registo. ---
  const ctxApiError = await browser.newContext();
  const pageApiError = await ctxApiError.newPage();
  await pageApiError.goto('http://localhost:3000');
  await pageApiError.click('.login-switch');
  const tsApiError = Date.now();
  await fillRegisterForm(pageApiError, { name: 'Phone API Error Test', username: 'phoneapierr_' + tsApiError, phone: '+351111111111', email: 'phoneapierr' + tsApiError + '@test.com' });
  await pageApiError.click('button:has-text("Criar conta")');
  await pageApiError.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  const apiErrorDidNotBlock = await pageApiError.evaluate(() => document.getElementById('mainApp').style.display === 'flex');
  console.log('Cascata inteira sem quota (Numverify + Veriphone + AbstractAPI) NUNCA bloqueia o registo:', apiErrorDidNotBlock);

  // --- Numverify sem quota, mas o 2º provedor (Veriphone) recusa o número: cascata usa essa decisão. ---
  const ctxCascade = await browser.newContext();
  const pageCascade = await ctxCascade.newPage();
  await pageCascade.goto('http://localhost:3000');
  await pageCascade.click('.login-switch');
  const tsCascade = Date.now();
  await fillRegisterForm(pageCascade, { name: 'Phone Cascade Test', username: 'phonecascade_' + tsCascade, phone: '+351222222222', email: 'phonecascade' + tsCascade + '@test.com' });
  await pageCascade.click('button:has-text("Criar conta")');
  await pageCascade.waitForTimeout(600);
  const cascadeRejected = await pageCascade.evaluate(() => document.getElementById('registerError').textContent.includes('não parece ser real'));
  const cascadeStillOnRegisterScreen = await pageCascade.evaluate(() => document.getElementById('mainApp').style.display !== 'flex');
  console.log('Numverify sem quota + Veriphone (2º provedor) recusa o número: a cascata usa essa decisão e recusa o registo:', cascadeRejected && cascadeStillOnRegisterScreen);

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
