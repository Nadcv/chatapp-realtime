#!/usr/bin/env node
// ==================== RUNNER DOS TESTES AUTOMATIZADOS ====================
// Substitui o processo manual de: gerar fixtures GTFS, arrancar ~15 mock
// servers em portas fixas, arrancar o server.js com as variáveis de ambiente
// certas, e correr cada teste Playwright um a um lendo o output à mão.
//
// Uso: node tests/run-all.js [--concurrency=N] [--filter=substring]
//
// Cada teste imprime linhas "Descrição: true/false" — este runner conta
// quantas são "true" vs "false" por ficheiro, e trata um crash/exceção não
// apanhada (processo sai com código != 0) como falha do ficheiro inteiro.
// O output completo de cada teste fica em tests/output/logs/<ficheiro>.log;
// aqui só aparece o resumo.
//
// NOTA (dataset duplo da CP): dois pares diferentes de dados GTFS de mentira
// existem para a mesma variável CP_GTFS_URL — um com partidas próximas fixas
// (build_mock_gtfs.js, para test_train_schedules.js) e outro com viagens
// "em trânsito agora" (build_mock_gtfs_transit.js, para test_estimated_trains.js
// e test_fertagus.js). Como o servidor principal só lê CP_GTFS_URL uma vez e
// guarda o resultado em cache (chave fixa "cp"), não dá para satisfazer os
// dois ao mesmo tempo com um único processo — por isso este runner corre a
// suite em dois "lotes", reiniciando o server.js principal entre eles só para
// trocar essa variável.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const MOCKS_DIR = path.join(__dirname, 'mocks');
const E2E_DIR = path.join(__dirname, 'e2e');
const LOGS_DIR = path.join(__dirname, 'output', 'logs');
fs.mkdirSync(LOGS_DIR, { recursive: true });

const args = process.argv.slice(2);
const concurrencyArg = args.find((a) => a.startsWith('--concurrency='));
const filterArg = args.find((a) => a.startsWith('--filter='));
const CONCURRENCY = concurrencyArg ? Number(concurrencyArg.split('=')[1]) : 6;
const FILTER = filterArg ? filterArg.split('=')[1] : null;

// ---- 1) Fixtures GTFS/dados de mentira a (re)gerar sempre antes de arrancar
// os mock servers, para nunca correr com horários "soon" já expirados.
const BUILD_SCRIPTS = [
  'build_mock_gtfs.js',
  'build_mock_gtfs_transit.js',
  'build_mock_fertagus_gtfs.js',
  'build_mock_metro_lisboa_gtfs.js',
  'build_mock_porto_gtfs.js',
  'build_mock_madrid_gtfs.js',
  'build_mock_valencia_gtfs.js',
  'build_mock_renfe_gtfs.js',
  'build_mock_gtfs_planner.js',
  'build_mock_guimaraes_gtfs.js',
  'build_mock_france_gtfs.js'
];

// ---- 2) Mock servers a manter no ar durante toda a suite (portas fixas,
// ver cabeçalho de cada ficheiro em tests/mocks/).
const MOCK_SERVERS = [
  'mock_gtfs_server.js',            // 3002 - CP (dataset "partidas próximas")
  'mock_gtfs_transit_server.js',    // 3015 - CP (dataset "em trânsito")
  'mock_fertagus_server.js',        // 3016
  'mock_metro_lisboa_server.js',    // 3008
  'mock_guimaraes_server.js',       // 3005
  'mock_porto_gtfs_server.js',      // 3006
  'mock_stcp_realtime_server.js',   // 3007 - não usado pelo server.js (URL da STCP é fixa),
                                     // mas mantido no ar para não confundir; o teste da STCP
                                     // espera mesmo o erro de rede (ver test_porto_transport.js)
  'mock_madrid_server.js',          // 3017
  'mock_valencia_server.js',        // 3018
  'mock_renfe_ckan_server.js',      // 3019
  'mock_gira_ckan_server.js',       // 3014
  'mock_agendalx_server.js',        // 3012
  'mock_ignav_server.js',           // 3011
  'mock_tictactrip_server.js',      // 3010
  'mock_gtfs_planner_server.js',    // 3013 - não usado pelo server.js atual (o planeador
                                     // reaproveita o feed "cp"); mantido no ar por segurança
  'mock_metro_server.js',           // 3004 - só usado diretamente por test_metro_auth_logic.js
                                     // (testa lógica antiga do Metro Lisboa, substituída pela
                                     // UnderLX no server.js atual — ver README)
  'mock_france_server.js'           // 3020 - França (Transilien, versão reduzida)
];

