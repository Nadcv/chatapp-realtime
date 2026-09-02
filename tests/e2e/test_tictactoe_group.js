const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto('http://localhost:3000');
  await page.click('.login-switch');
  const ts = Date.now();
  await page.fill('#regName', 'Galo Group Teste');
  await page.fill('#regUsername', 'galo_grp_' + ts);
  await page.fill('#regPhone', '+3513' + ts.toString().slice(-8));
  await page.selectOption('#regCountry', 'Portugal');
  await page.fill('#regEmail', 'galogrp' + ts + '@test.com');
  await page.fill('#regPassword', 'senha123');
  await page.click('button:has-text("Criar conta")');
  await page.waitForSelector('#mainApp', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(300);

  const groupName = 'Grupo Galo ' + ts;
  await page.click('button[onclick="openContactsFeaturesModal()"]');
  await page.waitForSelector('#modalContactsFeatures.active');
  await page.click('#modalContactsFeatures button:has-text("Criar grupo")');
  await page.waitForSelector('#modalCreateGroup.active');
  await page.fill('#groupName', groupName);
  await page.click('#modalCreateGroup button:has-text("Criar Grupo")');
  await page.waitForTimeout(600);
  await page.click(`.chat-item:has-text("${groupName}")`);
  await page.waitForTimeout(300);

  // O Jogo do Galo passou a suportar grupos (escolhe-se o adversário, tal
  // como já acontecia com as Damas) — deixou de fazer sentido esconder o
  // botão de jogos ou a opção "Jogo do Galo" dentro de um grupo.
  const gamesBtnVisible = await page.locator('#gamesBtn').evaluate(el => getComputedStyle(el).display !== 'none');
  console.log('Botão de jogos visível num grupo:', gamesBtnVisible);

  await page.click('#gamesBtn');
  await page.waitForSelector('#modalGameChooser.active');
  const ticTacToeVisible = await page.evaluate(() => getComputedStyle(document.getElementById('gameChooserTicTacToeBtn')).display !== 'none');
  console.log('Opção "Jogo do Galo" visível no seletor de jogos num grupo:', ticTacToeVisible);

  await page.click('#gameChooserTicTacToeBtn');
  await page.waitForSelector('#modalOpponentPicker.active');
  const pickerTitle = await page.evaluate(() => document.getElementById('opponentPickerTitle').textContent);
  console.log('Escolher "Jogo do Galo" num grupo abre o seletor de adversário certo:', pickerTitle.includes('Jogo do Galo'));

  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
