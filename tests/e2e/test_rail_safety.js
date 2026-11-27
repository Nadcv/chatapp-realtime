// Segurança ferroviária: passagens de nível (Overpass falso), aviso ao
// aproximar (voz/vibração/faixa), avisos oficiais das linhas seguidas
// (GTFS-RT falso), reportar perigo e guia a bordo, e o aviso nas posições
// estimadas. Servidor próprio + mocks locais (portas 3031 e 3032).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3101, OVP = 3031, ALR = 3032;
const B = `http://localhost:${PORT}`;
// Ponto de teste: Lisboa (Sete Rios). Passagens: uma a ~150 m (sem proteção), outra a ~1,5 km (cancela).
const HOME = { lat: 38.7400, lon: -9.1660 };

(async () => {
  let overpassCalls = 0;
  const ovp = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      overpassCalls++;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ elements: [
        { type: 'node', id: 1, lat: 38.7413, lon: -9.1660, tags: { railway: 'level_crossing', 'crossing:barrier': 'no', 'crossing:light': 'no' } },
        { type: 'node', id: 2, lat: 38.7535, lon: -9.1660, tags: { railway: 'level_crossing', 'crossing:barrier': 'full', name: 'PN Benfica' } },
        { type: 'node', id: 3, lat: 38.7390, lon: -9.1675, tags: { railway: 'crossing', 'crossing:light': 'yes' } }
      ] }));
    });
  }).listen(OVP);
  let alertsJson = { entity: [
    { id: 'a1', alert: { header_text: { translation: [{ text: 'C-5: circulación interrumpida entre Atocha y Fuenlabrada', language: 'es' }] }, description_text: { translation: [{ text: 'Por incidencia en la infraestructura.', language: 'es' }] }, informed_entity: [{ route_id: 'C5' }] } },
    { id: 'a2', alert: { header_text: { translation: [{ text: 'C-3: retrasos de 10 minutos', language: 'es' }] }, informed_entity: [{ route_id: 'C3' }] } },
    { id: 'old', alert: { header_text: { translation: [{ text: 'Aviso antigo' }] }, active_period: [{ start: 1000, end: 2000 }] } }
  ] };
  const alr = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(alertsJson)); }).listen(ALR);

  const root = path.join(__dirname, '..', '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'railsafe-'));
  for (const f of ['server.js', 'package.json', 'index.html', 'manifest.json', 'sw.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  for (const d of ['js', 'css']) if (fs.existsSync(path.join(root, d))) fs.cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const env = { ...process.env, PORT: String(PORT), MONGO_URI: '', OVERPASS_API_BASE: `http://localhost:${OVP}/api/interpreter`,
    RAIL_ALERT_SOURCES: JSON.stringify([{ id: 'renfe', name: 'Renfe — Cercanías/Rodalies', url: `http://localhost:${ALR}/alerts.json` }]), RAIL_ALERTS_CHECK_SECONDS: '2' };
  delete env.RESEND_API_KEY; delete env.EMAIL_USER;
  const srv = spawn(process.execPath, ['server.js'], { cwd: dir, env, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(B + '/'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
    const ts = String(Date.now()).slice(-7);
    const reg = await fetch(B + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rail', username: 'rail' + ts, phone: '+35191' + ts, country: 'PT', email: `r${ts}@example.com`, password: 'Zq8!vRt2mLp' }) }).then(r => r.json());

    // API das passagens de nível.
    const lc = await fetch(`${B}/api/rail/level-crossings?lat=${HOME.lat}&lon=${HOME.lon}&radius=2000`).then(r => r.json());
    const near = lc.crossings?.[0];
    console.log('Passagens de nível: ordenadas pela distância, com tipo e proteção:', lc.crossings?.length === 3 && near.id === 1 && near.protection === 'none' && near.kind === 'road' && lc.crossings.find(c => c.id === 2).protection === 'barrier' && lc.crossings.find(c => c.id === 3).kind === 'pedestrian' && lc.crossings.find(c => c.id === 3).protection === 'signals');
    console.log('Distância calculada corretamente (~145 m):', near.distance > 120 && near.distance < 170);
    console.log('Localização inválida é recusada (400):', (await fetch(`${B}/api/rail/level-crossings?lat=abc&lon=1`)).status === 400);

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', geolocation: { latitude: 38.7300, longitude: HOME.lon }, permissions: ['geolocation'] });
    await ctx.addInitScript(() => {
      window.__spoken = []; window.__vibrated = 0;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(u) { if (u.text) window.__spoken.push(u.text); } } });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: function (t) { this.text = t; } });
      navigator.vibrate = () => { window.__vibrated++; return true; };
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
    await page.goto(B);
    await page.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('authUser', JSON.stringify(u)); }, [reg.token, reg.user]);
    await page.reload(); await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

    // Aviso nas posições estimadas (no separador dos comboios).
    const note = await page.textContent('#railEstimatedSafetyNote');
    console.log('As posições estimadas avisam para nunca as usar para atravessar a linha:', note.includes('Nunca uses esta informação para atravessar a linha'));

    // Ecrã: passagens de nível.
    await page.evaluate(() => openRailSafetyScreen());
    await ctx.setGeolocation({ latitude: HOME.lat, longitude: HOME.lon });
    await page.click('#rsCrossings button:has-text("Usar a minha localização")');
    await page.waitForSelector('#rsCrossingsList .rs-item', { timeout: 8000 }).catch(() => {});
    const items = await page.$$eval('#rsCrossingsList .rs-item', els => els.map(e => e.textContent.replace(/\s+/g, ' ')));
    console.log('Lista mostra a passagem mais próxima primeiro, com "Sem proteção":', items.length === 3 && items[0].includes('Sem proteção') && /a 1\d\d m/.test(items[0]));

    // Aviso ao aproximar: começa longe (~1,1 km, fora do raio) e aproxima-se.
    await ctx.setGeolocation({ latitude: 38.7300, longitude: HOME.lon });
    await page.check('#rsProximityToggle');
    await page.waitForTimeout(1500);
    console.log('Longe das passagens não há aviso:', !(await page.isVisible('#rsProximityBanner')) && (await page.evaluate(() => window.__spoken.length)) === 0);
    await ctx.setGeolocation({ latitude: 38.7400, longitude: -9.1648 }); // ~180 m da PN sem proteção (e a mais de 150 m da pedonal)
    await page.waitForFunction(() => document.getElementById('rsProximityBanner').style.display === 'block', { timeout: 8000 }).catch(() => {});
    const banner = await page.textContent('#rsProximityBanner');
    const spoken = await page.evaluate(() => window.__spoken);
    console.log('Perto de uma passagem: faixa vermelha, voz e vibração:', banner.includes('Passagem de nível a') && banner.includes('sem cancela nem sinais') && spoken.some(t => t.includes('passagem de nível')) && (await page.evaluate(() => window.__vibrated)) > 0);
    await ctx.setGeolocation({ latitude: 38.7401, longitude: -9.1648 });
    await page.waitForTimeout(1500);
    console.log('Não repete a voz para a mesma passagem logo a seguir:', (await page.evaluate(() => window.__spoken.length)) === spoken.length);
    await page.uncheck('#rsProximityToggle');

    // Avisos das linhas.
    await page.click('.rs-tab[data-rs="alerts"]');
    await page.waitForSelector('#rsAlertSources .rs-source', { timeout: 5000 });
    console.log('Mostra a fonte oficial e os links oficiais de Portugal:', (await page.textContent('#rsAlertSources')).includes('Renfe') && (await page.textContent('#rsOfficialLinks')).includes('Infraestruturas de Portugal'));
    await page.check('#rsAlertSources .rs-follow-check');
    await page.fill('#rsAlertSources .rs-follow-filter', 'C-5');
    await page.click('button:has-text("Guardar as minhas linhas")');
    await page.waitForFunction(() => document.querySelectorAll('#rsAlertsList .rs-alert').length > 0, { timeout: 8000 }).catch(() => {});
    const alertsTxt = await page.textContent('#rsAlertsList');
    console.log('Seguir "C-5" mostra só os avisos dessa linha (e não os antigos):', alertsTxt.includes('C-5: circulación interrumpida') && !alertsTxt.includes('C-3') && !alertsTxt.includes('Aviso antigo'));
    // Novo aviso na linha seguida → chega em tempo real.
    alertsJson.entity.push({ id: 'a3', alert: { header_text: { translation: [{ text: 'C-5: servicio restablecido' }] }, informed_entity: [{ route_id: 'C5' }] } });
    await page.click('.rs-tab[data-rs="report"]');
    const gotToast = await page.waitForFunction(() => [...document.querySelectorAll('.rs-toast')].some(t => t.textContent.includes('C-5: servicio restablecido')), { timeout: 10000 }).then(() => true).catch(() => false);
    console.log('Um aviso novo na linha seguida chega em tempo real:', gotToast);

    // Reportar perigo.
    console.log('Reportar tem o botão para ligar 112:', (await page.getAttribute('#rsReport a.rs-call', 'href')) === 'tel:112');
    await page.selectOption('#rsReportType', 'Passagem de nível avariada');
    await page.fill('#rsReportText', 'Cancela levantada com as luzes a piscar');
    await page.click('#rsReport button:has-text("Juntar a minha localização")');
    await page.waitForFunction(() => document.getElementById('rsReportLocation').textContent.includes('38.'), { timeout: 5000 }).catch(() => {});
    const text = await page.evaluate(() => railReportText());
    console.log('O reporte junta tipo, descrição e localização com link do mapa:', text.includes('Passagem de nível avariada') && text.includes('Cancela levantada') && text.includes('google.com/maps?q=38.7401'));

    // Guia a bordo.
    await page.click('.rs-tab[data-rs="onboard"]');
    const guide = await page.textContent('#rsOnboard');
    console.log('Guia a bordo diz para não sair para a via e tem o SOS:', guide.includes('Não saias para a via') && (await page.isVisible('#rsOnboard button:has-text("SOS")')));
  } finally {
    await browser.close(); srv.kill(); ovp.close(); alr.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
