// Regression test for: "if the callee never answers, the ringtone beep never
// stops" — root cause is that an incoming call that's only RINGING (not yet
// accepted) never sets APP.callActive = true, so when the caller gives up and
// sends 'call_ended', endCall()'s early-return guard (`if (!APP.callActive) return;`)
// skips the stopRingtone() call later in the function, leaving the setInterval
// running forever even though the incoming-call modal has already closed.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Ringtone Giveup Test');
  await page.fill('#regUsername', 'ringgiveup_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'ringgiveup' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Simulate an incoming call arriving (as if from a real caller), WITHOUT accepting it.
  await page.evaluate(() => {
    // Directly invoke the same handler the real 'incoming_call' socket event triggers.
    incomingCallData = { targetRoomId: 'dm_test', callerPhone: '+351900000000', callerName: 'Quem Ligou', callType: 'voice', offer: {} };
    document.getElementById('incomingCallerName').textContent = incomingCallData.callerName;
    document.getElementById('incomingCallType').textContent = '📞 Chamada de voz a chegar...';
    document.getElementById('modalIncomingCall').classList.add('active');
    startRingtone();
  });
  await page.waitForTimeout(300);

  const modalShownWhileRinging = await page.evaluate(() => document.getElementById('modalIncomingCall').classList.contains('active'));
  console.log('Incoming-call modal is shown while ringing:', modalShownWhileRinging);

  const ringtoneActiveInitially = await page.evaluate(() => ringtoneTimer !== null);
  console.log('Ringtone interval is running while the call is ringing (not yet answered):', ringtoneActiveInitially);

  const callActiveWhileJustRinging = await page.evaluate(() => APP.callActive);
  console.log('APP.callActive is still false while just ringing (not yet accepted) — this is the root cause:', callActiveWhileJustRinging === false);

  // Now simulate the CALLER giving up (their 35s ring timeout fires, sending 'end_call',
  // which the server relays back to us as 'call_ended'). Trigger the exact same
  // client-side handler the real socket event runs.
  await page.evaluate(() => {
    if (incomingCallData) {
      socket.emit('call_log_entry', { peerPhone: incomingCallData.callerPhone, peerName: incomingCallData.callerName, type: incomingCallData.callType, direction: 'incoming', status: 'missed', durationSec: 0 });
      document.getElementById('modalIncomingCall').classList.remove('active');
      incomingCallData = null;
    }
    endCall(true);
  });
  await page.waitForTimeout(300);

  const modalHiddenAfterGiveup = await page.evaluate(() => !document.getElementById('modalIncomingCall').classList.contains('active'));
  console.log('Incoming-call modal is correctly hidden after the caller gives up:', modalHiddenAfterGiveup);

  const ringtoneStoppedAfterGiveup = await page.evaluate(() => ringtoneTimer === null);
  console.log('BUG CHECK: the ringtone actually STOPS after the caller gives up (should be true after the fix):', ringtoneStoppedAfterGiveup);

  // Give it a couple more beep cycles worth of time and confirm no further audio-scheduling
  // happens (the interval itself must be cleared, not just muted).
  await page.waitForTimeout(2500);
  const stillNoRingtoneTimer = await page.evaluate(() => ringtoneTimer === null);
  console.log('Ringtone interval remains cleared a few seconds later (not just paused):', stillNoRingtoneTimer);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
