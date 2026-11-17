// Página de apresentação: aparece a quem abre a app pela primeira vez sem
// sessão (forçada aqui com window.__forceLanding, porque em browsers
// automatizados fica desligada para não atrapalhar os outros testes).
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { window.__forceLanding = true; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(300);
  const visible = await page.isVisible('#landingScreen');
  console.log('Primeira visita sem sessão mostra a página de apresentação:', visible);
  const text = await page.textContent('#landingScreen');
  console.log('Mostra o nome, a frase e as funcionalidades:', text.includes('NADIO') && text.includes('O teu mundo. A tua gente.') && text.includes('Chamadas de voz e vídeo'));

  await page.click('#landingScreen button:has-text("EN")');
  console.log('Botão EN traduz a página:', (await page.textContent('#landingCreateBtn')).includes('Get started'));
  await page.click('#landingScreen button:has-text("PT")');

  await page.click('#landingCreateBtn');
  console.log('"Começar" fecha a página e abre o registo:', !(await page.isVisible('#landingScreen')) && await page.isVisible('#registerFormBox'));

  await page.reload(); await page.waitForTimeout(300);
  await page.click('#landingLoginBtn');
  console.log('"Já tenho conta" abre o formulário de entrar:', !(await page.isVisible('#landingScreen')) && await page.isVisible('#loginFormBox'));

  // Depois de criar conta e sair, este aparelho já não mostra a apresentação.
  await page.click('.login-switch[onclick*="register"]');
  const ts = Date.now();
  await page.fill('#regName', 'Landing Teste'); await page.fill('#regUsername', 'landing_' + ts);
  await page.fill('#regPhone', '+3510' + String(ts).slice(-8)); await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', `landing${ts}@test.com`); await page.fill('#regPassword', 'senha123');
  await page.click('button[onclick="doRegister()"]');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.evaluate(() => { localStorage.removeItem('authToken'); localStorage.removeItem('authUser'); });
  await page.reload(); await page.waitForTimeout(300);
  console.log('Quem já entrou neste aparelho vai direto ao ecrã de entrar:', !(await page.isVisible('#landingScreen')) && await page.isVisible('#loginFormBox'));

  // Link de convite salta a apresentação (vai direto ao aviso "X convidou-te").
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => { window.__forceLanding = true; });
  const p2 = await ctx2.newPage();
  await p2.goto('http://localhost:3000/?convite=alguem'); await p2.waitForTimeout(300);
  console.log('Link de convite não mostra a apresentação:', !(await p2.isVisible('#landingScreen')));

  // Sem __forceLanding (browser automatizado), não aparece — os outros testes não são afetados.
  const p3 = await (await browser.newContext()).newPage();
  await p3.goto('http://localhost:3000'); await p3.waitForTimeout(300);
  console.log('Em browsers automatizados fica desligada:', !(await p3.isVisible('#landingScreen')));
  await browser.close();
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