// SMTP falso (sem AUTH/TLS) para os testes de 2FA/redefinição de senha por
// email correrem o código real de envio de email (nodemailer) — em vez de o
// simular, o server.js liga-se mesmo a este servidor. Porta SMTP 2525,
// porta HTTP 2526 para o teste ir buscar o último email "enviado".
const FAKE_SMTP_ARGS = ['2525', '2526'];

const SERVER_PORT = 3000;

// Ficheiros de persistência local (usados quando MONGO_URI não está definida —
// ver README) que o server.js vai lendo/escrevendo durante os testes. Alguns
// testes usam IDs fixos (não únicos por execução) para chats/mensagens fixadas/
// conversas bloqueadas/etc.; se estes ficheiros sobreviverem de uma corrida
// anterior da suite, esse estado residual (ex.: uma mensagem já fixada doutra
// vez) faz esses testes falharem por um motivo que nada tem a ver com a app —
// foi exatamente o que aconteceu com test_multi_pin.js. Para a suite ser
// sempre reprodutível, apagamos estes ficheiros mesmo antes de arrancar o
// servidor, garantindo sempre um estado limpo.
const LOCAL_DATA_FILES = [
  'messages.json', 'users.json', 'groups.json', 'activities.json', 'todos.json',
  'notes.json', 'pins.json', 'disappearing.json', 'statuses.json', 'calllog.json',
  'scheduled.json', 'muted.json', 'archived.json', 'blocked.json', 'roadalerts.json',
  'broadcasts.json', 'folders.json', 'tourism-favorites.json', 'shopping-list.json',
  'reminders.json', 'recurring-expenses.json', 'scheduled-calls.json',
  'pinned-chats.json', 'price-alerts.json', 'travel-history.json'
];
function wipeLocalDataFiles() {
  LOCAL_DATA_FILES.forEach((f) => { try { fs.unlinkSync(path.join(ROOT, f)); } catch (e) {} });
}

const BASE_ENV = {
  ...process.env,
  PORT: String(SERVER_PORT),
  CP_GTFS_URL: 'http://localhost:3002/gtfs_cp.zip',
  FERTAGUS_GTFS_URL: 'http://localhost:3016/gtfs_fertagus.zip',
  METRO_LISBOA_GTFS_URL: 'http://localhost:3008/mock_metro_lisboa.zip',
  GUIMARAES_GTFS_URL: 'http://localhost:3005/guimaraes.zip',
  METRO_PORTO_GTFS_URL: 'http://localhost:3006/metro.zip',
  STCP_GTFS_URL: 'http://localhost:3006/stcp.zip',
  EMT_MADRID_GTFS_URL: 'http://localhost:3017/emt.zip',
  METRO_MADRID_GTFS_URL: 'http://localhost:3017/metro.zip',
  METRO_LIGERO_MADRID_GTFS_URL: 'http://localhost:3017/metro_ligero.zip',
  CERCANIAS_MADRID_GTFS_URL: 'http://localhost:3017/cercanias.zip',
  EMT_VALENCIA_GTFS_URL: 'http://localhost:3018/emt_valencia.zip',
  METRO_VALENCIA_GTFS_URL: 'http://localhost:3018/metro_valencia.zip',
  RENFE_CKAN_BASE: 'http://localhost:3019',
  FRANCE_GTFS_URL: 'http://localhost:3020/gtfs_france.zip',
  GIRA_CKAN_BASE: 'http://localhost:3014',
  GIRA_DATASET_ID: 'girastations',
  AGENDALX_EVENTS_URL: 'http://localhost:3012/events',
  IGNAV_API_BASE: 'http://localhost:3011/api',
  IGNAV_API_KEY: 'mock-ignav-key',
  TICTACTRIP_API_BASE: 'http://localhost:3010',
  TICTACTRIP_API_TOKEN: 'mock-tictactrip-token'
};

