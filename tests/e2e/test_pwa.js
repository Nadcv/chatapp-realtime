const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', err => consoleErrors.push('PAGE EXCEPTION: ' + err.message));
  page.on('console', msg => {
    // ERR_TUNNEL_CONNECTION_FAILED (CDNs bloqueados pelo proxy deste sandbox) e
    // respostas 404/502 de APIs externas (notícias, meteorologia, etc., também
    // bloqueadas aqui) não têm nada a ver com a PWA — acontecem em qualquer
    // teste nesta suite, independentemente do que está a ser testado.
    const text = msg.text();
    const isKnownSandboxNoise = text.includes('ERR_TUNNEL_CONNECTION_FAILED')
      || /Failed to load resource: the server responded with a status of (404|502)/.test(text);
    if (msg.type() === 'error' && !isKnownSandboxNoise) consoleErrors.push('CONSOLE ERROR: ' + text);
  });

  await page.goto('http://localhost:3000');

  const manifestHref = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href'));
  console.log('Tem <link rel="manifest">:', manifestHref === '/manifest.json');

  const themeColor = await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'));
  console.log('Tem meta theme-color:', !!themeColor);

  const appleTouchIcon = await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
  console.log('Tem apple-touch-icon:', appleTouchIcon === '/icon-192.png');

  const appleCapable = await page.evaluate(() => document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content'));
  console.log('Tem apple-mobile-web-app-capable:', appleCapable === 'yes');

  // Espera o service worker registar (chamado dentro de window.addEventListener('load', ...))
  let swRegistered = false;
  for (let i = 0; i < 10 && !swRegistered; i++) {
    await page.waitForTimeout(500);
    swRegistered = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.some(r => !!r.active);
    });
  }
  console.log('Service worker regista e fica ativo:', swRegistered);

  const manifestRes = await page.evaluate(async () => {
    const res = await fetch('/manifest.json');
    const data = await res.json();
    return { ok: res.ok, hasIcons192: data.icons.some(i => i.sizes === '192x192'), hasIcons512: data.icons.some(i => i.sizes === '512x512'), display: data.display };
  });
  console.log('Manifest válido com ícones 192/512 e display standalone:', manifestRes.ok && manifestRes.hasIcons192 && manifestRes.hasIcons512 && manifestRes.display === 'standalone');

  console.log('Sem erros na consola:', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Erros encontrados:', consoleErrors);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
