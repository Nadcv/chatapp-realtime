const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Estimated Trains Test');
  await page.fill('#regUsername', 'esttrains_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'esttrains' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const bounds = { getSouth: () => 36.8, getNorth: () => 42.2, getWest: () => -9.6, getEast: () => -6.1 };
    const chainable = { setView: () => chainable, addTo: () => chainable, invalidateSize: () => {}, on: () => chainable, removeLayer: () => chainable, hasLayer: () => false, clearLayers: () => chainable, addLayer: () => chainable, bindPopup: () => chainable, setLatLng: () => chainable, remove: () => {}, getBounds: () => bounds };
    window.L = { map: () => chainable, tileLayer: () => chainable, layerGroup: () => chainable, marker: () => chainable, divIcon: () => ({}), polyline: () => chainable, icon: () => ({}), circleMarker: () => chainable };
    window.fetch = ((realFetch) => (url, opts) => {
      if (String(url).startsWith('/api/metro/status')) return Promise.resolve(new Response(JSON.stringify({ lines: [] }), { status: 200 }));
      if (String(url).startsWith('/api/transport/buses')) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      return realFetch(url, opts);
    })(window.fetch.bind(window));
  });

  await page.evaluate(() => openTransportScreen());
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(300);

  const toggleHidden = await page.evaluate(() => document.getElementById('railScheduleBar').style.display === 'flex');
  console.log('Barra do separador Metro/Comboio (com o toggle) aparece:', toggleHidden);

  await page.check('#railEstimatedToggle');
  await page.waitForTimeout(600);
  const status1 = await page.evaluate(() => document.getElementById('railEstimatedStatus').textContent);
  // O endpoint /api/trains/positions-estimated combina CP e Fertagus — além dos
  // 2 comboios de CP em trânsito neste mock (T_TRAVELING, T_DWELLING), o mock da
  // Fertagus tem sempre o seu próprio FT2 "em trânsito agora" (ver
  // build_mock_fertagus_gtfs.js), por isso o total real é 3, não 2.
  console.log('Mostra "3 comboio(s) em trânsito" (2 CP + 1 Fertagus):', status1.includes('3 comboio'));

  const routeStopsCheck = await page.evaluate(async () => {
    const res = await fetch('/api/trains/positions-estimated');
    const data = await res.json();
    const t = (data.trains || [])[0];
    return !!(t && Array.isArray(t.routeStops) && t.routeStops.length === 3 && t.routeStops[0].name === 'Lisboa Oriente');
  });
  console.log('A API devolve a rota completa da viagem (routeStops) para desenhar a linha:', routeStopsCheck);

  const stopTimesCheck = await page.evaluate(async () => {
    const res = await fetch('/api/trains/positions-estimated');
    const data = await res.json();
    const t = (data.trains || [])[0];
    const stops = t?.routeStops || [];
    return stops.length === 3 && !!stops[0].departure && !!stops[stops.length - 1].arrival;
  });
  console.log('Cada paragem da rota inclui a hora do horário (partida/chegada):', stopTimesCheck);

  const uncertaintyCheck = await page.evaluate(async () => {
    const res = await fetch('/api/trains/positions-estimated');
    const data = await res.json();
    const t = (data.trains || []).find(x => x.tripId === 'T_TRAVELING');
    if (!t || typeof t.uncertainLat !== 'number' || typeof t.uncertaintyMin !== 'number') return { ok: false };
    const distMeters = haversineMeters(t.lat, t.lon, t.uncertainLat, t.uncertainLon);
    // A posição "com atraso" tem de ficar sempre mais atrás na rota (mais perto da
    // origem) do que a posição "a horas" — nunca à frente do horário.
    const distToOriginOnTime = haversineMeters(t.lat, t.lon, t.routeStops[0].lat, t.routeStops[0].lon);
    const distToOriginUncertain = haversineMeters(t.uncertainLat, t.uncertainLon, t.routeStops[0].lat, t.routeStops[0].lon);
    return { ok: true, distMeters, isBehind: distToOriginUncertain < distToOriginOnTime };
  });
  console.log('A API devolve uma posição "com atraso" (margem de incerteza), sempre mais atrás na rota:', uncertaintyCheck.ok && uncertaintyCheck.distMeters > 30 && uncertaintyCheck.isBehind);

  const detailHiddenBefore = await page.evaluate(() => document.getElementById('railTrainDetail').style.display === 'none' || document.getElementById('railTrainDetail').style.display === '');
  console.log('Painel de detalhes começa escondido:', detailHiddenBefore);

  await page.evaluate(() => {
    window.__polylineCalls = [];
    const origPolyline = L.polyline;
    L.polyline = (latlngs, opts) => { window.__polylineCalls.push({ count: latlngs.length, opts }); return origPolyline(latlngs, opts); };
  });
  await page.evaluate(() => selectEstimatedTrain('T_TRAVELING'));
  await page.waitForTimeout(200);
  const uncertaintyLineDrawn = await page.evaluate(() => window.__polylineCalls.some(c => c.count === 2 && c.opts && c.opts.color === '#e74c3c'));
  console.log('O mapa desenha a margem de incerteza (linha a vermelho) para o comboio selecionado:', uncertaintyLineDrawn);
  const detail = await page.evaluate(() => ({
    visible: document.getElementById('railTrainDetail').style.display === 'flex',
    title: document.getElementById('railTrainDetailTitle').textContent,
    status: document.getElementById('railTrainDetailStatus').textContent,
    stopsHtml: document.getElementById('railTrainDetailStops').innerHTML
  }));
  console.log('Selecionar um comboio mostra o painel de detalhes:', detail.visible);
  console.log('O painel de detalhes menciona a margem de incerteza (mais atrás se houver atraso):', detail.status.includes('mais atrás'));

  console.log('Mostra o nome da rota no título:', detail.title.includes('Alfa Pendular'));
  console.log('Mostra o estado (entre estações, estimado):', detail.status.includes('Vila Franca de Xira') && detail.status.includes('estimado'));
  console.log('Mostra as 3 paragens no itinerário, com a atual marcada (🚂):', detail.stopsHtml.includes('Lisboa Oriente') && detail.stopsHtml.includes('Vila Franca de Xira') && detail.stopsHtml.includes('Porto Campanha') && detail.stopsHtml.includes('🚂'));

  await page.evaluate(() => deselectEstimatedTrain());
  await page.waitForTimeout(200);
  const detailHiddenAfter = await page.evaluate(() => document.getElementById('railTrainDetail').style.display === 'none');
  console.log('Fechar os detalhes esconde o painel:', detailHiddenAfter);

  // Desliga o toggle e confirma que o estado é limpo
  await page.uncheck('#railEstimatedToggle');
  await page.waitForTimeout(300);
  const status2 = await page.evaluate(() => document.getElementById('railEstimatedStatus').textContent);
  console.log('Desligar o toggle limpa o estado:', status2 === '');

  // Muda de aba e confirma que o toggle não fica preso ligado
  await page.check('#railEstimatedToggle');
  await page.waitForTimeout(600);
  await page.click('.transport-tab[data-tab="bus"]');
  await page.waitForTimeout(300);
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(300);
  const toggleUnchecked = await page.evaluate(() => !document.getElementById('railEstimatedToggle').checked);
  console.log('Mudar de aba e voltar desliga o toggle (não fica a sondar em segundo plano):', toggleUnchecked);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
