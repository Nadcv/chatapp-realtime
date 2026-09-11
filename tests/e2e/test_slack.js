const { chromium } = require('playwright');
const crypto = require('crypto');

// Ponte de mensagens bidirecional com o Slack (ver server.js, secção
// "SLACK"): liga a conta (OAuth2 completo, via mock_slack_server.js na
// porta 3028), liga um canal a um grupo, e confirma os dois sentidos —
// app cria mensagem → aparece no Slack (via GET /__test/messages do mock);
// alguém escreve no canal do Slack → chega à app (POST assinado a sério
// para /api/slack/events do NOSSO servidor, exatamente como a Slack faria).
const SLACK_SIGNING_SECRET = 'mock-slack-signing-secret'; // tem de bater certo com SLACK_SIGNING_SECRET em tests/run-all.js
const SLACK_TEAM_ID = 'T0MOCKTEAM'; // tem de bater certo com FAKE_TEAM.id em mock_slack_server.js
const CHANNEL_ID = 'C0123ABC456';

function signSlackRequest(bodyString, secret = SLACK_SIGNING_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const base = `v0:${timestamp}:${bodyString}`;
  const signature = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
  return { timestamp, signature };
}
async function postSlackEvent(bodyObj, { secret, timestamp } = {}) {
  const bodyString = JSON.stringify(bodyObj);
  const { timestamp: ts, signature } = signSlackRequest(bodyString, secret, timestamp);
  const res = await fetch('http://localhost:3000/api/slack/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Slack-Request-Timestamp': String(ts), 'X-Slack-Signature': signature },
    body: bodyString
  });
  return res.status;
}
async function getMockPostedMessages(channel) {
  const res = await fetch(`http://127.0.0.1:3028/__test/messages?channel=${encodeURIComponent(channel)}`);
  const data = await res.json();
  return data.items;
}

