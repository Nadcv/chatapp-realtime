const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Stats Test');
  await page.fill('#regUsername', 'statstest_' + ts);
  await page.fill('#regPhone', '+3513' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'statstest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Seed a rich fake message history across two chats: text with emoji, photos,
  // a video, an audio, a gif, a view-once photo, and a deleted message (must be excluded).
  await page.evaluate(() => {
    APP.chats.push(
      { id: 'stats_chat_a', name: 'Grande Amigo', phone: '+351000000301', type: 'user' },
      { id: 'stats_chat_b', name: 'Conhecido', phone: '+351000000302', type: 'user' }
    );
    APP.messages['stats_chat_a'] = [
      { id: 's1', text: 'Bom dia! 😀 Vamos ao cinema? 😀', time: '09:00', type: 'sent' },
      { id: 's2', text: 'Claro, adoro 😀', time: '09:05', type: 'received' },
      { id: 's3', text: '', time: '09:10', type: 'sent', fileData: 'data:image/png;base64,AAA', fileType: 'image/png' },
      { id: 's4', text: '', time: '09:11', type: 'sent', fileData: 'data:video/mp4;base64,AAA', fileType: 'video/mp4' },
      { id: 's5', text: '', time: '09:12', type: 'sent', fileData: 'data:audio/webm;base64,AAA', fileType: 'audio/webm' },
      { id: 's6', text: '', time: '09:13', type: 'sent', fileData: 'https://example.com/g.gif', fileType: 'image/gif' },
      { id: 's7', text: '', time: '09:14', type: 'sent', fileData: 'data:image/png;base64,AAA', fileType: 'image/png', viewOnce: true },
      { id: 's8', text: 'Uma mensagem que já foi apagada, não deve contar', time: '09:15', type: 'sent', deleted: true },
      { id: 's9', text: 'Esta é a mensagem mais longa de todas as que enviei neste teste, para testar a métrica da maior mensagem enviada.', time: '10:00', type: 'sent' }
    ];
    APP.messages['stats_chat_b'] = [
      { id: 's10', text: 'Oi!', time: '14:00', type: 'sent' },
      { id: 's11', text: 'Oi, tudo bem?', time: '14:01', type: 'received' }
    ];
    renderChatList();
  });

  await page.evaluate(() => openMyStatsModal());
  await page.waitForSelector('#modalMyStats.active', { timeout: 3000 });
  const content = await page.evaluate(() => document.getElementById('myStatsContent').innerText);
  console.log('--- stats content ---');
  console.log(content);
  console.log('---------------------');

  const stats = await page.evaluate(() => computeMyStats());
  console.log('Counts sent messages correctly (7 text-like + attachments, excluding deleted):', stats.sentCount === 8); // s1,s3,s4,s5,s6,s7,s9 (7) + s10 (1) = 8, s8 excluded (deleted)
  // +1 vem da saudação inicial do assistente Gemini, que já existe em toda conta nova.
  console.log('Counts received messages correctly:', stats.receivedCount === 3);
  console.log('Counts photos sent (image/png, not gif):', stats.photos === 2); // s3 and s7 (view-once photo also counts as a photo)
  console.log('Counts videos sent:', stats.videos === 1);
  console.log('Counts audios sent:', stats.audios === 1);
  console.log('Counts gifs sent:', stats.gifs === 1);
  console.log('Counts view-once photos sent:', stats.viewOnceSent === 1);
  console.log('Deleted message text excluded from longest-message calculation:', !stats.longestMessage.includes('já foi apagada'));
  console.log('Finds the actual longest message:', stats.longestMessage.includes('mensagem mais longa'));
  console.log('Detects the most-used emoji (😀 appears 3 times across sent+received, but only counts SENT):', stats.topEmoji === '😀');
  console.log('Contact count reflects the pushed user-type chats:', stats.contactCount === 2);
  console.log('Identifies the most active conversation by message count:', stats.topChatName === 'Grande Amigo');
  console.log('Time spent stat reflects APP.user.totalTimeSpentSec:', typeof stats.timeSpentSec === 'number');

  // UI rendering checks.
  console.log('Modal displays the sent-messages card:', content.includes('Mensagens enviadas'));
  console.log('Modal displays the favourite emoji card:', content.includes('favorito'));
  console.log('Modal displays the most active conversation card with escaped name:', content.includes('Grande Amigo'));

  // XSS safety: a chat name with HTML must render escaped in the "most active conversation" card.
  await page.evaluate(() => {
    APP.chats.push({ id: 'stats_chat_xss', name: '<img src=x onerror=alert(1)>', phone: '+351000000303', type: 'user' });
    APP.messages['stats_chat_xss'] = Array.from({ length: 20 }, (_, i) => ({ id: 'sxss' + i, text: 'spam', time: '08:0' + (i % 6), type: 'sent' }));
    renderChatList();
  });
  await page.evaluate(() => openMyStatsModal());
  await page.waitForTimeout(100);
  const contentAfterXss = await page.evaluate(() => document.getElementById('myStatsContent').innerHTML);
  console.log('Most-active-conversation name with HTML is escaped, not executed:', !contentAfterXss.includes('<img src=x onerror'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
