const { chromium } = require('playwright');

async function registerUser(browser, label) {
  const page = await browser.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION (${label}):`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  await page.fill('#regName', label);
  await page.fill('#regUsername', 'sec_' + label.toLowerCase() + '_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'sec_' + label.toLowerCase() + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(500); // dá tempo à chave pública ser publicada
  const phone = await page.evaluate(() => APP.user.phone);
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const alice = await registerUser(browser, 'Alice');
  const bob = await registerUser(browser, 'Bob');
  const alicePage = alice.page, bobPage = bob.page;

  // Torna-os contactos reais um do outro (tal como pesquisar alguém e "Iniciar
  // conversa" faria), para os dois lados ficarem com a chave pública real.
  await alicePage.evaluate((bobPhone) => socket.emit('add_contact', { phone: bobPhone }), bob.phone);
  await bobPage.evaluate((alicePhone) => socket.emit('add_contact', { phone: alicePhone }), alice.phone);
  await alicePage.waitForTimeout(500);
  await bobPage.waitForTimeout(500);

  const aliceHasBobKey = await alicePage.evaluate(() => {
    const chat = APP.chats.find(c => c.name === 'Bob');
    return !!(chat && chat.publicKey);
  });
  const bobHasAliceKey = await bobPage.evaluate(() => {
    const chat = APP.chats.find(c => c.name === 'Alice');
    return !!(chat && chat.publicKey);
  });
  console.log('Alice has Bob\'s real public key from the server:', aliceHasBobKey);
  console.log('Bob has Alice\'s real public key from the server:', bobHasAliceKey);

  // Encryption badge appears when opening a real E2EE-capable chat.
  await alicePage.click('.chat-item:has-text("Bob")');
  await alicePage.waitForTimeout(200);
  const badgeVisible = await alicePage.evaluate(() => document.getElementById('encryptionBadge').style.display === 'inline');
  console.log('Encryption badge is visible for a chat with an exchanged public key:', badgeVisible);
  const secBtnVisible = await alicePage.evaluate(() => document.getElementById('securityCodeBtn').style.display === 'flex');
  console.log('"Código de segurança" button is visible in the chat-more menu:', secBtnVisible);

  await bobPage.click('.chat-item:has-text("Alice")');
  await bobPage.waitForTimeout(200);

  // Open the security code modal on both sides.
  await alicePage.evaluate(() => openSecurityCodeModal());
  await alicePage.waitForSelector('#modalSecurityCode.active', { timeout: 3000 });
  await bobPage.evaluate(() => openSecurityCodeModal());
  await bobPage.waitForSelector('#modalSecurityCode.active', { timeout: 3000 });

  const aliceCode = await alicePage.evaluate(() => document.getElementById('securityCodeDigits').dataset.rawCode);
  const bobCode = await bobPage.evaluate(() => document.getElementById('securityCodeDigits').dataset.rawCode);
  console.log('Both sides compute a non-empty code:', !!aliceCode && !!bobCode);
  console.log('Alice and Bob see the EXACT SAME security code:', aliceCode === bobCode);
  console.log('Code has the expected shape (12 groups of 5 digits):', /^(\d{5} ){11}\d{5}$/.test(aliceCode || ''));

  const contactNameShown = await alicePage.evaluate(() => document.getElementById('securityCodeContactName').textContent);
  console.log('Modal shows the correct contact name:', contactNameShown === 'Bob');

  // Copy button uses the clipboard API (mocked here since headless clipboard perms are unreliable in CI).
  const copyWorked = await alicePage.evaluate(async () => {
    let written = null;
    navigator.clipboard.writeText = (text) => { written = text; return Promise.resolve(); };
    await copySecurityCode();
    return written === document.getElementById('securityCodeDigits').dataset.rawCode;
  });
  console.log('Copy button copies the exact displayed code:', copyWorked);

  // MITM simulation: if a third party's key was substituted for one side (a real MITM attempt),
  // the computed code changes — this is the whole point of the safety-number check.
  const mitmDetected = await alicePage.evaluate(async () => {
    const chat = APP.chats.find(c => c.name === 'Bob');
    const realCode = (await computeSecurityCode(E2EE.publicJwk, chat.publicKey)).join(' ');
    const fakeKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const fakePeerJwk = await crypto.subtle.exportKey('jwk', fakeKeyPair.publicKey);
    const tamperedCode = (await computeSecurityCode(E2EE.publicJwk, fakePeerJwk)).join(' ');
    return { realCode, tamperedCode, differ: realCode !== tamperedCode };
  });
  console.log('A substituted (MITM) public key produces a DIFFERENT security code:', mitmDetected.differ);

  // Order-independence: computeSecurityCode(A,B) must equal computeSecurityCode(B,A) since both
  // sides run it with themselves as "my" key and the other as "peer".
  const orderIndependent = await bobPage.evaluate(async () => {
    const chat = APP.chats.find(c => c.name === 'Alice');
    const fromBobSide = (await computeSecurityCode(E2EE.publicJwk, chat.publicKey)).join(' ');
    const fromAliceSideSimulated = (await computeSecurityCode(chat.publicKey, E2EE.publicJwk)).join(' ');
    return fromBobSide === fromAliceSideSimulated;
  });
  console.log('Code computation is symmetric regardless of argument order:', orderIndependent);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