async function register(context, name, prefix) {
  const page = await context.newPage();
  page.on('pageerror', err => console.log(`PAGE EXCEPTION [${name}]:`, err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = '+3518' + ts.toString().slice(-8);
  await page.fill('#regName', name);
  await page.fill('#regUsername', prefix + ts);
  await page.fill('#regPhone', phone);
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', prefix + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  return { page, phone };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext();
  const { page } = await register(ctx, 'Slack Bridge Tester', 'slack_it_');

  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

  // --- Cria um grupo para testar a ponte. ---
  const groupName = 'Grupo Slack ' + Date.now();
  await page.click('button[onclick="openContactsFeaturesModal()"]');
  await page.waitForSelector('#modalContactsFeatures.active');
  await page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await page.waitForSelector('#modalCreateGroup.active');
  await page.fill('#groupName', groupName);
  await page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await page.waitForTimeout(500);
  await page.click(`.chat-item:has-text("${groupName}")`);
  await page.waitForTimeout(300);

  // --- Antes de ligar o Slack: pede para ligar a conta primeiro. ---
  await page.click('button[onclick="openChatMoreModal()"]');
  await page.waitForSelector('#modalChatMore.active');
  await page.click('#slackLinkBtn');
  await page.waitForSelector('#modalSlackLink.active');
  await page.waitForTimeout(300);
  const promptsToConnectFirst = await page.evaluate(() => document.getElementById('slackLinkStatusBox').textContent.includes('Liga o Slack'));
  console.log('Sem conta Slack ligada, pede para ligar primeiro no perfil:', promptsToConnectFirst);
  await page.evaluate(() => closeModal('modalSlackLink'));

  // --- Liga a conta Slack (fluxo OAuth2 completo através do mock). ---
  await page.click('#headerAvatar');
  await page.waitForSelector('#modalProfile.active');
  const showsConnectButton = await page.evaluate(() => document.getElementById('slackProfileBox').innerHTML.includes('connectSlack'));
  console.log('Perfil mostra o botão para ligar o Slack:', showsConnectButton);
  await page.click('button:has-text("🔗 Ligar ao Slack")');
  await page.waitForURL(/^http:\/\/localhost:3000\/(\?.*)?$/, { timeout: 8000 });
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(800);
  console.log('Depois do OAuth, a app mostra um aviso de sucesso:', dialogs.some(m => m.includes('Slack ligado')));

  await page.click('#headerAvatar');
  await page.waitForSelector('#modalProfile.active');
  const showsConnectedState = await page.evaluate(() => document.getElementById('slackProfileBox').innerHTML.includes('disconnectSlack') && document.getElementById('slackProfileBox').textContent.includes('Workspace de Teste'));
  console.log('Perfil passa a mostrar o workspace ligado, com opção de desligar:', showsConnectedState);
  await page.evaluate(() => closeModal('modalProfile'));

  // --- Liga o canal deste grupo. ---
  await page.click(`.chat-item:has-text("${groupName}")`);
  await page.waitForTimeout(300);
  await page.click('button[onclick="openChatMoreModal()"]');
  await page.waitForSelector('#modalChatMore.active');
  await page.click('#slackLinkBtn');
  await page.waitForSelector('#modalSlackLink.active');
  await page.waitForTimeout(300);
  await page.fill('#slackChannelIdInput', CHANNEL_ID);
  await page.click('#slackLinkStatusBox button:has-text("Ligar")');
  await page.waitForTimeout(400);
  const showsLinkedChannel = await page.evaluate((ch) => document.getElementById('slackLinkStatusBox').textContent.includes(ch), CHANNEL_ID);
  console.log('Depois de ligar, mostra o ID do canal ligado:', showsLinkedChannel);
  await page.evaluate(() => closeModal('modalSlackLink'));

  // --- Sentido app -> Slack: mensagem escrita no grupo aparece no Slack (mock). ---
  await page.fill('#messageInput', 'Olá da app!');
  await page.press('#messageInput', 'Enter');
  await page.waitForTimeout(500);
  const slackMessages = await getMockPostedMessages(CHANNEL_ID);
  console.log('Mensagem do grupo é espelhada no canal do Slack (mock):', slackMessages.some(m => m.text.includes('Olá da app!')));

  // --- Sentido Slack -> app: mensagem "escrita" no Slack chega à conversa. ---
  const eventPayload = {
    type: 'event_callback',
    team_id: SLACK_TEAM_ID,
    event_id: 'Ev_teste_1',
    event: { type: 'message', channel: CHANNEL_ID, user: 'U999TESTE', text: 'Olá da Slack!', ts: '1700000000.000100' }
  };
  const statusOk = await postSlackEvent(eventPayload);
  console.log('O servidor aceita um evento do Slack assinado corretamente:', statusOk === 200);
  await page.waitForTimeout(600);
  const slackMessageShowsInApp = await page.evaluate(() => document.getElementById('chatMessages').textContent.includes('Olá da Slack!'));
  console.log('Mensagem escrita no Slack aparece na conversa do grupo:', slackMessageShowsInApp);
  const showsSlackSenderLabel = await page.evaluate(() => document.getElementById('chatMessages').textContent.includes('Utilizador Slack de Teste (Slack)'));
  console.log('Mostra o nome de quem escreveu no Slack, com etiqueta "(Slack)":', showsSlackSenderLabel);

  // --- Reenviar o MESMO event_id não duplica a mensagem (proteção contra reentrega da Events API). ---
  await postSlackEvent(eventPayload);
  await page.waitForTimeout(500);
  const occurrences = await page.evaluate(() => document.getElementById('chatMessages').innerHTML.split('Olá da Slack!').length - 1);
  console.log('Reenviar o mesmo event_id não duplica a mensagem:', occurrences === 1);

  // --- Uma mensagem com bot_id (ex.: o próprio bot desta app) é ignorada — evita ciclo infinito. ---
  await postSlackEvent({
    type: 'event_callback', team_id: SLACK_TEAM_ID, event_id: 'Ev_teste_bot',
    event: { type: 'message', channel: CHANNEL_ID, user: 'U999TESTE', bot_id: 'B_ALGUM_BOT', text: 'Mensagem de um bot, não deve entrar', ts: '1700000001.000100' }
  });
  await page.waitForTimeout(400);
  const botMessageIgnored = await page.evaluate(() => !document.getElementById('chatMessages').textContent.includes('Mensagem de um bot'));
  console.log('Mensagens vindas de um bot (ex.: eco do próprio bot) são ignoradas:', botMessageIgnored);

  // --- Uma assinatura errada é recusada (401) e não entra mensagem nenhuma. ---
  const badBody = JSON.stringify({ type: 'event_callback', team_id: SLACK_TEAM_ID, event_id: 'Ev_teste_forjado', event: { type: 'message', channel: CHANNEL_ID, user: 'U999', text: 'Mensagem forjada', ts: '1700000002.000100' } });
  const forgedRes = await fetch('http://localhost:3000/api/slack/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Slack-Request-Timestamp': String(Math.floor(Date.now() / 1000)), 'X-Slack-Signature': 'v0=0000000000000000000000000000000000000000000000000000000000000000' },
    body: badBody
  });
  console.log('Um pedido com assinatura errada é recusado com 401:', forgedRes.status === 401);
  await page.waitForTimeout(300);
  const forgedMessageIgnored = await page.evaluate(() => !document.getElementById('chatMessages').textContent.includes('Mensagem forjada'));
  console.log('Mensagem com assinatura errada nunca chega a entrar na conversa:', forgedMessageIgnored);

  // --- Desligar a conta Slack. ---
  await page.click('#headerAvatar');
  await page.waitForSelector('#modalProfile.active');
  await page.click('button:has-text("Desligar Slack")');
  await page.waitForTimeout(300);
  const showsDisconnectedAgain = await page.evaluate(() => document.getElementById('slackProfileBox').innerHTML.includes('connectSlack'));
  console.log('Depois de desligar, o perfil volta a mostrar o botão de ligar:', showsDisconnectedAgain);

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
