const { chromium } = require('playwright');

// Face ID/Touch ID (WebAuthn/passkeys) — usa o autenticador virtual do
// Chromium (via CDP, "WebAuthn.addVirtualAuthenticator") para simular uma
// impressão digital/Face ID sem hardware real, tal como o Chrome DevTools
// permite manualmente. Cobre: ativar num dispositivo, ver a credencial na
// lista, entrar sem senha ("usernameless" — o próprio autenticador escolhe
// a passkey, sem pedir o telefone primeiro), e que remover a credencial no
// servidor revoga o acesso mesmo que o autenticador continue a "lembrar-se"
// dela localmente.
async function register(page, name, prefix) {
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3519' + ts.toString().slice(-8);
  const username = prefix + ts;
  await page.fill('#regName', name);
  await page.fill('#regUsername', username);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { phone, username };
}

async function addVirtualAuthenticator(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true }
  });
  return authenticatorId;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext();
  const page = await context.newPage();

  await addVirtualAuthenticator(page);
  const user = await register(page, 'Webauthn Test', 'webauthn_');

  // --- Secção "Face ID/Touch ID" aparece no perfil, começa vazia ---
  await page.click('#headerAvatar');
  await page.waitForSelector('#modalProfile.active', { timeout: 5000 });
  const sectionVisible = await page.evaluate(() => document.getElementById('webauthnSection').style.display === 'block');
  console.log('A secção "Face ID/Touch ID" aparece no perfil (navegador com suporte):', sectionVisible);
  const startsEmpty = await page.evaluate(() => document.getElementById('webauthnCredentialsList').textContent.includes('Ainda não ativaste'));
  console.log('Começa sem nenhum dispositivo ativado:', startsEmpty);

  // --- Ativa neste dispositivo ---
  await page.evaluate(() => setupWebauthn());
  await page.waitForTimeout(800);
  const credentialListed = await page.evaluate(() => document.getElementById('webauthnCredentialsList').textContent.includes('Chrome'));
  console.log('Depois de ativar, a credencial aparece na lista:', credentialListed);
  const removeBtnVisible = await page.locator('#webauthnCredentialsList button:has-text("Remover")').isVisible();
  console.log('Tem um botão para remover essa credencial:', removeBtnVisible);

  // --- Sai da sessão (limpa o token local, como um logout/reinstalação) ---
  await page.evaluate(() => { localStorage.removeItem('authToken'); localStorage.removeItem('authUser'); });
  await page.reload();
  await page.waitForSelector('.login-screen', { state: 'visible', timeout: 8000 });
  const loginBtnVisible = await page.evaluate(() => document.getElementById('webauthnLoginBtn').style.display === 'block');
  console.log('O botão "Entrar com Face ID/Touch ID" aparece no ecrã de login:', loginBtnVisible);

  // --- Entra sem senha nenhuma, "usernameless" (não escreve telefone nem senha) ---
  await page.evaluate(() => doWebauthnLogin());
  await page.waitForFunction(() => document.getElementById('mainApp').style.display === 'flex', null, { timeout: 8000 });
  const loggedInAsRightUser = await page.evaluate((phone) => APP.user?.phone === phone, user.phone);
  console.log('Entra com sucesso, sem senha, como a conta certa:', loggedInAsRightUser);
  const noLoginError = await page.evaluate(() => document.getElementById('loginError').textContent === '');
  console.log('Sem nenhum erro mostrado no ecrã de login:', noLoginError);

  // --- Remove a credencial: o autenticador "lembra-se" dela localmente, mas o
  // servidor já não a reconhece — o login tem de voltar a falhar. ---
  await page.click('#headerAvatar');
  await page.waitForSelector('#modalProfile.active', { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.click('#webauthnCredentialsList button:has-text("Remover")');
  await page.waitForTimeout(500);
  const emptyAfterRemove = await page.evaluate(() => document.getElementById('webauthnCredentialsList').textContent.includes('Ainda não ativaste'));
  console.log('Depois de remover, a lista volta a ficar vazia:', emptyAfterRemove);

  await page.evaluate(() => { localStorage.removeItem('authToken'); localStorage.removeItem('authUser'); });
  await page.reload();
  await page.waitForSelector('.login-screen', { state: 'visible', timeout: 8000 });
  await page.evaluate(() => doWebauthnLogin());
  await page.waitForTimeout(1200);
  const stillOnLoginScreen = await page.evaluate(() => document.getElementById('mainApp').style.display !== 'flex');
  const showsRevokedError = await page.evaluate(() => document.getElementById('loginError').textContent.length > 0);
  console.log('Depois de remover a credencial no servidor, o login com Face ID/Touch ID deixa de funcionar:', stillOnLoginScreen && showsRevokedError);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
