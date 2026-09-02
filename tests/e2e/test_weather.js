const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Weather Teste');
  await page.fill('#regUsername', 'weather_' + ts);
  await page.fill('#regPhone', '+3512' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'weather' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  // 1) Confirm the button lives inside "Mais", not the direct header.
  const directCount = await page.locator('.header-actions > button[onclick="openWeatherScreen()"]').count();
  console.log('Direct header button for weather (should be 0, lives in Mais):', directCount);

  await page.click('button[onclick="openMoreFeaturesModal()"]');
  await page.waitForSelector('#modalMoreFeatures.active');
  const inMenu = await page.locator('#modalMoreFeatures button:has-text("Meteorologia")').count();
  console.log('Weather button inside "Mais" menu:', inMenu > 0);

  // 2) Mock window.fetch for /api/weather (sandbox can't reach open-meteo.com), then exercise the real client function.
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      if (typeof url === 'string' && url.startsWith('/api/weather')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            place: { name: 'Lisboa', admin1: 'Lisboa', country: 'Portugal' },
            current: { temperature_2m: 22.4, apparent_temperature: 21.8, relative_humidity_2m: 55, wind_speed_10m: 14.3, weather_code: 1 },
            daily: {
              time: ['2026-08-19', '2026-08-20', '2026-08-21'],
              weather_code: [1, 61, 0],
              temperature_2m_max: [26, 22, 27],
              temperature_2m_min: [18, 17, 19],
              precipitation_probability_max: [5, 70, 0]
            }
          })
        });
      }
      return realFetch(url, opts);
    };
  });

  await page.click('#modalMoreFeatures button:has-text("Meteorologia")');
  await page.waitForSelector('#weatherScreen.active');
  await page.fill('#weatherSearchInput', 'Lisboa');
  await page.click('#weatherScreen button.btn-accept');
  await page.waitForTimeout(300);

  const resultsText = await page.textContent('#weatherResults');
  console.log('Shows place name:', resultsText.includes('Lisboa'));
  console.log('Shows current temp 22°C:', resultsText.includes('22°C'));
  console.log('Shows description "Poucas nuvens":', resultsText.includes('Poucas nuvens'));
  console.log('Shows 3 forecast rows:', (await page.locator('#weatherResults > div:last-child > div').count()) === 3);
  console.log('Shows rain chance 70%:', resultsText.includes('70%'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
