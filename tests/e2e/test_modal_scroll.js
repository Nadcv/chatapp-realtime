const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // Small phone-sized viewport, matching the screenshot's scenario (content taller than screen).
  const page = await browser.newPage({ viewport: { width: 412, height: 700 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Scroll Test');
  await page.fill('#regUsername', 'scrolltest_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'scrolltest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => openProfileModal());
  await page.waitForSelector('#modalProfile.active', { timeout: 3000 });

  const modalEl = await page.evaluateHandle(() => document.querySelector('#modalProfile .modal'));
  const overflowsBeforeFix = await page.evaluate((el) => el.scrollHeight > el.clientHeight, modalEl);
  console.log('O conteúdo do perfil é mais alto do que o ecrã visível (por isso precisa de deslizar):', overflowsBeforeFix);

  const computedOverflowY = await page.evaluate((el) => getComputedStyle(el).overflowY, modalEl);
  console.log('O modal tem "overflow-y: auto" aplicado (permite deslizar):', computedOverflowY === 'auto');

  const maxHeightSet = await page.evaluate((el) => getComputedStyle(el).maxHeight !== 'none', modalEl);
  console.log('O modal tem um max-height definido (não cresce para lá do ecrã):', maxHeightSet);

  // Confirm the previously-cut-off "danger zone" content becomes reachable by scrolling.
  const dangerZoneHiddenBeforeScroll = await page.evaluate((el) => {
    const target = document.querySelector('#modalProfile');
    const btn = [...target.querySelectorAll('button')].find(b => b.textContent.includes('Apagar conta'));
    const rect = btn.getBoundingClientRect();
    return rect.top > window.innerHeight; // está fora da área visível antes de deslizar
  }, modalEl);
  console.log('Antes de deslizar, o botão "Apagar conta" está fora da área visível (reproduz o problema do print):', dangerZoneHiddenBeforeScroll);

  await page.evaluate((el) => { el.scrollTop = el.scrollHeight; }, modalEl);
  await page.waitForTimeout(200);
  const dangerZoneVisibleAfterScroll = await page.evaluate(() => {
    const target = document.querySelector('#modalProfile');
    const btn = [...target.querySelectorAll('button')].find(b => b.textContent.includes('Apagar conta'));
    const rect = btn.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  console.log('Depois de deslizar até ao fim, o botão "Apagar conta" já fica visível:', dangerZoneVisibleAfterScroll);

  // Sanity check: a short, unrelated modal is unaffected (no unwanted scrollbar/clipping).
  await page.evaluate(() => { closeModal('modalProfile'); openMyStatsModal(); });
  await page.waitForSelector('#modalMyStats.active', { timeout: 3000 });
  const statsModalStillFine = await page.evaluate(() => {
    const el = document.querySelector('#modalMyStats .modal');
    return getComputedStyle(el).maxHeight !== 'none';
  });
  console.log('Modais que já definiam o próprio max-height continuam a funcionar normalmente:', statsModalStillFine);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
