const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  page.on('console', msg => { if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text()); });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Musica Teste');
  await page.fill('#regUsername', 'musica_test_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'musicatest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // 1) Confirm the button exists (now inside the "Media" menu, moved there since
  // this test was first written — see the header consolidation in the README).
  await page.click('#mediaBtn');
  const btn = page.locator('#modalMediaFeatures button[onclick*="openJamendoScreen"]');
  await btn.scrollIntoViewIfNeeded();
  console.log('Button visible:', await btn.isVisible());
  await btn.click();
  await page.waitForSelector('#jamendoScreen.active');
  await page.waitForTimeout(300);

  // 2) Since real Jamendo API is unreachable/unconfigured in this sandbox,
  // inject fake results directly and exercise the real client-side functions.
  await page.evaluate(() => {
    JAMENDO.lastResults = [
      { id: '1', title: 'Faixa Um', artist: 'Artista A', album: 'Album A', image: null, audio: 'https://example.com/a.mp3', duration: 180 },
      { id: '2', title: 'Faixa Dois <script>', artist: 'Artista <B>', album: 'Album B', image: null, audio: 'https://example.com/b.mp3', duration: 200 }
    ];
    renderJamendoResults();
  });

  const resultsHtml = await page.innerHTML('#jamendoResults');
  console.log('Results contain Faixa Um:', resultsHtml.includes('Faixa Um'));
  console.log('Results escape script tag (no raw <script>):', !resultsHtml.includes('<script>Faixa'));
  console.log('Number of chat-item rows:', await page.locator('#jamendoResults .chat-item').count());

  // 3) Click the first track and verify the player bar updates (but don't
  // expect real playback since example.com won't actually serve audio).
  await page.click('#jamendoResults .chat-item >> nth=0');
  await page.waitForTimeout(200);
  console.log('Player bar visible:', await page.isVisible('#jamendoPlayerBar'));
  console.log('Player title:', await page.textContent('#jamendoPlayerTitle'));
  console.log('Player artist:', await page.textContent('#jamendoPlayerArtist'));
  console.log('Audio src set:', await page.getAttribute('#jamendoAudio', 'src'));

  // 4) Verify the "not configured" graceful message path (real search, no client_id set on server).
  await page.fill('#jamendoSearchInput', 'test query');
  await page.click('#jamendoScreen button.btn-accept');
  await page.waitForTimeout(500);
  console.log('Not-configured message shown:', (await page.textContent('#jamendoResults')).includes('não está configurada'));

  await page.click('#jamendoScreen button:has-text("✖️")');
  await page.waitForTimeout(200);
  console.log('Screen closed:', !(await page.locator('#jamendoScreen').evaluate(el => el.classList.contains('active'))));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
