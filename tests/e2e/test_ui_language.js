const { chromium } = require('playwright');

// Testa a "Interface em vários idiomas" (PT/EN/ES) — diferente da tradução
// automática de MENSAGENS que já existia (essa usa 'preferredLang'). Aqui o
// que muda são os botões/menus da própria aplicação: ecrã de login/registo,
// o modal de perfil, os menus em grelha de funcionalidades, e as palavras de
// ação genéricas (Cancelar/Fechar/etc.) espalhadas por dezenas de modais.
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));

  await page.goto('http://localhost:3000');

  // --- Estado inicial: português (idioma por omissão, sem nada no localStorage). ---
  const initialLoginBtn = await page.evaluate(() => document.querySelector('button[onclick="doLogin()"]').textContent);
  console.log('Por omissão o botão de login está em português:', initialLoginBtn.includes('Entrar'));

  // --- Muda para inglês diretamente no ecrã de login (antes de autenticar). ---
  await page.click('button[onclick="setUiLanguage(\'en\')"]');
  await page.waitForTimeout(200);
  const enTitle = await page.evaluate(() => document.querySelector('h1[data-i18n="appName"]').textContent);
  console.log('Título muda para inglês:', enTitle === 'ChatApp Complete');
  const enLoginBtn = await page.evaluate(() => document.querySelector('button[onclick="doLogin()"]').textContent);
  console.log('Botão de login muda para inglês:', enLoginBtn === '🚀 Log in');
  const enPhonePlaceholder = await page.evaluate(() => document.getElementById('loginPhone').placeholder);
  console.log('Placeholder do telefone muda para inglês:', enPhonePlaceholder === 'Phone number');
  const enNoAccount = await page.evaluate(() => document.querySelector('.login-switch[data-i18n="loginNoAccount"]').textContent);
  console.log('Link "criar conta" muda para inglês:', enNoAccount.includes('Sign up'));

  // --- Muda para espanhol. ---
  await page.click('button[onclick="setUiLanguage(\'es\')"]');
  await page.waitForTimeout(200);
  const esTitle = await page.evaluate(() => document.querySelector('h1[data-i18n="appName"]').textContent);
  console.log('Título muda para espanhol:', esTitle === 'ChatApp Completo' && await page.evaluate(() => document.querySelector('button[onclick="doLogin()"]').textContent) === '🚀 Entrar');

  // --- Volta para português — o texto original é restaurado corretamente. ---
  await page.click('button[onclick="setUiLanguage(\'pt\')"]');
  await page.waitForTimeout(200);
  const ptLoginBtnRestored = await page.evaluate(() => document.querySelector('button[onclick="doLogin()"]').textContent);
  console.log('Volta a português corretamente ("🚀 Entrar"):', ptLoginBtnRestored === '🚀 Entrar');

  // --- Persiste entre recarregamentos (localStorage). ---
  await page.click('button[onclick="setUiLanguage(\'en\')"]');
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForTimeout(300);
  const persistedAfterReload = await page.evaluate(() => document.querySelector('button[onclick="doLogin()"]').textContent);
  console.log('O idioma escolhido persiste depois de recarregar a página:', persistedAfterReload === '🚀 Log in');

  // Volta a português para o resto do teste (registo em português é mais
  // fácil de ler nos logs, mas o comportamento é indiferente à língua).
  await page.click('button[onclick="setUiLanguage(\'pt\')"]');
  await page.waitForTimeout(200);

  // --- Regista uma conta normalmente (não deve ser afetado pela funcionalidade nova). ---
  const ts = Date.now();
  await page.click('.login-switch[onclick="showAuthForm(\'register\')"]');
  await page.fill('#regName', 'UI Lang Tester');
  await page.fill('#regUsername', 'uilang_' + ts);
  await page.fill('#regPhone', '+3519' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'uilang' + ts + '@test.com');
  await page.fill('#regPassword', 'senha1234forte');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });

  // --- Muda o idioma da interface a partir do modal de perfil (pós-login). ---
  await page.evaluate(() => openProfileModal());
  await page.waitForSelector('#modalProfile.active');
  const uiLangSelectDefaultsToStored = await page.evaluate(() => document.getElementById('profileUiLangSelect').value);
  console.log('O seletor de idioma da interface no perfil reflete o idioma atual (pt):', uiLangSelectDefaultsToStored === 'pt');
  await page.selectOption('#profileUiLangSelect', 'en');
  await page.evaluate(() => closeModal('modalProfile'));
  await page.waitForTimeout(200);

  // --- Menu em grelha "Mais funcionalidades" — os rótulos mudam de idioma. ---
  await page.click('button[onclick="openMoreFeaturesModal()"]');
  await page.waitForSelector('#modalMoreFeatures.active');
  const calcLabelEn = await page.evaluate(() => document.querySelector('button[onclick*="openCalcScreen"] span').textContent);
  console.log('Rótulo "Calculadora" muda para "Calculator" em inglês:', calcLabelEn === 'Calculator');
  const closeBtnEn = await page.evaluate(() => document.querySelector('#modalMoreFeatures .modal-actions button').textContent);
  console.log('Botão "Fechar" do menu em grelha muda para "Close":', closeBtnEn === 'Close');
  await page.evaluate(() => closeModal('modalMoreFeatures'));

  // --- Palavra de ação genérica ("Cancelar") num modal qualquer, sem nenhuma anotação manual. ---
  await page.click('button[onclick="openContactsFeaturesModal()"]');
  await page.waitForSelector('#modalContactsFeatures.active');
  await page.click('#modalContactsFeatures button:has-text("Create group"), #modalContactsFeatures button:has-text("Criar grupo")');
  await page.waitForSelector('#modalCreateGroup.active');
  const createGroupCancelEn = await page.evaluate(() => document.querySelector('#modalCreateGroup button[onclick="closeModal(\'modalCreateGroup\')"]').textContent);
  console.log('Botão "Cancelar" (nunca anotado manualmente) muda para "Cancel" em qualquer modal:', createGroupCancelEn === 'Cancel');
  await page.evaluate(() => closeModal('modalCreateGroup'));
  await page.evaluate(() => closeModal('modalContactsFeatures'));

  // --- Muda para espanhol pelo perfil e confirma o mesmo mecanismo. ---
  await page.evaluate(() => openProfileModal());
  await page.selectOption('#profileUiLangSelect', 'es');
  await page.evaluate(() => closeModal('modalProfile'));
  await page.waitForTimeout(200);
  await page.click('button[onclick="openMoreFeaturesModal()"]');
  await page.waitForSelector('#modalMoreFeatures.active');
  const calcLabelEs = await page.evaluate(() => document.querySelector('button[onclick*="openCalcScreen"] span').textContent);
  console.log('Rótulo muda para espanhol ("Calculadora", igual ao português neste caso):', calcLabelEs === 'Calculadora');
  await page.evaluate(() => closeModal('modalMoreFeatures'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
