const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Fmt Test');
  await page.fill('#regUsername', 'fmttest_' + ts);
  await page.fill('#regPhone', '+3514' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'fmttest' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // Call the REAL function from the page directly with several cases,
  // covering: basic bold/italic/code, code content containing * and _ (must
  // NOT be turned into bold/italic inside the code span), unclosed markers
  // (must be left as literal text, not half-transformed), and a message with
  // no formatting at all (must be untouched, byte for byte).
  const results = await page.evaluate(() => {
    const cases = [
      'isto e *negrito* e _italico_ e `codigo` no mesmo texto',
      'codigo com simbolos: `a*b*c_d_e` nao deve formatar por dentro',
      'asterisco solto sem par: 3 * 4 = 12',
      'mensagem totalmente normal sem nada disso',
      '*bold* `code` _italic_ misturados',
    ];
    return cases.map(c => ({ input: c, output: formatMessageText(escapeHtml(c)) }));
  });
  results.forEach(r => console.log('IN: ', JSON.stringify(r.input), '\n OUT:', JSON.stringify(r.output)));

  const checks = {
    'Basic bold+italic+code all applied': results[0].output === 'isto e <strong>negrito</strong> e <em>italico</em> e <code style="background:rgba(0,0,0,0.25);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:0.9em;">codigo</code> no mesmo texto',
    'Symbols inside code are NOT turned into bold/italic': results[1].output.includes('a*b*c_d_e') && !results[1].output.includes('<strong>b</strong>') && !results[1].output.includes('<em>d</em>'),
    'Lone unpaired asterisk is left as literal text (not silently dropped)': results[2].output === 'asterisco solto sem par: 3 * 4 = 12',
    'Plain message with no markers is untouched': results[3].output === 'mensagem totalmente normal sem nada disso',
    'Mixed bold+code+italic all resolve correctly in one message': results[4].output === '<strong>bold</strong> <code style="background:rgba(0,0,0,0.25);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:0.9em;">code</code> <em>italic</em> misturados',
  };
  Object.entries(checks).forEach(([name, pass]) => console.log(name + ':', pass));

  // End-to-end: send a real message through the app and confirm the DOM shows
  // the rendered tags (not the raw asterisks), scoped to the actual chat area
  // (not the video-call sidebar mirror, which is a separate rendering path).
  await page.evaluate(() => {
    APP.chats.push({ id: 'dm_selftest', name: 'Self Test', phone: '+351000000000', type: 'user' });
    renderChatList();
  });
  await page.click('.chat-item:has-text("Self Test")');
  await page.waitForTimeout(200);
  await page.fill('#messageInput', 'ola *mundo* com `codigo` aqui');
  await page.press('#messageInput', 'Enter');
  await page.waitForTimeout(400);
  const domHtml = await page.evaluate(() => document.querySelector('#chatMessages .message.sent').innerHTML);
  console.log('End-to-end: real send renders <strong> tag:', domHtml.includes('<strong>mundo</strong>'));
  console.log('End-to-end: real send renders <code> tag:', domHtml.includes('>codigo</code>'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
