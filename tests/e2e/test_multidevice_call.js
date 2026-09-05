// Deep investigation into "um lado não consegue ligar" (one side can't connect):
// this app supports up to 2 devices logged into the SAME account simultaneously
// (confirmed by test_devices.js). If both devices are online when a call comes
// in, does deliverToPhone() ring BOTH of them? If the person answers on one
// device, does the OTHER device ever find out (stop ringing, stop being able
// to "double answer")? This is a concrete, plausible root cause worth testing
// for real, not just reading the code.
const { chromium } = require('playwright');

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3519' + ts.toString().slice(-8);
  await page.fill('#regName', name);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone };
}

async function loginSecondDevice(context, phone) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION [B device 2]:', err.message));
  await page.goto('http://localhost:3000');
  await page.fill('#loginPhone', phone);
  await page.fill('#loginPassword', 'senha1234forte');
  await page.click('button:has-text("🚀 Entrar")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return page;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB1 = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB2 = await browser.newContext({ permissions: ['camera', 'microphone'] }); // B's "second device"

  const a = await register(ctxA, 'MultiDev A', 'mda_');
  const b = await register(ctxB1, 'MultiDev B', 'mdb_');
  const bPage2 = await loginSecondDevice(ctxB2, b.phone);

  const devicesRegistered = await b.page.evaluate(() => new Promise((resolve) => {
    // Just a sanity delay to let both device sockets register on the server.
    setTimeout(() => resolve(true), 500);
  }));

  // A adds B as a contact and opens the DM.
  const usernameB = await b.page.evaluate(() => APP.user.username);
  await a.page.evaluate((uname) => {
    document.getElementById('modalSearchUser').classList.add('active');
    document.getElementById('searchUsernameInput').value = uname;
  }, usernameB);
  await a.page.evaluate(() => doSearchUser());
  await a.page.waitForTimeout(500);
  await a.page.evaluate(() => {
    const btn = [...document.querySelectorAll('#searchUserResult button')].find(b => b.textContent.includes('conversa'));
    if (btn) btn.click();
  });
  await a.page.waitForTimeout(500);
  await a.page.click('.chat-item:has-text("MultiDev B")');
  await a.page.waitForTimeout(300);

  // A calls B (voice, to keep this fast/focused on the signaling race, not video specifically).
  await a.page.evaluate(() => startCall('voice'));
  await a.page.waitForTimeout(1000);

  const b1Rings = await b.page.evaluate(() => document.getElementById('modalIncomingCall').classList.contains('active')).catch(() => false);
  const b2Rings = await bPage2.evaluate(() => document.getElementById('modalIncomingCall').classList.contains('active')).catch(() => false);
  console.log('B device 1 receives the incoming call and rings:', b1Rings);
  console.log('B device 2 (second logged-in device, same account) ALSO receives the incoming call and rings:', b2Rings);

  // B answers on device 1 only.
  await b.page.evaluate(() => acceptIncomingCall());
  await a.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 }).catch(() => {});
  await b.page.waitForFunction(() => document.getElementById('callStatus').textContent.includes('Conectado'), { timeout: 15000 }).catch(() => {});

  const aStatus = await a.page.evaluate(() => document.getElementById('callStatus').textContent);
  const b1Status = await b.page.evaluate(() => document.getElementById('callStatus').textContent);
  console.log('A connects successfully with B device 1:', aStatus.includes('Conectado'));
  console.log('B device 1 connects successfully:', b1Status.includes('Conectado'));

  await a.page.waitForTimeout(1000);
  const b2StillRinging = await bPage2.evaluate(() => document.getElementById('modalIncomingCall').classList.contains('active')).catch(() => false);
  // Nota: esta verificação está escrita "ao contrário" de propósito (true =
  // aprovado, o runner conta qualquer linha ": false" como falha) — o
  // resultado desejado é B DEIXAR de tocar no device 2, por isso testamos
  // a negação em vez do próprio bug.
  console.log('FIX CHECK: B device 2 já não mostra o ecrã de chamada a receber, depois de respondida no device 1:', !b2StillRinging);

  const b2RingtoneStopped = await bPage2.evaluate(() => ringtoneTimer === null).catch(() => null);
  console.log('FIX CHECK: B device 2\'s ringtone interval actually stopped (call_taken_elsewhere handled):', b2RingtoneStopped);
  const b2IncomingDataCleared = await bPage2.evaluate(() => incomingCallData === null).catch(() => null);
  console.log('FIX CHECK: B device 2\'s incomingCallData is cleared (can\'t accidentally double-answer):', b2IncomingDataCleared);

  // If B (confused, seeing device 2 still "ringing") also taps Aceitar THERE...
  if (b2StillRinging) {
    await bPage2.evaluate(() => acceptIncomingCall());
    await a.page.waitForTimeout(1500);
    const aStatusAfterSecondAnswer = await a.page.evaluate(() => document.getElementById('callStatus').textContent);
    console.log('A\'s call status AFTER device 2 ALSO answers (should still say Conectado if device 1\'s connection survives):', aStatusAfterSecondAnswer);
    const aStillHasWorkingAudio = await a.page.evaluate(() => {
      const v = document.getElementById('mainVideo');
      return !!v.srcObject;
    });
    console.log('BUG CHECK: does A still have ANY remote stream attached after the conflicting second answer arrives:', aStillHasWorkingAudio);

    // Check for an unhandled promise rejection / signaling-state error on A's side from the second answer.
    const aPageErrors = [];
    a.page.on('pageerror', (err) => aPageErrors.push(err.message));
    await a.page.waitForTimeout(500);
    console.log('A had a page error from the conflicting second call_answered (if any):', aPageErrors.join(' | ') || '(none captured, but see console warnings above)');
  }

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
