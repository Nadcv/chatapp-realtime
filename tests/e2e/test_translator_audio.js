const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  // Mock the browser's clipboard API (headless Chromium without permissions
  // grant would otherwise reject navigator.clipboard.writeText).
  await page.addInitScript(() => {
    window.__copiedText = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t) => { window.__copiedText = t; return Promise.resolve(); } },
      configurable: true
    });
    // Fake SpeechRecognition — headless Chromium exposes webkitSpeechRecognition
    // but it can't reach Google's real speech service in this sandbox, so we
    // replace it with a controllable fake to test our own wiring logic.
    window.__FakeRecognition = class {
      constructor() { window.__lastRecognitionInstance = this; }
      start() { window.__recognitionStarted = true; }
      stop() { if (this.onend) this.onend(); }
    };
    window.SpeechRecognition = window.__FakeRecognition;
    window.webkitSpeechRecognition = window.__FakeRecognition;
  });

  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Trad Teste');
  await page.fill('#regUsername', 'trad_teste_' + ts);
  await page.fill('#regPhone', '+3517' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'trad' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // /api/translate reaches the real Google Translate endpoint fine through
  // this sandbox's outbound proxy — no need to mock it, test against the
  // real translation.
  await page.evaluate(() => openTranslatorModal());
  await page.waitForSelector('#modalTranslator.active', { timeout: 5000 });
  await page.selectOption('#quickTransTo', 'en');

  // --- Test 1: typing still works (regression check) ---
  await page.fill('#quickTransInput', 'Olá mundo');
  await page.waitForTimeout(1200);
  const typedOutput = await page.textContent('#quickTransOutput');
  console.log('Typed text translates to something real (not error/empty):', typedOutput && typedOutput !== 'A traduzir...' && !typedOutput.startsWith('⚠️'));
  console.log('Translated output:', JSON.stringify(typedOutput));

  // --- Test 2: copy button ---
  await page.click('button:has-text("Copiar tradução")');
  const copied = await page.evaluate(() => window.__copiedText);
  console.log('Copy button copies exactly the translated output shown:', copied === typedOutput);

  // --- Test 3: voice button starts "recognition" and updates button label ---
  await page.click('#quickTransVoiceBtn');
  const startedRecording = await page.evaluate(() => window.__recognitionStarted === true);
  const btnLabelWhileRecording = await page.textContent('#quickTransVoiceBtn');
  console.log('Clicking mic starts recognition:', startedRecording);
  console.log('Button label shows recording state:', btnLabelWhileRecording.includes('A ouvir'));

  // Simulate speech recognition producing a final transcript (mirrors the
  // event shape a real SpeechRecognition would fire).
  await page.evaluate(() => {
    const rec = window.__lastRecognitionInstance;
    const fakeResults = [{ isFinal: true, 0: { transcript: 'Bom dia' }, length: 1 }];
    fakeResults.length = 1;
    rec.onresult({ resultIndex: 0, results: fakeResults });
  });
  const inputAfterSpeech = await page.inputValue('#quickTransInput');
  console.log('Transcript filled into input field:', inputAfterSpeech === 'Bom dia');

  await page.evaluate(() => window.__lastRecognitionInstance.onend());
  await page.waitForTimeout(1200);
  const outputAfterSpeech = await page.textContent('#quickTransOutput');
  const btnLabelAfter = await page.textContent('#quickTransVoiceBtn');
  console.log('Auto-translates the transcript once recording ends:', outputAfterSpeech && outputAfterSpeech !== 'A traduzir...' && !outputAfterSpeech.startsWith('⚠️'));
  console.log('Translated transcript output:', JSON.stringify(outputAfterSpeech));
  console.log('Button label resets after recording ends:', btnLabelAfter.includes('Gravar áudio') && !btnLabelAfter.includes('ouvir'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
