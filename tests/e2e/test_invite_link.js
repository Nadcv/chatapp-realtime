// Convidar amigos por link: /?convite=<nome de utilizador> mostra "<Nome>
// convidou-te" no ecrã de entrada e, depois de criar conta, abre a conversa
// com quem convidou. O link não expõe o telefone de ninguém.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ts = Date.now();
  const inviterUsername = 'convida_' + ts;
  const reg = await fetch('http://localhost:3000/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Marta Convida', username: inviterUsername, phone: '+3519' + String(ts).slice(-8), country: 'PT', email: `convida${ts}@test.com`, password: 'Zq8!vRt2mLp' }) }).then(r => r.json());
  console.log('Quem convida tem conta com nome de utilizador:', reg.user?.username === inviterUsername);

  const lookup = await fetch('http://localhost:3000/api/invite/' + inviterUsername).then(r => r.json());
  console.log('Endpoint do convite devolve só o nome, sem telefone:', lookup.found === true && lookup.name === 'Marta Convida' && !('phone' in lookup) && !JSON.stringify(lookup).includes(reg.user.phone));
  const unknown = await fetch('http://localhost:3000/api/invite/ninguem_' + ts).then(r => r.json());
  console.log('Convite de alguém que não existe: found=false:', unknown.found === false);

  // Quem convida copia o link pela app.
  const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const a = await ctxA.newPage();
  await a.goto('http://localhost:3000');
  await a.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('authUser', JSON.stringify(u)); }, [reg.token, reg.user]);
  await a.reload();
  await a.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await a.evaluate(() => { navigator.share = undefined; });
  a.on('dialog', (d) => d.accept());
  await a.evaluate(() => inviteFriends());
  await a.waitForTimeout(400);
  const copied = await a.evaluate(() => navigator.clipboard.readText());
  console.log('Botão "Convidar amigos" copia o link com o nome de utilizador:', copied.includes('/?convite=' + inviterUsername));

  // O amigo abre o link num aparelho novo.
  const b = await (await browser.newContext()).newPage();
  await b.goto('http://localhost:3000/?convite=' + inviterUsername);
  await b.waitForFunction(() => document.getElementById('inviteBanner').style.display === 'block', { timeout: 5000 }).catch(() => {});
  const banner = await b.textContent('#inviteBanner');
  console.log('Ecrã de entrada mostra "Marta Convida convidou-te":', banner.includes('Marta Convida convidou-te'));
  console.log('O endereço fica limpo (sem ?convite=):', !b.url().includes('convite='));

  await b.click('.login-switch');
  const ts2 = Date.now();
  await b.fill('#regName', 'Amigo Novo');
  await b.fill('#regUsername', 'amigo_' + ts2);
  await b.fill('#regPhone', '+3510' + String(ts2).slice(-8));
  await b.selectOption('#regCountry', 'Portugal');
  await b.fill('#regEmail', `amigo${ts2}@test.com`);
  await b.fill('#regPassword', 'senha123');
  await b.click('button:has-text("Criar conta")');
  await b.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await b.waitForFunction(() => APP.chats.some(c => c.name === 'Marta Convida'), { timeout: 8000 }).catch(() => {});
  const hasChat = await b.evaluate(() => APP.chats.some(c => c.name === 'Marta Convida'));
  console.log('Depois de criar conta, a conversa com quem convidou aparece sozinha:', hasChat);
  const cleared = await b.evaluate(() => !localStorage.getItem('pendingInvite'));
  console.log('O convite só é usado uma vez:', cleared);

  await browser.close();
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
