const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 38.7, longitude: -9.1 } });
  const page = await context.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Loc Safety Test');
  await page.fill('#regUsername', 'locsafetest_' + ts);
  await page.fill('#regPhone', '+3506' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'locsafetest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    APP.chats.push({ id: 'dm_locsafe', name: 'Loc Chat', phone: '+351000000009', type: 'user' });
    renderChatList();
  });
  await page.click('.chat-item:has-text("Loc Chat")');
  await page.waitForTimeout(200);

  // Note: openLocationScreen() initializes a Leaflet map loaded from
  // cdnjs.cloudflare.com, which this sandbox's outbound proxy blocks (an
  // external-CDN restriction, unrelated to this feature — works fine on
  // Railway). So this test drives toggleShareLocation()/the duration modal
  // directly instead of going through that screen; none of the sharing
  // logic itself touches the map (plotLocation() already no-ops if
  // LOCATION.map is unset, which it will be here).
  await page.evaluate(() => toggleShareLocation());
  await page.waitForSelector('#modalLocationShareDuration.active');
  const sharingImmediately = await page.evaluate(() => LOCATION.sharing === true);
  console.log('Clicking share does NOT start sharing immediately (asks duration first):', !sharingImmediately);

  // Pick 15 minutes.
  await page.click('button:has-text("15 min")');
  await page.waitForTimeout(300);
  const isSharing = await page.evaluate(() => LOCATION.sharing === true);
  console.log('Sharing actually starts after picking a duration:', isSharing);
  const hasExpiry = await page.evaluate(() => typeof LOCATION.shareExpiresAt === 'number' && LOCATION.shareExpiresAt > Date.now());
  console.log('An expiry timestamp in the near future is set:', hasExpiry);
  const expiryRoughlyMatches15Min = await page.evaluate(() => {
    const remainingMs = LOCATION.shareExpiresAt - Date.now();
    return remainingMs > 14 * 60 * 1000 && remainingMs <= 15 * 60 * 1000;
  });
  console.log('Expiry is set roughly 15 minutes out:', expiryRoughlyMatches15Min);

  // The always-visible banner should now be showing (app-wide, in the sidebar).
  const bannerVisible = await page.evaluate(() => document.getElementById('locationSharingBanner').style.display === 'flex');
  console.log('App-wide sharing banner is visible:', bannerVisible);
  const bannerText = await page.textContent('#locationSharingText');
  console.log('Banner mentions sharing and an end time:', bannerText.includes('partilhar') && /\d{2}:\d{2}/.test(bannerText));

  // Banner should stay visible even after navigating away from the location screen
  // WITHOUT explicitly stopping (closing the screen still auto-stops as a safety
  // net, so instead just check the banner exists independent of that screen being open).
  await page.click('.chat-item:has-text("Loc Chat")');
  await page.waitForTimeout(200);
  const bannerStillVisibleElsewhere = await page.evaluate(() => document.getElementById('locationSharingBanner').style.display === 'flex');
  console.log('Banner remains visible while browsing other parts of the app:', bannerStillVisibleElsewhere);

  // Stopping from the banner itself should work.
  await page.click('#locationSharingBanner button:has-text("Parar")');
  await page.waitForTimeout(200);
  const stoppedFromBanner = await page.evaluate(() => LOCATION.sharing === false);
  const bannerHiddenAfterStop = await page.evaluate(() => document.getElementById('locationSharingBanner').style.display === 'none');
  console.log('Stop button in the banner actually stops sharing:', stoppedFromBanner);
  console.log('Banner hides itself after stopping:', bannerHiddenAfterStop);

  // Closing the location screen while sharing should ALSO still auto-stop, as
  // an extra safety net (pre-existing behavior, must not have regressed).
  // closeLocationScreen() itself doesn't touch the map, only openLocationScreen()
  // does, so this is exercised directly without needing the (CDN-blocked) map.
  await page.evaluate(() => toggleShareLocation());
  await page.waitForSelector('#modalLocationShareDuration.active');
  await page.click('button:has-text("1 hora")');
  await page.waitForTimeout(200);
  await page.evaluate(() => closeLocationScreen());
  await page.waitForTimeout(200);
  const stoppedOnScreenClose = await page.evaluate(() => LOCATION.sharing === false);
  console.log('Closing the location screen still auto-stops sharing (safety net preserved):', stoppedOnScreenClose);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
