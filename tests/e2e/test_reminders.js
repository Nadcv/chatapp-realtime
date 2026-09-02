const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Reminders Test');
  await page.fill('#regUsername', 'reminders_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'reminders' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => openRemindersScreen());
  await page.waitForSelector('#remindersScreen.active', { timeout: 3000 });

  const emptyStateShown = await page.evaluate(() => document.getElementById('remindersList').textContent.includes('Ainda não tens'));
  console.log('Empty state shown when there are no reminders:', emptyStateShown);

  // --- Quick-pick buttons ---
  const now = Date.now();
  await page.evaluate(() => quickPickReminderTime(1));
  const oneHourValue = await page.evaluate(() => document.getElementById('reminderDatetimeInput').value);
  const oneHourMs = new Date(oneHourValue).getTime();
  console.log('"Daqui a 1h" quick-pick sets a datetime ~1 hour from now:', Math.abs(oneHourMs - (now + 3600000)) < 120000);

  await page.evaluate(() => quickPickReminderTomorrow());
  const tomorrowValue = await page.evaluate(() => document.getElementById('reminderDatetimeInput').value);
  const tomorrowDate = new Date(tomorrowValue);
  console.log('"Amanhã de manhã" quick-pick sets the time to 09:00:', tomorrowDate.getHours() === 9 && tomorrowDate.getMinutes() === 0);
  console.log('"Amanhã de manhã" quick-pick is in the future:', tomorrowDate.getTime() > now);

  await page.evaluate(() => quickPickReminderTonight());
  const tonightValue = await page.evaluate(() => document.getElementById('reminderDatetimeInput').value);
  const tonightDate = new Date(tonightValue);
  console.log('"Esta noite" quick-pick sets the time to 20:00 and is in the future:', tonightDate.getHours() === 20 && tonightDate.getTime() > now);

  // --- Validation: empty text / past date rejected ---
  await page.evaluate(() => quickPickReminderTime(1));
  page.once('dialog', d => { console.log('Validation dialog (empty text):', d.message().includes('Escreve')); d.accept(); });
  await page.evaluate(() => addReminder());
  await page.waitForTimeout(200);

  await page.fill('#reminderTextInput', 'Teste no passado');
  await page.fill('#reminderDatetimeInput', '2020-01-01T10:00');
  page.once('dialog', d => { console.log('Validation dialog (past date rejected):', d.message().includes('futuro')); d.accept(); });
  await page.evaluate(() => addReminder());
  await page.waitForTimeout(200);
  const noReminderAddedYet = await page.evaluate(() => REMINDERS.items.length === 0);
  console.log('No reminder was actually added from the invalid attempts:', noReminderAddedYet);

  // --- Add a real reminder ---
  await page.fill('#reminderTextInput', 'Ligar ao dentista');
  await page.evaluate(() => quickPickReminderTime(2));
  await page.evaluate(() => addReminder());
  await page.waitForTimeout(400);

  const reminderAdded = await page.evaluate(() => REMINDERS.items.some(r => r.text === 'Ligar ao dentista'));
  console.log('Reminder was added and synced back from the server:', reminderAdded);
  const inputsCleared = await page.evaluate(() => document.getElementById('reminderTextInput').value === '' && document.getElementById('reminderDatetimeInput').value === '');
  console.log('Form inputs clear after adding:', inputsCleared);

  const listShowsIt = await page.evaluate(() => document.getElementById('remindersList').textContent.includes('Ligar ao dentista'));
  console.log('Reminders list displays the new reminder:', listShowsIt);
  const notNotifiedYet = await page.evaluate(() => !document.getElementById('remindersList').textContent.includes('já notificado'));
  console.log('A future reminder does NOT show the "já notificado" badge:', notNotifiedYet);

  // XSS safety.
  await page.fill('#reminderTextInput', '<img src=x onerror=alert(1)>');
  await page.evaluate(() => quickPickReminderTime(1));
  await page.evaluate(() => addReminder());
  await page.waitForTimeout(400);
  const xssSafe = await page.evaluate(() => !document.getElementById('remindersList').innerHTML.includes('<img src=x onerror'));
  console.log('XSS-safe: malicious reminder text is escaped:', xssSafe);

  // --- Delete a reminder ---
  const reminderId = await page.evaluate(() => REMINDERS.items.find(r => r.text === 'Ligar ao dentista').id);
  await page.evaluate((id) => deleteReminder(id), reminderId);
  await page.waitForTimeout(400);
  const reminderDeleted = await page.evaluate(() => !REMINDERS.items.some(r => r.text === 'Ligar ao dentista'));
  console.log('Deleting a reminder works:', reminderDeleted);

  // --- Server-side firing: emit a reminder with remindAt already in the past
  // (bypassing the client's own future-only validation) and wait for the
  // server's periodic check (every 20s) to mark it notified and push it live. ---
  let alertMessages = [];
  page.on('dialog', d => { alertMessages.push(d.message()); d.accept(); });
  await page.evaluate(() => {
    socket.emit('add_reminder', { text: 'Lembrete que já devia ter disparado', remindAt: Date.now() - 5000 });
  });
  await page.waitForTimeout(25000); // give the server's 20s interval time to pick it up

  const reminderFired = await page.evaluate(() => REMINDERS.items.some(r => r.text === 'Lembrete que já devia ter disparado' && r.notified === true));
  console.log('An overdue reminder gets marked notified by the server\'s periodic check:', reminderFired);
  const gotLiveAlert = alertMessages.some(m => m.includes('Lembrete que já devia ter disparado'));
  console.log('A LIVE alert fires for the reminder that just became notified while connected:', gotLiveAlert);
  const alertFiredOnlyOnce = alertMessages.filter(m => m.includes('Lembrete que já devia ter disparado')).length === 1;
  console.log('The live alert fires exactly once (not repeated on subsequent pushes):', alertFiredOnlyOnce);

  const badgeShownAfterFiring = await page.evaluate(() => document.getElementById('remindersList').textContent.includes('já notificado'));
  console.log('The fired reminder now shows the "já notificado" badge in the list:', badgeShownAfterFiring);

  // --- Reload: the already-notified reminder must NOT trigger a fresh alert on login ---
  const alertCountBeforeReload = alertMessages.length;
  await page.reload();
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const noAlertFloodOnReload = alertMessages.length === alertCountBeforeReload;
  console.log('BUG CHECK: reloading with an already-notified reminder does NOT re-trigger the alert:', noAlertFloodOnReload);

  const persistedAfterReload = await page.evaluate(() => REMINDERS.items.some(r => r.text === 'Lembrete que já devia ter disparado' && r.notified === true));
  console.log('Notified state persists correctly across reload:', persistedAfterReload);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
