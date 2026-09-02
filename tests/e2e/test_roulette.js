const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Roleta Teste');
  await page.fill('#regUsername', 'roleta_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'roleta' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  await page.click('button[onclick="openMoreFeaturesModal()"]');
  await page.waitForSelector('#modalMoreFeatures.active');
  await page.click('#modalMoreFeatures button:has-text("Roleta/Sorteio")');
  await page.waitForSelector('#rouletteScreen.active');

  // Spin button disabled with 0 options.
  const disabledEmpty = await page.isDisabled('#rouletteSpinBtn');
  console.log('Spin button disabled with 0 options:', disabledEmpty);

  // Add 1 option — still disabled (needs >= 2).
  await page.fill('#rouletteOptionInput', 'Pizza <script>');
  await page.click('#rouletteScreen button:has-text("➕")');
  const disabledOne = await page.isDisabled('#rouletteSpinBtn');
  console.log('Spin button still disabled with 1 option:', disabledOne);

  // Add 3 more (4 total).
  for (const opt of ['Sushi', 'Massa', 'Hambúrguer']) {
    await page.fill('#rouletteOptionInput', opt);
    await page.press('#rouletteOptionInput', 'Enter');
  }
  const optionsListHtml = await page.evaluate(() => document.getElementById('rouletteOptionsList').innerHTML);
  console.log('4 options rendered:', (await page.locator('#rouletteOptionsList > div').count()) === 4);
  console.log('First option name escaped safely (no raw <script>):', !optionsListHtml.includes('<script>'));

  const enabledFour = !(await page.isDisabled('#rouletteSpinBtn'));
  console.log('Spin button enabled with 4 options:', enabledFour);

  // Check wheel gradient got built with 4 slices.
  const wheelBg = await page.evaluate(() => document.getElementById('rouletteWheel').style.background);
  console.log('Wheel background is a conic-gradient:', wheelBg.startsWith('conic-gradient'));

  // Remove one option (down to 3), confirm re-render.
  await page.click('#rouletteOptionsList > div:nth-child(1) button');
  await page.waitForTimeout(100);
  console.log('Options after removing one (should be 3):', await page.locator('#rouletteOptionsList > div').count());

  // Spin and verify the final rotation lands the winning segment's center exactly at 0deg (mod 360),
  // and that the announced winner matches ROULETTE.options[winnerIndex] used internally.
  await page.evaluate(() => { Math.random = () => 0.1; }); // pin randomness for a deterministic winner index & spin count
  await page.click('#rouletteSpinBtn');
  const spinningDisabled = await page.isDisabled('#rouletteSpinBtn');
  console.log('Spin button disabled while spinning:', spinningDisabled);

  await page.waitForTimeout(4300);
  const resultText = await page.textContent('#rouletteResult');
  const finalRotation = await page.evaluate(() => ROULETTE.rotation);
  const options = await page.evaluate(() => ROULETTE.options);
  const n = options.length;
  const slice = 360 / n;
  // Recompute which slice's center is at the pointer (0deg) given finalRotation, and compare to the announced winner.
  const mod = ((finalRotation % 360) + 360) % 360;
  // finalRotation was chosen so that centerAngle_of_winner + finalRotation ≡ 0 (mod 360)
  // => centerAngle_of_winner ≡ -finalRotation (mod 360) ≡ (360 - mod) mod 360
  const expectedCenterAngle = (360 - mod) % 360;
  const recoveredIndex = Math.round(expectedCenterAngle / slice - 0.5) % n;
  console.log('Announced winner:', resultText.trim());
  console.log('Rotation math recovers the same winner index as announced:', resultText.includes(options[recoveredIndex]));
  console.log('Spin button re-enabled after spin completes:', !(await page.isDisabled('#rouletteSpinBtn')));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
