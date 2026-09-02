const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Gallery Test');
  await page.fill('#regUsername', 'gallery_' + ts);
  await page.fill('#regPhone', '+3518' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'gallery' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // A tiny valid data-URI PNG/MP4-ish stand-in (content doesn't need to be real for this UI test).
  const fakeImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const fakeVideo = 'data:video/mp4;base64,AAAAGGZ0eXBtcDQyAAAAAG1wNDJpc29t';

  await page.evaluate(({ fakeImg, fakeVideo }) => {
    APP.chats.push({ id: 'gallerygroup', type: 'group', name: 'Gallery Group' });
    APP.messages['gallerygroup'] = [
      { id: 'm1', sender: 'Ana', text: '', time: '10:00', type: 'received', fileData: fakeImg, fileName: 'foto1.png', fileType: 'image/png' },
      { id: 'm2', sender: 'Você', text: 'oi', time: '10:01', type: 'sent' }, // plain text message, should be excluded
      { id: 'm3', sender: 'Bruno', text: '', time: '10:02', type: 'received', fileData: fakeVideo, fileName: 'video1.mp4', fileType: 'video/mp4' },
      { id: 'm4', sender: 'Você', text: '', time: '10:03', type: 'sent', fileData: fakeImg, fileName: 'foto2.png', fileType: 'image/png', deleted: true }, // deleted, should be excluded
      { id: 'm5', sender: 'Ana', text: '', time: '10:04', type: 'received', fileData: fakeImg, fileName: 'foto3.png', fileType: 'image/png', viewOnce: true, viewOnceOpened: false }, // view-once, should ALWAYS be excluded
      { id: 'm6', sender: 'Você', text: '', time: '10:05', type: 'sent', fileData: 'data:application/pdf;base64,JVBERi0=', fileName: 'doc.pdf', fileType: 'application/pdf' }, // non-media file, should be excluded
      { id: 'm7', sender: 'Bruno', text: '', time: '10:06', type: 'received', fileData: fakeImg, fileName: 'foto4.png', fileType: 'image/png' }
    ];
    APP.currentChatId = 'gallerygroup';
  }, { fakeImg, fakeVideo });

  await page.evaluate(() => openMediaGalleryModal());
  await page.waitForSelector('#modalMediaGallery.active', { timeout: 3000 });

  const galleryCount = await page.evaluate(() => MEDIA_GALLERY.items.length);
  console.log('Gallery includes exactly 3 valid media items (foto1, video1, foto4):', galleryCount === 3);

  const excludesText = await page.evaluate(() => !MEDIA_GALLERY.items.some(m => m.id === 'm2'));
  console.log('Plain text messages are excluded from the gallery:', excludesText);
  const excludesDeleted = await page.evaluate(() => !MEDIA_GALLERY.items.some(m => m.id === 'm4'));
  console.log('Deleted messages are excluded from the gallery:', excludesDeleted);
  const excludesViewOnce = await page.evaluate(() => !MEDIA_GALLERY.items.some(m => m.id === 'm5'));
  console.log('View-once messages are ALWAYS excluded from the gallery (even unopened):', excludesViewOnce);
  const excludesDocs = await page.evaluate(() => !MEDIA_GALLERY.items.some(m => m.id === 'm6'));
  console.log('Non-media file attachments (PDF) are excluded from the gallery:', excludesDocs);

  const gridHtml = await page.evaluate(() => document.getElementById('mediaGalleryGrid').innerHTML);
  console.log('Grid renders a thumbnail for the image message:', gridHtml.includes(fakeImg.slice(0, 40)));
  console.log('Grid renders a play-icon overlay for the video message:', gridHtml.includes('▶️'));

  // Open the viewer on the first item (the image).
  await page.evaluate(() => openMediaGalleryViewer(0));
  await page.waitForSelector('#modalMediaGalleryViewer.active', { timeout: 3000 });
  const viewerShowsImage = await page.evaluate(() => document.getElementById('mediaGalleryViewerContent').innerHTML.includes('<img'));
  console.log('Viewer shows the image in full size for an image item:', viewerShowsImage);

  // Navigate to the video item.
  await page.evaluate(() => navigateMediaGallery(1));
  await page.waitForTimeout(200);
  const viewerShowsVideo = await page.evaluate(() => document.getElementById('mediaGalleryViewerContent').innerHTML.includes('<video'));
  console.log('Navigating forward shows the video item with a real <video> element:', viewerShowsVideo);

  // Navigate to the last item (foto4).
  await page.evaluate(() => navigateMediaGallery(1));
  await page.waitForTimeout(200);
  const atLastItem = await page.evaluate(() => MEDIA_GALLERY.index === 2);
  console.log('Navigation correctly reaches the last item (index 2):', atLastItem);

  // Navigating past the end should be a no-op (stay at the last item).
  await page.evaluate(() => navigateMediaGallery(1));
  await page.waitForTimeout(200);
  const stillAtLastItem = await page.evaluate(() => MEDIA_GALLERY.index === 2);
  console.log('Navigating past the last item is a no-op (does not go out of bounds):', stillAtLastItem);

  // Navigate backward to the start, and past the start should also be a no-op.
  await page.evaluate(() => { navigateMediaGallery(-1); navigateMediaGallery(-1); navigateMediaGallery(-1); });
  await page.waitForTimeout(200);
  const clampedAtStart = await page.evaluate(() => MEDIA_GALLERY.index === 0);
  console.log('Navigating past the first item is a no-op (clamped at index 0):', clampedAtStart);

  // Empty-state check with a chat that has no media at all.
  await page.evaluate(() => {
    APP.chats.push({ id: 'emptygallery', type: 'group', name: 'Empty Gallery' });
    APP.messages['emptygallery'] = [{ id: 'e1', sender: 'Ana', text: 'so texto', time: '09:00', type: 'received' }];
    APP.currentChatId = 'emptygallery';
    openMediaGalleryModal();
  });
  await page.waitForTimeout(200);
  const emptyStateShown = await page.evaluate(() => document.getElementById('mediaGalleryGrid').textContent.includes('Ainda não há'));
  console.log('Empty state is shown for a chat with no media:', emptyStateShown);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