// Ambiente de email só é ligado para os testes que PRECISAM dele (2FA por
// email, redefinição de senha) — test_2fa_fallback.js testa precisamente o
// comportamento com o servidor de email por CONFIGURAR, por isso não pode
// correr com estas variáveis no ambiente geral (BASE_ENV).
const EMAIL_ENV_OVERRIDES = {
  EMAIL_USER: 'test@example.com',
  EMAIL_PASS: 'testpass',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: FAKE_SMTP_ARGS[0]
};
const EMAIL_BATCH_FILES = new Set(['test_2fa.js', 'test_password_reset.js']);

// Testes que exigem o dataset "em trânsito" da CP (ver nota acima) — correm
// num 2º lote, com o server.js reiniciado só para trocar o CP_GTFS_URL.
const BATCH2_FILES = new Set(['test_estimated_trains.js', 'test_fertagus.js']);

// A 1ª conta registada no servidor fica "admin" (firstRegisteredPhone, gravado
// em users.json e recarregado no arranque) — este teste só é fiável se for
// mesmo a primeira conta a existir. Corre sozinho, num lote à parte, ANTES de
// qualquer outro (que também regista contas em paralelo e "roubaria" o
// estatuto de admin).
const ADMIN_BATCH_FILES = new Set(['test_admin_delete_account.js']);

function listTestFiles() {
  let files = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith('.js')).sort();
  if (FILTER) files = files.filter((f) => f.includes(FILTER));
  return files;
}

