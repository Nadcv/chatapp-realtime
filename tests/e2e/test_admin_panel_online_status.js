const { chromium } = require('playwright');

// O painel de administrador (⚙️ "Utilizadores cadastrados") já listava todas
// as contas, mas não mostrava quem estava online NESTE momento — só o
// registo estático. Agora cada cartão tem um ponto verde/cinzento (online/
// offline) e um resumo "N cadastrado(s) · M online agora" no topo.
const ADMIN_SECRET = process.env.ADMIN_SIGNUP_SECRET || 'segredo-teste-123';

async function registerViaAdminArea(page, name, prefix) {
  await page.goto('http://localhost:3000');
  await page.click('.login-switch:has-text("Área do administrador")');
  await page.waitForSelector('#modalAdminRegister.active');
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3513' + ts.toString().slice(-8);
  await page.fill('#adminRegName', name);
  await page.fill('#adminRegUsername', prefix + ts);
  await page.fill('#adminRegPhone', phone);
  await page.selectOption('#adminRegCountry', 'Portugal');
  await page.fill('#adminRegEmail', prefix + ts + '@test.com');
  await page.fill('#adminRegPassword', 'senha1234forte');
  await page.fill('#adminRegSecret', ADMIN_SECRET);
  await page.click('#modalAdminRegister button:has-text("Criar conta de administrador")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { phone };
}

async function registerNormal(page, name, prefix) {
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  await page.waitForSelector('#registerFormBox', { state: 'visible' });
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = '+3513' + ts.toString().slice(-8);
  await page.fill('#regName', name);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { phone };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxAdmin = await browser.newContext();
  const ctxOnline = await browser.newContext();
  const ctxOffline = await browser.newContext();

  const adminPage = await ctxAdmin.newPage();
  await registerViaAdminArea(adminPage, 'Panel Admin', 'panelstatus_admin_');

  const onlinePage = await ctxOnline.newPage();
  const onlineUser = await registerNormal(onlinePage, 'Panel Online User', 'panelstatus_on_');

  const offlinePage = await ctxOffline.newPage();
  const offlineUser = await registerNormal(offlinePage, 'Panel Offline User', 'panelstatus_off_');
  // Fecha a página desta conta — o socket desliga, fica offline a sério.
  await offlinePage.close();
  await adminPage.waitForTimeout(600);

  await adminPage.evaluate(() => openAdminModal());
  await adminPage.waitForSelector('#modalAdmin.active', { timeout: 3000 });
  await adminPage.waitForTimeout(500);

  const onlineCardHasGreenDot = await adminPage.evaluate((phone) => {
    const cards = [...document.querySelectorAll('#adminUsersBody > div')];
    const card = cards.find(c => c.textContent.includes(phone));
    return !!card && card.textContent.includes('online agora') && card.innerHTML.includes('#25d366');
  }, onlineUser.phone);
  console.log('A conta que está ligada mostra o ponto verde e "online agora":', onlineCardHasGreenDot);

  const offlineCardIsGrey = await adminPage.evaluate((phone) => {
    const cards = [...document.querySelectorAll('#adminUsersBody > div')];
    const card = cards.find(c => c.textContent.includes(phone));
    return !!card && card.textContent.includes('offline') && !card.textContent.includes('online agora');
  }, offlineUser.phone);
  console.log('A conta que fechou a página aparece como offline:', offlineCardIsGrey);

  const summaryText = await adminPage.evaluate(() => document.getElementById('adminUsersOnlineCount').textContent);
  console.log('O resumo no topo mostra o total cadastrado e quantos estão online:', /\d+ cadastrado\(s\) · \d+ online agora/.test(summaryText));
  const summaryCountsAdminAndOnlineUser = await adminPage.evaluate(() => {
    const text = document.getElementById('adminUsersOnlineCount').textContent;
    const match = text.match(/(\d+) online agora/);
    return match && parseInt(match[1], 10) >= 2; // pelo menos o próprio admin + a conta online
  });
  console.log('A contagem de "online agora" inclui pelo menos o admin e a conta ligada:', summaryCountsAdminAndOnlineUser);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
