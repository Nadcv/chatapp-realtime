const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Time Picker Test');
  await page.fill('#regUsername', 'timepick_' + ts);
  await page.fill('#regPhone', '+3511' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'timepick' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => openRemindersScreen());
  await page.waitForSelector('#remindersScreen.active', { timeout: 3000 });

  // --- Pick a time that's still in the future today ---
  const now = new Date();
  const futureToday = new Date(now.getTime() + 60 * 60 * 1000); // +1h, still today (assuming not near midnight)
  const stillTodayCase = futureToday.getDate() === now.getDate();
  if (stillTodayCase) {
    const hh = String(futureToday.getHours()).padStart(2, '0');
    const mm = String(futureToday.getMinutes()).padStart(2, '0');
    await page.fill('#reminderTimeOnlyInput', `${hh}:${mm}`);
    await page.evaluate(() => quickPickReminderTimeToday());
    const value = await page.evaluate(() => document.getElementById('reminderDatetimeInput').value);
    const picked = new Date(value);
    console.log('Hora futura hoje fica marcada para HOJE à hora escolhida:', picked.getDate() === now.getDate() && picked.getHours() === futureToday.getHours());
  } else {
    console.log('(saltado: perto da meia-noite neste ambiente de teste, não afeta a lógica testada a seguir)');
  }

  // --- Pick a time that has already passed today -> must roll to tomorrow ---
  const pastToday = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
  const hh2 = String(pastToday.getHours()).padStart(2, '0');
  const mm2 = String(pastToday.getMinutes()).padStart(2, '0');
  await page.fill('#reminderTimeOnlyInput', `${hh2}:${mm2}`);
  await page.evaluate(() => quickPickReminderTimeToday());
  const value2 = await page.evaluate(() => document.getElementById('reminderDatetimeInput').value);
  const picked2 = new Date(value2);
  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  console.log('Hora já passada hoje rola para AMANHÃ à mesma hora:', picked2.getDate() === tomorrow.getDate() && picked2.getHours() === pastToday.getHours() && picked2.getTime() > Date.now());

  // --- Validation: no time chosen ---
  await page.fill('#reminderTimeOnlyInput', '');
  page.once('dialog', d => { console.log('Sem hora escolhida, mostra aviso claro:', d.message().includes('Escolhe uma hora')); d.accept(); });
  await page.evaluate(() => quickPickReminderTimeToday());
  await page.waitForTimeout(200);

  // --- End-to-end: use the picked time to actually create a reminder ---
  const futureTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const hh3 = String(futureTime.getHours()).padStart(2, '0');
  const mm3 = String(futureTime.getMinutes()).padStart(2, '0');
  await page.fill('#reminderTimeOnlyInput', `${hh3}:${mm3}`);
  await page.evaluate(() => quickPickReminderTimeToday());
  await page.fill('#reminderTextInput', 'Testar seletor de qualquer hora');
  await page.evaluate(() => addReminder());
  await page.waitForTimeout(500);
  const reminderCreated = await page.evaluate(() => REMINDERS.items.some(r => r.text === 'Testar seletor de qualquer hora'));
  console.log('Consegue mesmo criar um lembrete usando o seletor de hora:', reminderCreated);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