function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      const req = http.get(url, (res) => { res.resume(); resolve(); });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout à espera de ${url}`));
        setTimeout(attempt, 300);
      });
      req.setTimeout(2000, () => req.destroy());
    })();
  });
}

const spawned = [];
function spawnPersistent(cmd, cmdArgs, opts) {
  const p = spawn(cmd, cmdArgs, { stdio: 'ignore', ...opts });
  spawned.push(p);
  return p;
}

function killAll() {
  spawned.forEach((p) => { try { process.kill(p.pid, 'SIGKILL'); } catch (e) {} });
  spawned.length = 0;
}

function runBuildScripts() {
  for (const script of BUILD_SCRIPTS) {
    const res = require('child_process').spawnSync('node', [path.join(MOCKS_DIR, script)], { cwd: MOCKS_DIR });
    if (res.status !== 0) {
      console.error(`⚠️  ${script} falhou ao gerar as fixtures:`);
      console.error((res.stderr || Buffer.from('')).toString());
    }
  }
}

function startMockServers() {
  MOCK_SERVERS.forEach((script) => spawnPersistent('node', [path.join(MOCKS_DIR, script)], { cwd: MOCKS_DIR }));
  spawnPersistent('node', [path.join(MOCKS_DIR, 'fake_smtp.js'), ...FAKE_SMTP_ARGS], { cwd: MOCKS_DIR });
  // Servidor de imagem "sem CORS" (porta 3001) para test_photo_editor_tainted.js.
  spawnPersistent('node', [path.join(MOCKS_DIR, 'tainted_image_server.js'), '3001'], { cwd: MOCKS_DIR });
}

function startMainServer(envOverrides) {
  return spawnPersistent('node', ['server.js'], { cwd: ROOT, env: { ...BASE_ENV, ...envOverrides } });
}

// Corre um ficheiro de teste isolado, devolve { file, passed, failed, crashed, lines }
function runOneTest(file) {
  return new Promise((resolve) => {
    const logPath = path.join(LOGS_DIR, file.replace(/\.js$/, '.log'));
    const out = [];
    const child = spawn('node', [path.join(E2E_DIR, file)], { cwd: ROOT });
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => out.push(d));
    child.on('close', (code) => {
      const text = Buffer.concat(out).toString();
      fs.writeFileSync(logPath, text);
      const lines = text.split('\n').filter(Boolean);
      const passed = lines.filter((l) => /:\s*true\s*$/.test(l)).length;
      const failedLines = lines.filter((l) => /:\s*false\s*$/.test(l));
      const crashed = code !== 0;
      resolve({ file, passed, failed: failedLines.length, failedLines, crashed, exitCode: code });
    });
  });
}

async function runBatch(files, envOverrides, label) {
  if (!files.length) return [];
  console.log(`\n=== Lote: ${label} (${files.length} ficheiro(s), servidor com CP_GTFS_URL=${envOverrides.CP_GTFS_URL || BASE_ENV.CP_GTFS_URL}) ===`);
  const serverProc = startMainServer(envOverrides);
  await waitForHttp(`http://localhost:${SERVER_PORT}/`, 20000);

  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < files.length) {
      const file = files[idx++];
      process.stdout.write(`  a correr ${file}...\n`);
      const r = await runOneTest(file);
      results.push(r);
      const status = r.crashed ? '💥 CRASH' : (r.failed > 0 ? `⚠️  ${r.failed} falha(s)` : '✅ OK');
      console.log(`  ${status} — ${file} (${r.passed} passou/passaram, ${r.failed} falhou/falharam)`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

  try { process.kill(serverProc.pid, 'SIGKILL'); } catch (e) {}
  spawned.splice(spawned.indexOf(serverProc), 1);
  return results;
}

async function main() {
  console.log('A limpar dados locais residuais de corridas anteriores...');
  wipeLocalDataFiles();
  console.log('A gerar fixtures GTFS frescas...');
  runBuildScripts();
  console.log('A arrancar os mock servers...');
  startMockServers();
  await new Promise((r) => setTimeout(r, 1000));

  const allFiles = listTestFiles();
  const adminBatchFiles = allFiles.filter((f) => ADMIN_BATCH_FILES.has(f));
  const batch1Files = allFiles.filter((f) => !BATCH2_FILES.has(f) && !EMAIL_BATCH_FILES.has(f) && !ADMIN_BATCH_FILES.has(f));
  const batch2Files = allFiles.filter((f) => BATCH2_FILES.has(f));
  const emailBatchFiles = allFiles.filter((f) => EMAIL_BATCH_FILES.has(f));

  const results = [];
  try {
    results.push(...await runBatch(adminBatchFiles, {}, 'admin (tem de correr primeiro e sozinho)'));
    results.push(...await runBatch(batch1Files, {}, 'geral'));
    results.push(...await runBatch(batch2Files, { CP_GTFS_URL: 'http://localhost:3015/gtfs_transit.zip' }, 'comboios em trânsito (CP)'));
    results.push(...await runBatch(emailBatchFiles, EMAIL_ENV_OVERRIDES, 'email (2FA / redefinir senha)'));
  } finally {
    killAll();
  }

  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  const crashedFiles = results.filter((r) => r.crashed);
  const failedFiles = results.filter((r) => !r.crashed && r.failed > 0);
  const cleanFiles = results.filter((r) => !r.crashed && r.failed === 0);

  console.log('\n\n================ RESUMO ================');
  console.log(`Ficheiros corridos: ${results.length}`);
  console.log(`  ✅ sem falhas: ${cleanFiles.length}`);
  console.log(`  ⚠️  com falhas: ${failedFiles.length}`);
  console.log(`  💥 crash (código de saída != 0): ${crashedFiles.length}`);
  console.log(`Verificações: ${totalPassed} passaram, ${totalFailed} falharam`);

  if (failedFiles.length || crashedFiles.length) {
    console.log('\n--- Detalhe das falhas (ver log completo em tests/output/logs/) ---');
    [...crashedFiles, ...failedFiles].forEach((r) => {
      console.log(`\n${r.file} (código de saída ${r.exitCode}):`);
      r.failedLines.forEach((l) => console.log('  ' + l));
    });
  }

  fs.writeFileSync(path.join(__dirname, 'output', 'last-run.json'), JSON.stringify(results, null, 2));
  process.exit(failedFiles.length || crashedFiles.length ? 1 : 0);
}

process.on('SIGINT', () => { killAll(); process.exit(130); });
main().catch((err) => { console.error(err); killAll(); process.exit(1); });
