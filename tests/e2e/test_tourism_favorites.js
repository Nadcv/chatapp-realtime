const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.addInitScript(() => {
    function FakeLayerGroup() { this._layers = []; }
    FakeLayerGroup.prototype.addTo = function () { return this; };
    FakeLayerGroup.prototype.clearLayers = function () { this._layers = []; };
    FakeLayerGroup.prototype.getLayers = function () { return this._layers; };
    function FakeMarker(latlng) { this._latlng = { lat: latlng[0], lng: latlng[1] }; this._tooltip = null; this._handlers = {}; }
    FakeMarker.prototype.bindTooltip = function (text) { this._tooltip = text; return this; };
    FakeMarker.prototype.getTooltip = function () { return { getContent: () => this._tooltip }; };
    FakeMarker.prototype.on = function (evt, cb) { this._handlers[evt] = cb; return this; };
    FakeMarker.prototype.fire = function (evt) { if (this._handlers[evt]) this._handlers[evt](); };
    FakeMarker.prototype.addTo = function (target) { target._layers.push(this); return this; };
    function FakeMap(center, zoom) { this._center = { lat: center[0], lng: center[1] }; this._zoom = zoom; this._handlers = {}; this._layers = []; }
    FakeMap.prototype.setView = function (latlng, zoom) { this._center = { lat: latlng[0], lng: latlng[1] }; if (zoom != null) this._zoom = zoom; return this; };
    FakeMap.prototype.getCenter = function () { return this._center; };
    FakeMap.prototype.getZoom = function () { return this._zoom; };
    FakeMap.prototype.on = function (evt, cb) { this._handlers[evt] = cb; return this; };
    FakeMap.prototype.invalidateSize = function () {};
    FakeMap.prototype.removeLayer = function () {};
    FakeMap.prototype.fitBounds = function () {};
    window.L = {
      map: () => new FakeMap([39.5, -8], 6),
      tileLayer: () => ({ addTo: () => {} }),
      layerGroup: () => new FakeLayerGroup(),
      marker: (latlng) => new FakeMarker(latlng)
    };
  });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Tourism Fav Test');
  await page.fill('#regUsername', 'tourismfav_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'tourismfav' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(500); // dá tempo ao tourism_favorites_list inicial (vazio) chegar

  await page.evaluate(() => openTourismScreen());
  await page.waitForSelector('#tourismScreen.active', { timeout: 3000 });

  // Regressão do mesmo bug de z-index já corrigido no Turismo/Estados: o modal
  // de favoritos também tem de aparecer POR CIMA do ecrã de Turismo.
  await page.evaluate(() => openTourismFavoritesModal());
  await page.waitForSelector('#modalTourismFavorites.active', { timeout: 3000 });
  const favModalZIndex = await page.evaluate(() => parseInt(getComputedStyle(document.getElementById('modalTourismFavorites')).zIndex, 10));
  const tourismScreenZIndex = await page.evaluate(() => parseInt(getComputedStyle(document.getElementById('tourismScreen')).zIndex, 10));
  console.log('Favorites modal has a higher z-index than the Turismo screen (no repeat of the earlier bug):', favModalZIndex > tourismScreenZIndex);

  const emptyStateShown = await page.evaluate(() => document.getElementById('tourismFavoritesList').textContent.includes('Ainda não guardaste'));
  console.log('Shows an empty-state message before any favorite is saved:', emptyStateShown);
  await page.click('#modalTourismFavorites button:has-text("Fechar")');

  // Abre um ponto e guarda-o como favorito.
  await page.evaluate(() => openTourismPoi({ title: 'Torre de Belém', lat: 38.6916, lon: -9.216, wikiTitle: null }));
  await page.waitForSelector('#modalTourismPoi.active', { timeout: 3000 });
  await page.waitForTimeout(300);

  const initialButtonText = await page.evaluate(() => document.getElementById('tourismPoiFavBtn').textContent);
  console.log('Favorite button starts as "Guardar" for a point not yet saved:', initialButtonText.includes('Guardar') && !initialButtonText.includes('Guardado'));

  await page.click('#tourismPoiFavBtn');
  await page.waitForTimeout(500);
  const buttonAfterSave = await page.evaluate(() => document.getElementById('tourismPoiFavBtn').textContent);
  console.log('Favorite button switches to "Guardado" after saving:', buttonAfterSave.includes('Guardado'));

  const favCountAfterSave = await page.evaluate(() => TOURISM.favorites.length);
  console.log('The favorite is actually persisted server-side (round-tripped back):', favCountAfterSave === 1);

  // Reabrir o MESMO ponto (nova instância do objeto point) deve continuar a mostrar "Guardado".
  await page.click('#modalTourismPoi button:has-text("Fechar")');
  await page.evaluate(() => openTourismPoi({ title: 'Torre de Belém', lat: 38.6916, lon: -9.2160, wikiTitle: null }));
  await page.waitForTimeout(300);
  const stillMarkedSaved = await page.evaluate(() => document.getElementById('tourismPoiFavBtn').textContent.includes('Guardado'));
  console.log('Reopening the same point (matched by name+coordinates) still shows it as saved:', stillMarkedSaved);

  // Um ponto DIFERENTE não deve aparecer como guardado.
  await page.click('#modalTourismPoi button:has-text("Fechar")');
  await page.evaluate(() => openTourismPoi({ title: 'Mosteiro dos Jerónimos', lat: 38.6979, lon: -9.2065, wikiTitle: null }));
  await page.waitForTimeout(300);
  const differentPointNotSaved = await page.evaluate(() => !document.getElementById('tourismPoiFavBtn').textContent.includes('Guardado'));
  console.log('A different point is correctly NOT shown as saved:', differentPointNotSaved);
  await page.click('#modalTourismPoi button:has-text("Fechar")');

  // A lista de favoritos agora deve mostrar a Torre de Belém.
  await page.evaluate(() => openTourismFavoritesModal());
  await page.waitForTimeout(200);
  const favListHtml = await page.evaluate(() => document.getElementById('tourismFavoritesList').innerHTML);
  console.log('The favorites list shows the saved point:', favListHtml.includes('Torre de Belém'));

  // Clicar no favorito fecha a lista, centra o mapa lá, e abre a ficha do ponto.
  await page.click('#tourismFavoritesList .chat-item');
  await page.waitForTimeout(400);
  const favModalClosed = await page.evaluate(() => !document.getElementById('modalTourismFavorites').classList.contains('active'));
  const poiModalOpenAgain = await page.evaluate(() => document.getElementById('modalTourismPoi').classList.contains('active'));
  const poiTitleMatches = await page.evaluate(() => document.getElementById('tourismPoiTitle').textContent === 'Torre de Belém');
  const mapCenteredThere = await page.evaluate(() => Math.abs(TOURISM.map.getCenter().lat - 38.6916) < 0.001);
  console.log('Clicking a saved favorite closes the list, opens the point, and centers the map there:', favModalClosed && poiModalOpenAgain && poiTitleMatches && mapCenteredThere);

  // Remover o favorito (toggle) deve refletir-se na lista e no botão.
  await page.click('#tourismPoiFavBtn'); // agora está "Guardado" -> remove
  await page.waitForTimeout(500);
  const buttonAfterRemove = await page.evaluate(() => document.getElementById('tourismPoiFavBtn').textContent);
  console.log('Toggling the button again removes the favorite:', buttonAfterRemove.includes('Guardar') && !buttonAfterRemove.includes('Guardado'));
  const favCountAfterRemove = await page.evaluate(() => TOURISM.favorites.length);
  console.log('The favorites list is now empty again:', favCountAfterRemove === 0);

  // XSS safety: um título malicioso guardado como favorito não deve executar na lista.
  await page.evaluate(() => {
    socket.emit('save_tourism_favorite', { title: '<img src=x onerror="window.__favXssFired=true">', lat: 10, lon: 10, wikiTitle: null });
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => openTourismFavoritesModal());
  await page.waitForTimeout(200);
  const xssFired = await page.evaluate(() => window.__favXssFired === true);
  console.log('A malicious favorite title does NOT execute as script (XSS-safe):', !xssFired);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
