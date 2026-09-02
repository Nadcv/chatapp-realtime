const { chromium } = require('playwright');

// Testa só o lado do cliente (render do estado do Metro de Lisboa) — a API real
// (api.metrolisboa.pt) não está acessível desta sandbox, por isso substituímos o
// fetch('/api/metro/status') no browser para simular as respostas do servidor.
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Metro Test');
  await page.fill('#regUsername', 'metro_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'metro' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  await page.evaluate(() => {
    const bounds = { getSouth: () => -90, getNorth: () => 90, getWest: () => -180, getEast: () => 180 };
    const chainable = { setView: () => chainable, addTo: () => chainable, invalidateSize: () => {}, on: () => chainable, removeLayer: () => chainable, hasLayer: () => false, clearLayers: () => chainable, addLayer: () => chainable, bindPopup: () => chainable, setLatLng: () => chainable, remove: () => {}, getBounds: () => bounds };
    window.L = { map: () => chainable, tileLayer: () => chainable, layerGroup: () => chainable, marker: () => chainable, divIcon: () => ({}), polyline: () => chainable, icon: () => ({}) };

    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      if (String(url).startsWith('/api/metro/status')) {
        window.__metroStatusCallCount = (window.__metroStatusCallCount || 0) + 1;
        if (window.__metroStatusMode === 'error') {
          return Promise.resolve(new Response(JSON.stringify({ error: 'Não foi possível obter o estado do Metro de Lisboa agora: HTTP 503 ao obter as linhas' }), { status: 503 }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          lines: [
            { id: 'pt-ml-azul', name: 'Azul', color: '#0000FF', status: 'Serviço normal' },
            { id: 'pt-ml-amarela', name: 'Amarela', color: '#FFFF00', status: 'Circulação Perturbada' },
            { id: 'pt-ml-vermelha', name: 'Vermelha', color: '#FF0000', status: 'Serviço normal' },
            { id: 'pt-ml-verde', name: 'Verde', color: '#00FF00', status: 'Serviço normal' }
          ]
        }), { status: 200 }));
      }
      return realFetch(url, opts);
    };
  });

  await page.evaluate(() => openTransportScreen());
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(400);

  const statusText = await page.evaluate(() => document.getElementById('metroStatusBar').textContent);
  console.log('Mostra a linha Azul com o estado correto:', statusText.includes('Azul') && statusText.includes('Serviço normal'));
  console.log('Mostra a linha Amarela com o estado (perturbada) correto:', statusText.includes('Amarela') && statusText.includes('Circulação Perturbada'));
  console.log('Mostra a linha Vermelha:', statusText.includes('Vermelha'));
  console.log('Mostra a linha Verde:', statusText.includes('Verde'));

  // Muda para outro separador e volta — deve recarregar o estado (nova chamada)
  await page.evaluate(() => { window.__metroStatusCallCount = 0; });
  await page.click('.transport-tab[data-tab="bus"]');
  await page.waitForTimeout(200);
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(400);
  const callCountAfterReturn = await page.evaluate(() => window.__metroStatusCallCount);
  console.log('Voltar ao separador Metro/Comboio recarrega o estado:', callCountAfterReturn === 1);

  // Simula erro (ex.: variável de ambiente não configurada no servidor)
  await page.evaluate(() => { window.__metroStatusMode = 'error'; });
  await page.click('.transport-tab[data-tab="bus"]');
  await page.waitForTimeout(200);
  await page.click('.transport-tab[data-tab="rail"]');
  await page.waitForTimeout(400);
  const errorText = await page.evaluate(() => document.getElementById('metroStatusBar').textContent);
  console.log('Mostra um erro amigável quando a API falha, sem crashar (sem PAGE EXCEPTION acima):', errorText.includes('Não foi possível obter o estado do Metro de Lisboa'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
