const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Contacts Menu Teste');
  await page.fill('#regUsername', 'contacts_menu_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'contactsmenu' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  const directFns = ['openCreateGroupModal()', 'openBroadcastScreen()', 'openNewCallModal()', 'openSearchUserModal()', 'openCallLogScreen()', 'openArchivedScreen()'];
  for (const fn of directFns) {
    const count = await page.locator(`.header-actions > button[onclick="${fn}"]`).count();
    console.log(`Direct header button for ${fn} (should be 0):`, count);
  }

  // adminBtn should still exist and be toggleable (even if hidden for non-admin).
  const adminBtnExists = await page.locator('#adminBtn').count();
  console.log('adminBtn still present in header:', adminBtnExists === 1);

  await page.click('button[onclick="openContactsFeaturesModal()"]');
  await page.waitForSelector('#modalContactsFeatures.active');
  const buttons = await page.locator('#modalContactsFeatures button.btn-small').allTextContents();
  console.log('Contacts modal buttons:', buttons.map(t => t.trim()));

  // Click "Nova chamada" to confirm it opens the right modal and closes this one.
  await page.click('#modalContactsFeatures button:has-text("Nova chamada")');
  await page.waitForTimeout(300);
  const callModalOpen = await page.locator('#modalNewCall').evaluate(el => el.classList.contains('active')).catch(() => null);
  const thisModalClosed = await page.locator('#modalContactsFeatures').evaluate(el => !el.classList.contains('active'));
  console.log('New Call modal opened (id may differ, null = element not found):', callModalOpen);
  console.log('Contacts modal closed after click:', thisModalClosed);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
