const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const dns = require('dns');
const QRCode = require('qrcode'); // gera o QR code de associação de dispositivo inteiramente no nosso servidor (nunca manda o código de pareamento para um terceiro)
const mongoose = require('mongoose'); // Importado para gerir a base de dados em nuvem
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { console.warn('⚠️ Pacote "nodemailer" não instalado — envio de email desativado.'); }
let JSDOM = null, Readability = null, createDOMPurify = null;
try {
  JSDOM = require('jsdom').JSDOM;
  Readability = require('@mozilla/readability').Readability;
  createDOMPurify = require('dompurify');
} catch (e) { console.warn('⚠️ Pacotes de "modo leitura" (jsdom/readability/dompurify) não instalados — notícias sempre abrem por iframe/link.'); }
let AdmZip = null;
try { AdmZip = require('adm-zip'); } catch (e) { console.warn('⚠️ Pacote "adm-zip" não instalado — horários de comboio (GTFS) desativados.'); }

const app = express();
app.use(express.json({ limit: '20mb' })); // permite anexos (fotos/áudio) em base64 até ~15MB reais
app.use(express.static(__dirname)); // serve o index.html e demais arquivos estáticos

// ==================== BASE DE DADOS (MongoDB Atlas / Persistência Total) ====================
// Configuração para guardar permanentemente contas, grupos e mensagens na nuvem,
// evitando perdas de informação quando a aplicação reinicia ou faz deploy.
const MONGO_URI = process.env.MONGO_URI || '';
let isDbConnected = false;

// Schemas do Mongoose.
// IMPORTANTE: o Mongoose só grava os campos declarados no schema — qualquer
// campo enviado pelo cliente que não esteja aqui é APAGADO silenciosamente ao
// gravar. Isto já tinha causado um bug real: mensagens encriptadas (campos
// `encrypted`/`iv`/`data`) e anexos (`fileName`/`fileType`) perdiam essa
// informação ao serem recarregados após um reinício. Corrigido abaixo — e
// `strict: false` no schema de mensagens serve de rede de segurança para
// qualquer campo novo que se venha a adicionar no futuro sem ter de lembrar
// de atualizar este ficheiro também.
const accountSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  id: String,
  name: String,
  username: { type: String, unique: true, sparse: true }, // sparse: contas antigas sem username não entram em conflito
  country: String,
  email: String,
  salt: String,
  passwordHash: String,
  createdAt: String,
  publicKey: Object,
  avatarUrl: String,
  preferredLang: String, // língua preferida da pessoa (ex.: 'pt', 'es', 'en') — usada na tradução automática
  accentColor: String, // cor de destaque escolhida na personalização da app (ex.: '#7c5cff')
  chatWallpaper: String, // fundo das conversas escolhido (cor, gradiente CSS ou url() de uma imagem)
  contacts: { type: [String], default: [] }, // telefones de quem esta pessoa já procurou/falou
  pushSubscriptions: { type: [Object], default: [] }, // inscrições de notificações push (um dispositivo pode ter mais do que uma)
  totalTimeSpentSec: { type: Number, default: 0 }, // tempo total acumulado com a app em primeiro plano, para o cronómetro "quantas horas perdeu"
  birthday: String, // 'YYYY-MM-DD', opcional — mostrado aos contactos para lembrete de aniversário
  devices: { type: [Object], default: [] }, // [{id, name, lastSeenAt}] — máximo 2 por conta, ver /api/login
  hideOnlineStatus: { type: Boolean, default: false }, // esconde "online"/última vez dos contactos (sempre aparece offline)
  hideReadReceipts: { type: Boolean, default: false }, // não envia confirmação de leitura (✓✓ azul) às mensagens que eu recebo
  twoFactorEnabled: { type: Boolean, default: false } // pede um código por email ao entrar num dispositivo novo (ver /api/login)
});
const AccountModel = mongoose.model('Account', accountSchema);

const groupSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  createdBy: String,
  createdByPhone: String,
  createdAt: String,
  admins: [String],
  moderators: [String],
  mutedPhones: [String],
  bannedPhones: [String],
  private: Boolean, // grupo fechado (só por convite) em vez do padrão aberto a todos
  memberPhones: [String], // só usado quando 'private' — quem já entrou (por convite ou por tê-lo criado)
  inviteToken: String // token do link/QR de convite atual deste grupo (só existe em grupos privados)
});
const GroupModel = mongoose.model('Group', groupSchema);

const messageSchema = new mongoose.Schema({
  chatId: { type: String, required: true, index: true },
  id: String,
  sender: String,
  senderPhone: String,
  text: String,
  time: String,
  type: String,
  fileData: String,
  fileName: String,
  fileType: String,
  replyTo: Object,
  reactions: Object,
  deleted: Boolean,
  edited: Boolean,
  viewOnce: Boolean,
  viewOnceOpened: Boolean,
  encrypted: Boolean, // mensagens 1-para-1 cifradas ponta-a-ponta guardam o texto aqui em vez de "text"
  iv: String,
  data: String,
  createdAt: { type: Date, default: Date.now }
}, { strict: false }); // rede de segurança: qualquer campo futuro que se esqueça de listar acima ainda assim é gravado
const MessageModel = mongoose.model('Message', messageSchema);

const activitySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  phone: { type: String, required: true, index: true },
  name: String, // nome de quem fez a atividade, guardado aqui para não ter de ir buscar à conta sempre
  type: String, // 'corrida' | 'caminhada' | 'bicicleta'
  startTime: String,
  distanceMeters: Number,
  durationSeconds: Number,
  avgSpeedKmh: Number,
  elevationGain: Number,
  route: [{ lat: Number, lng: Number }], // simplificado — sem timestamp por ponto, só para desenhar a rota
  kudos: { type: [String], default: [] }, // telefones de quem deu kudos
  createdAt: { type: Date, default: Date.now }
}, { strict: false });
const ActivityModel = mongoose.model('Activity', activitySchema);

const todoSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  items: { type: [Object], default: [] } // {id, text, done, addedBy}
}, { strict: false });
const TodoModel = mongoose.model('Todo', todoSchema);

const noteSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  phone: { type: String, required: true, index: true },
  title: String,
  text: String,
  updatedAt: { type: Date, default: Date.now }
}, { strict: false });
const NoteModel = mongoose.model('Note', noteSchema);

async function loadDataFromMongo() {
  const [dbAccounts, dbGroups, dbMsgs, dbActivities, dbTodos, dbNotes] = await Promise.all([
    AccountModel.find({}),
    GroupModel.find({}),
    MessageModel.find({}).sort({ createdAt: 1 }),
    ActivityModel.find({}).sort({ createdAt: -1 }).limit(500),
    TodoModel.find({}),
    NoteModel.find({})
  ]);
  dbAccounts.forEach(acc => {
    accounts[acc.phone] = acc.toObject();
    if (accounts[acc.phone].username) usernameIndex[accounts[acc.phone].username.toLowerCase()] = acc.phone;
    if (!firstRegisteredPhone) firstRegisteredPhone = acc.phone;
  });
  dbGroups.forEach(g => { groups[g.id] = g.toObject(); });
  dbMsgs.forEach(m => {
    const obj = m.toObject();
    if (!messagesByRoom[obj.chatId]) messagesByRoom[obj.chatId] = [];
    messagesByRoom[obj.chatId].push(obj);
  });
  dbActivities.forEach(a => { activities.push(a.toObject()); });
  dbTodos.forEach(t => { todosByRoom[t.roomId] = t.toObject().items || []; });
  dbNotes.forEach(n => { notesByPhone[n.phone] = notesByPhone[n.phone] || []; notesByPhone[n.phone].push(n.toObject()); });
  console.log(`🔄 Base de dados carregada: ${dbAccounts.length} conta(s), ${dbGroups.length} grupo(s), ${dbMsgs.length} mensagem(ns), ${dbActivities.length} atividade(s), ${dbTodos.length} lista(s) de tarefas, ${dbNotes.length} nota(s).`);
}

// Liga à base de dados ANTES do servidor começar a aceitar pedidos — sem isto,
// os primeiros registos/mensagens logo a seguir a um reinício podiam ir parar
// aos ficheiros locais em vez de à base de dados (e depois pareciam ter
// desaparecido), por causa do tempo que a ligação ao Mongo demora a estabelecer.
async function connectDatabase() {
  // Estas funcionalidades (fixar mensagem, mensagens temporárias, estados,
  // histórico de chamadas, agendamento, silenciar) usam sempre ficheiro local,
  // independentemente do Mongo estar ligado — mantém a implementação simples.
  loadPinsLocal(); loadDisappearingLocal(); loadStatusesLocal(); loadCallLogLocal(); loadScheduledLocal(); loadMutedLocal(); loadAlertsLocal(); loadArchivedLocal(); loadBlockedLocal(); loadBroadcastsLocal(); loadFoldersLocal(); loadTourismFavoritesLocal(); loadShoppingListLocal(); loadRemindersLocal(); loadRecurringExpensesLocal(); loadScheduledCallsLocal(); loadPinnedChatsLocal(); loadPriceAlertsLocal(); loadTravelHistoryLocal();
  if (!MONGO_URI) {
    console.log('⚠️ AVISO: MONGO_URI não definida. A usar ficheiros locais — os dados apagam a cada novo deploy.');
    loadUsersLocal(); loadMessagesLocal(); loadGroupsLocal(); loadActivitiesLocal(); loadTodosLocal(); loadNotesLocal();
    return;
  }
  try {
    await mongoose.connect(MONGO_URI);
    isDbConnected = true;
    console.log('📦 Base de dados MongoDB Atlas ligada com sucesso! Persistência total ativa.');
    await loadDataFromMongo();
  } catch (err) {
    console.error('⚠️ Não foi possível ligar ao MongoDB (a usar ficheiros locais):', err.message);
    isDbConnected = false;
    loadUsersLocal(); loadMessagesLocal(); loadGroupsLocal(); loadActivitiesLocal(); loadTodosLocal(); loadNotesLocal();
  }
}

// ==================== AUTENTICAÇÃO DE USUÁRIOS ====================
let accounts = {}; // phone -> { id, name, phone, username, country, email, salt, passwordHash, createdAt, contacts: [phone,...] }
let usernameIndex = {}; // username (minúsculas) -> phone
let firstRegisteredPhone = null;

const USERS_FILE = path.join(__dirname, 'users.json');
function loadUsersLocal() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
      accounts = data.accounts || {};
      firstRegisteredPhone = data.firstRegisteredPhone || null;
      Object.values(accounts).forEach(a => { if (a.username) usernameIndex[a.username.toLowerCase()] = a.phone; });
    }
  } catch (err) {
    console.error('Erro ao carregar usuários localmente:', err.message);
  }
}
function saveUsers() {
  if (isDbConnected) return; // gravado pontualmente no Mongo em cada operação (ver chamadas a AccountModel abaixo)
  fs.writeFile(USERS_FILE, JSON.stringify({ accounts, firstRegisteredPhone }), (err) => {
    if (err) console.error('Erro ao salvar usuários:', err.message);
  });
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Bloqueia as senhas mais óbvias/mais usadas do mundo (equivalentes às listas
// que o NIST recomenda verificar) — impedir que DUAS contas diferentes usem a
// mesma senha entre si não é possível de fazer com segurança (obrigaria o
// servidor a comparar a senha de uma pessoa com a de outra, o que é o oposto
// de seguro); o que protege de verdade é impedir senhas fracas e previsíveis.
const COMMON_WEAK_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
  'qwerty123', 'qwertyuiop', '11111111', '00000000', '123123123', 'abc123456',
  'iloveyou', 'iloveyou1', 'admin123', 'admin1234', 'welcome1', 'welcome123',
  'senha1234', 'senha123456', 'senha12345', '1234567891', '87654321', '123454321',
  'asdfghjk', 'asdfghjkl', 'letmein1', 'letmein123', 'football1', 'baseball1',
  'princess1', 'sunshine1', 'master123', 'dragon123', 'trustno1', 'monkey123',
  'passw0rd', 'p@ssw0rd', 'qazwsx123', '1q2w3e4r', '1q2w3e4r5t', 'zxcvbnm123',
  '000000000', 'q1w2e3r4', 'changeme1', 'test1234', 'test12345', 'user1234',
  'abcd1234', '1234abcd', 'senhasenha', 'minhasenha', 'contrasena',
]);
function isWeakPassword(password) {
  const p = String(password).toLowerCase();
  if (COMMON_WEAK_PASSWORDS.has(p)) return true;
  if (/^(.)\1+$/.test(p)) return true; // todos os caracteres iguais (ex: "aaaaaaaa")
  // sequência simples e crescente de caracteres (ex: "12345678", "abcdefgh")
  let sequential = true;
  for (let i = 1; i < p.length; i++) {
    if (p.charCodeAt(i) !== p.charCodeAt(i - 1) + 1) { sequential = false; break; }
  }
  return sequential;
}

function isAdminPhone(phone) {
  if (process.env.ADMIN_PHONE) return phone === process.env.ADMIN_PHONE;
  return phone === firstRegisteredPhone;
}

const sessions = {};
function makeToken() { return crypto.randomBytes(24).toString('hex'); }

function publicUser(u) {
  return { id: u.id, name: u.name, phone: u.phone, username: u.username || null, country: u.country, email: u.email, isAdmin: isAdminPhone(u.phone), createdAt: u.createdAt, publicKey: u.publicKey || null, avatarUrl: u.avatarUrl || null, preferredLang: u.preferredLang || null, accentColor: u.accentColor || null, chatWallpaper: u.chatWallpaper || null, totalTimeSpentSec: u.totalTimeSpentSec || 0, birthday: u.birthday || null, twoFactorEnabled: !!u.twoFactorEnabled, pixKey: u.pixKey || null };
}

app.post('/api/register', async (req, res) => {
  const { name, phone, country, email, password, birthday } = req.body || {};
  let { username } = req.body || {};
  if (!name || !phone || !country || !password || !username) {
    return res.status(400).json({ error: 'Nome, nome de utilizador, telefone, país e senha são obrigatórios.' });
  }
  username = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (username.length < 3) return res.status(400).json({ error: 'O nome de utilizador deve ter pelo menos 3 caracteres (letras, números ou _).' });
  if (accounts[phone]) return res.status(409).json({ error: 'Já existe uma conta com esse número de telefone.' });
  if (usernameIndex[username]) return res.status(409).json({ error: 'Esse nome de utilizador já está a ser usado. Escolhe outro.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
  if (isWeakPassword(password)) return res.status(400).json({ error: 'Essa senha é demasiado comum/fácil de adivinhar (ex.: sequências ou senhas muito usadas). Escolhe uma diferente.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const validBirthday = typeof birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : null;
  const deviceId = (req.body?.deviceId || '').trim();
  const deviceName = (req.body?.deviceName || 'Dispositivo desconhecido').trim().slice(0, 60);
  const devices = deviceId ? [{ id: deviceId, name: deviceName, lastSeenAt: new Date().toISOString() }] : [];
  const user = { id: 'u_' + Date.now(), name, phone, username, country, email: email || '', birthday: validBirthday, salt, passwordHash, createdAt: new Date().toISOString(), contacts: [], devices };
  accounts[phone] = user;
  usernameIndex[username] = phone;
  if (!firstRegisteredPhone) firstRegisteredPhone = phone;

  if (isDbConnected) {
    try {
      await AccountModel.create(user);
    } catch (e) {
      console.error('Erro ao gravar utilizador no Mongo:', e.message);
    }
  } else {
    saveUsers();
  }

  const token = makeToken();
  sessions[token] = phone;
  log(`🆕 Novo cadastro: ${name} (@${username})`, 'AUTH');
  res.json({ success: true, user: publicUser(user), token });
});

// Cada conta só pode estar ligada a, no máximo, 2 dispositivos ao mesmo
// tempo — um "dispositivo" aqui é identificado por um id aleatório que o
// próprio cliente gera uma vez e guarda no localStorage (persiste entre
// logins/logouts no mesmo aparelho, mas nunca sai dele). Um 3º dispositivo
// a tentar entrar é recusado com uma mensagem clara, em vez de silenciosamente
// deixar entrar; para libertar uma vaga, a pessoa remove um dispositivo em
// "Dispositivos ligados" (ver /api/devices e /api/devices/remove abaixo).
app.post('/api/login', async (req, res) => {
  const { phone, password } = req.body || {};
  const user = accounts[phone];
  if (!user || hashPassword(password || '', user.salt) !== user.passwordHash) {
    return res.status(401).json({ error: 'Telefone ou senha incorretos.' });
  }
  const deviceId = (req.body?.deviceId || '').trim();
  const deviceName = (req.body?.deviceName || 'Dispositivo desconhecido').trim().slice(0, 60);
  if (!deviceId) return res.status(400).json({ error: 'Pedido inválido (falta identificador do dispositivo).' });
  if (!user.devices) user.devices = [];
  const existing = user.devices.find((d) => d.id === deviceId);
  if (!existing && user.devices.length >= 2) {
    return res.status(403).json({ error: 'Esta conta já está a ser usada em 2 dispositivos (o máximo permitido). Remove um em "Dispositivos ligados" (menu ⋯ Mais funcionalidades) para poderes entrar aqui.' });
  }
  // Verificação em duas etapas: só entra em ação para um dispositivo NOVO,
  // numa conta que a ativou e que tem email guardado — ver comentário acima.
  if (!existing && user.twoFactorEnabled && user.email && getMailTransporter()) {
    const code = generateLoginCode();
    pendingLoginCodes[phone] = { code, deviceId, deviceName, attempts: 0, expiresAt: Date.now() + TWOFA_CODE_TTL_MS };
    const sent = await sendLoginCodeEmail(user, code);
    if (sent) {
      log(`🔐 Código de verificação enviado para ${user.name} (dispositivo novo)`, 'AUTH');
      return res.json({ needsVerification: true, maskedEmail: maskEmail(user.email) });
    }
    delete pendingLoginCodes[phone]; // falha ao enviar — não bloqueia o dono legítimo da conta
  }
  await completeLogin(user, existing, deviceId, deviceName, res);
});

app.post('/api/login/verify-code', async (req, res) => {
  const { phone, code } = req.body || {};
  const user = accounts[phone];
  const pending = pendingLoginCodes[phone];
  if (!user || !pending) return res.status(400).json({ error: 'Não há nenhum código pendente para este telefone. Volta a tentar entrar.' });
  if (Date.now() > pending.expiresAt) { delete pendingLoginCodes[phone]; return res.status(400).json({ error: 'O código expirou. Volta a tentar entrar para receberes um novo.' }); }
  if (pending.attempts >= 5) { delete pendingLoginCodes[phone]; return res.status(429).json({ error: 'Demasiadas tentativas erradas. Volta a tentar entrar para receberes um novo código.' }); }
  if (String(code || '').trim() !== pending.code) {
    pending.attempts++;
    return res.status(401).json({ error: 'Código incorreto.' });
  }
  delete pendingLoginCodes[phone];
  if (!user.devices) user.devices = [];
  const existing = user.devices.find((d) => d.id === pending.deviceId);
  await completeLogin(user, existing, pending.deviceId, pending.deviceName, res);
});

app.get('/api/devices', (req, res) => {
  const token = req.headers['x-auth-token'] || req.query.token;
  const phone = sessions[token];
  const user = accounts[phone];
  if (!phone || !user) return res.status(403).json({ error: 'Sessão inválida.' });
  const myDeviceId = req.query.deviceId || '';
  const devices = (user.devices || []).map((d) => ({ ...d, isThisDevice: d.id === myDeviceId }));
  res.json({ devices });
});

app.post('/api/devices/remove', async (req, res) => {
  const token = req.headers['x-auth-token'] || req.body?.token;
  const phone = sessions[token];
  const user = accounts[phone];
  if (!phone || !user) return res.status(403).json({ error: 'Sessão inválida.' });
  const deviceId = (req.body?.deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ error: 'Falta o identificador do dispositivo.' });
  user.devices = (user.devices || []).filter((d) => d.id !== deviceId);
  if (isDbConnected) {
    await AccountModel.updateOne({ phone }, { devices: user.devices }).catch((e) => console.error('Erro Mongo (remover dispositivo):', e.message));
  } else {
    saveUsers();
  }
  res.json({ success: true, devices: user.devices });
});

// ==================== OS MEUS DADOS (exportar / apagar conta) ====================
// Junta num único ficheiro tudo o que esta conta guarda espalhado pelos vários
// armazenamentos "por telefone" da app (perfil, contactos, lembretes, lista de
// compras, etc.) e as mensagens que dizem respeito a esta pessoa. Nas
// mensagens de GRUPO só entram as que a própria pessoa enviou — as de outras
// pessoas num grupo aberto a todos não são "dados dela" para exportar, só as
// de conversas 1-para-1 (onde é sempre uma das duas partes) e as próprias.
// O conteúdo binário de anexos (fotos/áudio em base64) fica de fora para o
// ficheiro não ficar gigante — mantém só os metadados (nome/tipo do ficheiro).
app.get('/api/account/export', (req, res) => {
  const token = req.headers['x-auth-token'] || req.query.token;
  const phone = sessions[token];
  const user = accounts[phone];
  if (!phone || !user) return res.status(403).json({ error: 'Sessão inválida.' });
  const mensagens = [];
  Object.entries(messagesByRoom).forEach(([roomId, msgs]) => {
    (msgs || []).forEach((m) => {
      const sentByMe = m.senderPhone === phone;
      const receivedByMeInDm = roomId.startsWith('dm_') && m.toPhone === phone;
      if (!sentByMe && !receivedByMeInDm) return;
      const { fileData, ...rest } = m;
      mensagens.push({ chatId: roomId, ...rest, temAnexo: !!fileData });
    });
  });
  const exportData = {
    exportadoEm: new Date().toISOString(),
    perfil: {
      nome: user.name, telefone: user.phone, nomeDeUtilizador: user.username || null, pais: user.country,
      email: user.email || null, aniversario: user.birthday || null, criadaEm: user.createdAt,
      linguaPreferida: user.preferredLang || null, verificacaoEmDuasEtapas: !!user.twoFactorEnabled,
      tempoTotalNaAppSegundos: user.totalTimeSpentSec || 0, pixKey: user.pixKey || null
    },
    dispositivosLigados: user.devices || [],
    contactos: user.contacts || [],
    mensagens,
    lembretes: remindersByPhone[phone] || [],
    listaDeCompras: shoppingListByPhone[phone] || null,
    favoritosDeTurismo: tourismFavoritesByPhone[phone] || [],
    historicoDeChamadas: callLogByPhone[phone] || [],
    mensagensAgendadas: (scheduledMessages || []).filter((s) => s.senderPhone === phone)
  };
  res.setHeader('Content-Disposition', 'attachment; filename="os-meus-dados-chatapp.json"');
  res.json(exportData);
});

// Restaura dados pessoais a partir de um ficheiro já exportado por
// /api/account/export (ex.: depois de reinstalar a app, trocar de aparelho,
// ou reaproveitar o backup de uma conta apagada por engano). Propositadamente
// NÃO restaura tudo o que está no ficheiro:
// - Nome/telefone/nome de utilizador/senha ficam de fora — esses identificam
//   a própria conta, não fazem sentido "restaurar" por cima de uma conta já
//   com sessão iniciada (poderia confundir-se com roubo de identidade).
// - Mensagens ficam de fora — já vivem no servidor associadas à conversa
//   real entre as duas contas (nunca são apagadas quando uma conta é
//   apagada, ver performAccountDeletion acima); "restaurá-las" duplicaria
//   histórico ou criaria mensagens fantasma sem correspondência do outro lado.
// - Dispositivos ligados e histórico de chamadas ficam de fora — são
//   específicos do aparelho/momento, sem sentido reaproveitar.
// - Mensagens agendadas ficam de fora — podiam disparar tarde de mais e sem
//   aviso, com uma hora já passada há muito tempo.
// O resto (idioma, aniversário, chave Pix, contactos, lembretes, lista de
// compras, favoritos de turismo) é seguro reaproveitar: contactos só
// readicionam quem ainda tem conta (mesmo addContact do fluxo normal),
// lembretes/favoritos juntam-se aos já existentes sem apagar nada (por id),
// e a lista de compras só entra se ainda não houver nenhuma.
app.post('/api/account/import', async (req, res) => {
  const token = req.headers['x-auth-token'] || req.body?.token;
  const phone = sessions[token];
  const user = accounts[phone];
  if (!phone || !user) return res.status(403).json({ error: 'Sessão inválida.' });
  const data = req.body?.data;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Ficheiro inválido — exporta os teus dados de novo e tenta com esse ficheiro.' });

  const resumo = { perfil: false, contactos: 0, lembretes: 0, listaDeCompras: false, favoritosDeTurismo: 0 };

  if (data.perfil && typeof data.perfil === 'object') {
    const p = data.perfil;
    if (typeof p.linguaPreferida === 'string') user.preferredLang = p.linguaPreferida;
    if (typeof p.aniversario === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.aniversario)) user.birthday = p.aniversario;
    if (typeof p.pixKey === 'string') user.pixKey = p.pixKey.slice(0, 140) || null;
    resumo.perfil = true;
  }

  if (Array.isArray(data.contactos)) {
    for (const contactPhone of data.contactos) {
      if (typeof contactPhone === 'string' && await addContact(phone, contactPhone)) resumo.contactos++;
    }
  }

  if (Array.isArray(data.lembretes)) {
    if (!remindersByPhone[phone]) remindersByPhone[phone] = [];
    const existingIds = new Set(remindersByPhone[phone].map((r) => r.id));
    data.lembretes.forEach((r) => {
      if (r && r.id && !existingIds.has(r.id)) { remindersByPhone[phone].push(r); existingIds.add(r.id); resumo.lembretes++; }
    });
    saveRemindersLocal();
  }

  if (data.listaDeCompras && typeof data.listaDeCompras === 'object' && Array.isArray(data.listaDeCompras.items)) {
    if (!shoppingListByPhone[phone] || !shoppingListByPhone[phone].items.length) {
      shoppingListByPhone[phone] = { items: data.listaDeCompras.items, history: data.listaDeCompras.history || [] };
      saveShoppingListLocal();
      resumo.listaDeCompras = true;
    }
  }

  if (Array.isArray(data.favoritosDeTurismo)) {
    if (!tourismFavoritesByPhone[phone]) tourismFavoritesByPhone[phone] = [];
    const existingIds = new Set(tourismFavoritesByPhone[phone].map((f) => f.id));
    data.favoritosDeTurismo.forEach((f) => {
      if (f && f.id && !existingIds.has(f.id)) { tourismFavoritesByPhone[phone].push(f); existingIds.add(f.id); resumo.favoritosDeTurismo++; }
    });
    saveTourismFavoritesLocal();
  }

  if (isDbConnected) {
    await AccountModel.updateOne({ phone }, { preferredLang: user.preferredLang, birthday: user.birthday, pixKey: user.pixKey }).catch((e) => console.error('Erro Mongo (importar dados):', e.message));
  } else {
    saveUsers();
  }
  sendContactsTo(phone);
  res.json({ success: true, resumo, user: publicUser(user) });
});

// Apagar a conta é permanente — pede a senha outra vez (não basta estar
// sessão iniciada) para não bastar alguém pegar num aparelho destrancado. As
// mensagens já enviadas ficam como estão nas conversas de quem as recebeu
// (tal como no WhatsApp: apagar a conta não apaga o que já chegou a outras
// pessoas), só os dados PRÓPRIOS desta conta são removidos.
// Partilhado entre "apagar a própria conta" e "o administrador apaga uma
// conta" (ver mais abaixo) — a única diferença entre os dois é COMO se prova
// que se tem o direito de apagar (a própria senha, ou ser administrador),
// nunca o que é apagado.
async function performAccountDeletion(phone) {
  const user = accounts[phone];
  if (!user) return null;
  delete accounts[phone];
  if (user.username) delete usernameIndex[user.username];
  delete remindersByPhone[phone];
  delete shoppingListByPhone[phone];
  delete tourismFavoritesByPhone[phone];
  delete callLogByPhone[phone];
  delete pendingLoginCodes[phone];
  scheduledMessages = (scheduledMessages || []).filter((s) => s.senderPhone !== phone);
  Object.keys(sessions).forEach((t) => { if (sessions[t] === phone) delete sessions[t]; });
  const activeSockets = phoneToSockets[phone];
  if (activeSockets) {
    activeSockets.forEach((sid) => {
      io.to(sid).emit('account_deleted');
      io.sockets.sockets.get(sid)?.disconnect(true);
    });
    delete phoneToSockets[phone];
  }
  if (isDbConnected) {
    await AccountModel.deleteOne({ phone }).catch((e) => console.error('Erro Mongo (apagar conta):', e.message));
  } else {
    saveUsers();
  }
  saveRemindersLocal();
  saveShoppingListLocal();
  saveTourismFavoritesLocal();
  saveCallLogLocal();
  saveScheduledLocal();
  return user;
}

app.post('/api/account/delete', async (req, res) => {
  const token = req.headers['x-auth-token'] || req.body?.token;
  const phone = sessions[token];
  const user = accounts[phone];
  if (!phone || !user) return res.status(403).json({ error: 'Sessão inválida.' });
  const { password } = req.body || {};
  if (hashPassword(password || '', user.salt) !== user.passwordHash) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }
  await performAccountDeletion(phone);
  log(`🗑️ Conta apagada (pela própria pessoa): ${user.name} (${phone})`, 'AUTH');
  res.json({ success: true });
});

// O administrador apaga a conta de outra pessoa — pensado para quem
// esqueceu a senha e não tem 2FA/email configurado para recuperar o acesso
// de outra forma: como não há (ainda) uma redefinição de senha a sério,
// apagar a conta liberta o telefone/nome de utilizador para essa pessoa se
// voltar a registar do zero. Não pede a senha da conta-alvo (é precisamente
// o que falta), só que quem pede seja mesmo o administrador.
app.post('/api/admin/delete-account', async (req, res) => {
  const token = req.headers['x-auth-token'] || req.body?.token;
  const adminPhone = sessions[token];
  if (!adminPhone || !isAdminPhone(adminPhone)) return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  const targetPhone = (req.body?.phone || '').trim();
  const user = accounts[targetPhone];
  if (!user) return res.status(404).json({ error: 'Não existe nenhuma conta com esse telefone.' });
  if (targetPhone === adminPhone) return res.status(400).json({ error: 'Não podes apagar a tua própria conta de administrador por aqui — usa "Apagar conta" no teu perfil.' });
  await performAccountDeletion(targetPhone);
  log(`🗑️ Conta apagada pelo administrador: ${user.name} (${targetPhone})`, 'AUTH');
  res.json({ success: true });
});

// ==================== ASSOCIAR NOVO DISPOSITIVO POR CÓDIGO QR ====================
// Tal como o WhatsApp Web: o dispositivo já ligado gera um código de uso
// único que expira em 60 segundos, mostrado como QR (gerado aqui mesmo no
// nosso servidor com a biblioteca "qrcode" — nunca é enviado a nenhum
// terceiro, ao contrário de usar uma API externa de geração de QR, que
// revelaria o código de acesso a esse terceiro). O outro dispositivo lê o QR
// com a câmara normal do telemóvel, que abre o URL do próprio ChatApp com
// ?pair=<código> — a app troca isso por uma sessão válida automaticamente,
// sem precisar de escrever a senha. Conta sempre para o limite de 2
// dispositivos, tal como um login normal.
const devicePairings = {}; // token -> { phone, expiresAt, completed, completedDeviceName }
setInterval(() => {
  const now = Date.now();
  Object.keys(devicePairings).forEach((t) => {
    if (now > devicePairings[t].expiresAt + 30000) delete devicePairings[t]; // margem extra para o dispositivo de origem confirmar via /status
  });
}, 30000);

app.post('/api/device-pairing/create', async (req, res) => {
  const token = req.headers['x-auth-token'] || req.body?.token;
  const phone = sessions[token];
  const user = accounts[phone];
  if (!phone || !user) return res.status(403).json({ error: 'Sessão inválida.' });
  if ((user.devices || []).length >= 2) {
    return res.status(403).json({ error: 'Já tens 2 dispositivos ligados (o máximo). Remove um primeiro em "Dispositivos ligados".' });
  }
  const origin = (req.body?.origin || '').replace(/\/$/, '');
  if (!origin) return res.status(400).json({ error: 'Pedido inválido.' });
  const pairingToken = crypto.randomBytes(20).toString('hex');
  const expiresAt = Date.now() + 60000;
  devicePairings[pairingToken] = { phone, expiresAt, completed: false };
  try {
    const qrDataUrl = await QRCode.toDataURL(`${origin}/?pair=${pairingToken}`, { width: 260, margin: 1 });
    res.json({ success: true, qrDataUrl, pairingToken, expiresInSec: 60 });
  } catch (err) {
    console.error('Erro ao gerar QR de pareamento:', err.message);
    res.status(500).json({ error: 'Não foi possível gerar o código.' });
  }
});

app.get('/api/device-pairing/status', (req, res) => {
  const token = req.headers['x-auth-token'] || req.query.token;
  const phone = sessions[token];
  if (!phone) return res.status(403).json({ error: 'Sessão inválida.' });
  const pairing = devicePairings[req.query.pairingToken];
  if (!pairing || pairing.phone !== phone) return res.json({ status: 'expired' });
  if (Date.now() > pairing.expiresAt && !pairing.completed) { delete devicePairings[req.query.pairingToken]; return res.json({ status: 'expired' }); }
  if (pairing.completed) { delete devicePairings[req.query.pairingToken]; return res.json({ status: 'completed', deviceName: pairing.completedDeviceName }); }
  res.json({ status: 'pending' });
});

app.post('/api/device-pairing/redeem', async (req, res) => {
  const { pairingToken, deviceId, deviceName } = req.body || {};
  const pairing = devicePairings[pairingToken];
  if (!pairing || pairing.completed || Date.now() > pairing.expiresAt) {
    return res.status(400).json({ error: 'Este código expirou ou já foi usado. Pede um novo no outro dispositivo.' });
  }
  const user = accounts[pairing.phone];
  if (!user) return res.status(404).json({ error: 'Conta não encontrada.' });
  if (!deviceId) return res.status(400).json({ error: 'Pedido inválido (falta identificador do dispositivo).' });
  if (!user.devices) user.devices = [];
  const cleanDeviceName = (deviceName || 'Dispositivo desconhecido').trim().slice(0, 60);
  const existing = user.devices.find((d) => d.id === deviceId);
  if (existing) {
    existing.name = cleanDeviceName;
    existing.lastSeenAt = new Date().toISOString();
  } else if (user.devices.length >= 2) {
    return res.status(403).json({ error: 'Esta conta já está a ser usada em 2 dispositivos (o máximo permitido).' });
  } else {
    user.devices.push({ id: deviceId, name: cleanDeviceName, lastSeenAt: new Date().toISOString() });
  }
  if (isDbConnected) {
    await AccountModel.updateOne({ phone: pairing.phone }, { devices: user.devices }).catch((e) => console.error('Erro Mongo (pareamento):', e.message));
  } else {
    saveUsers();
  }
  pairing.completed = true;
  pairing.completedDeviceName = cleanDeviceName;
  const token = makeToken();
  sessions[token] = pairing.phone;
  log(`🔗 Novo dispositivo associado por QR: ${cleanDeviceName} (${user.name})`, 'AUTH');
  res.json({ success: true, user: publicUser(user), token });
});

// ==================== CONVITE PARA GRUPO PRIVADO POR LINK/QR ====================
// Um grupo "privado" (ver campo 'private' no create_group) só é visível a quem
// está em 'memberPhones' — em vez de aberto a todos, como o resto dos grupos
// desta app (ver README). Este link/QR é a forma de outra pessoa lá entrar:
// abre o URL do próprio ChatApp com ?joinGroup=<token>, tal como o pareamento de
// dispositivo por QR já faz com ?pair=<token>. O QR é sempre gerado aqui no
// nosso servidor (nunca por um serviço externo), mesmo padrão do pareamento.
app.post('/api/group-invite/get', async (req, res) => {
  const token = req.headers['x-auth-token'] || req.body?.token;
  const phone = sessions[token];
  if (!phone) return res.status(403).json({ error: 'Sessão inválida — faz login de novo.' });
  const { groupId, regenerate, origin } = req.body || {};
  const group = groups[groupId];
  if (!group || !group.private) return res.status(404).json({ error: 'Grupo privado não encontrado.' });
  if (!isGroupMember(group, phone)) return res.status(403).json({ error: 'Não és membro deste grupo.' });
  if (regenerate) {
    if (!group.admins?.includes(phone)) return res.status(403).json({ error: 'Só administradores do grupo podem gerar um novo link (o anterior deixa de funcionar).' });
    group.inviteToken = crypto.randomBytes(12).toString('hex');
    if (isDbConnected) {
      await GroupModel.updateOne({ id: groupId }, { inviteToken: group.inviteToken }).catch(e => console.error('Erro Mongo (convite do grupo):', e.message));
    } else {
      saveGroupsLocal();
    }
  }
  if (!group.inviteToken) return res.status(404).json({ error: 'Ainda não há nenhum link de convite gerado para este grupo.' });
  const cleanOrigin = (origin || '').replace(/\/$/, '');
  if (!cleanOrigin) return res.status(400).json({ error: 'Pedido inválido.' });
  try {
    const inviteUrl = `${cleanOrigin}/?joinGroup=${group.inviteToken}`;
    const qrDataUrl = await QRCode.toDataURL(inviteUrl, { width: 220, margin: 1 });
    res.json({ success: true, inviteUrl, qrDataUrl });
  } catch (err) {
    console.error('Erro ao gerar QR de convite de grupo:', err.message);
    res.status(500).json({ error: 'Não foi possível gerar o código.' });
  }
});

app.post('/api/group-invite/redeem', async (req, res) => {
  const token = req.headers['x-auth-token'] || req.body?.token;
  const phone = sessions[token];
  if (!phone) return res.status(401).json({ error: 'Precisas de ter sessão iniciada para entrar por um link de convite.' });
  const { inviteToken } = req.body || {};
  if (!inviteToken) return res.status(400).json({ error: 'Pedido inválido.' });
  const group = Object.values(groups).find((g) => g.private && g.inviteToken === inviteToken);
  if (!group) return res.status(404).json({ error: 'Este link de convite é inválido, ou o grupo já não existe.' });
  if (group.bannedPhones?.includes(phone)) return res.status(403).json({ error: 'Foste removido deste grupo e não podes voltar a entrar por convite.' });
  if (!group.memberPhones.includes(phone)) {
    group.memberPhones.push(phone);
    if (isDbConnected) {
      await GroupModel.updateOne({ id: group.id }, { memberPhones: group.memberPhones }).catch(e => console.error('Erro Mongo (entrar por convite):', e.message));
    } else {
      saveGroupsLocal();
    }
    broadcastGroupsUpdate();
    log(`🔗 ${accounts[phone]?.name || phone} entrou no grupo privado "${group.name}" por convite`, 'GROUP');
  }
  res.json({ success: true, groupId: group.id, groupName: group.name });
});

app.get('/api/admin/users', (req, res) => {
  const token = req.query.token || req.headers['x-admin-token'];
  const phone = sessions[token];
  if (!phone || !isAdminPhone(phone)) return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  res.json({ users: Object.values(accounts).map(publicUser) });
});

app.post('/api/publish-key', async (req, res) => {
  const token = req.headers['x-auth-token'] || req.body?.token;
  const phone = sessions[token];
  if (!phone || !accounts[phone]) return res.status(403).json({ error: 'Sessão inválida.' });
  accounts[phone].publicKey = req.body?.publicKeyJwk || null;

  if (isDbConnected) {
    await AccountModel.updateOne({ phone }, { publicKey: accounts[phone].publicKey }).catch(e => console.error('Erro Mongo (publicKey):', e.message));
  } else {
    saveUsers();
  }

  notifyContactsOfStatusChange(phone); // avisa quem te tem como contacto de que a tua chave pública mudou
  res.json({ success: true });
});

// Cronómetro "quantas horas perdeu na app" — o cliente manda um incremento de
// vez em quando (só enquanto a aba está em primeiro plano), e isto vai
// somando ao total guardado na conta. Limita a 5 minutos por pedido para
// não deixar um cliente malicioso inflacionar o próprio contador.
app.post('/api/time-spent', async (req, res) => {
  const token = req.headers['x-auth-token'] || req.body?.token;
  const phone = sessions[token];
  if (!phone || !accounts[phone]) return res.status(403).json({ error: 'Sessão inválida.' });
  const seconds = Math.min(Math.max(Number(req.body?.seconds) || 0, 0), 300);
  if (seconds > 0) {
    accounts[phone].totalTimeSpentSec = (accounts[phone].totalTimeSpentSec || 0) + seconds;
    if (isDbConnected) {
      await AccountModel.updateOne({ phone }, { totalTimeSpentSec: accounts[phone].totalTimeSpentSec }).catch(e => console.error('Erro Mongo (tempo gasto):', e.message));
    } else {
      saveUsers();
    }
  }
  res.json({ success: true, totalTimeSpentSec: accounts[phone].totalTimeSpentSec });
});

// ==================== TRANSPORTES ====================
const transportCache = {};
async function cachedFetch(key, url, ttlMs, options) {
  const now = Date.now();
  if (transportCache[key] && (now - transportCache[key].t) < ttlMs) return transportCache[key].data;
  const r = await fetch(url, options);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ao consultar ' + url);
  const data = await r.json();
  transportCache[key] = { t: now, data };
  return data;
}

// A instância pública do Overpass API (overpass-api.de) tem limites de taxa
// apertados e por vezes fica lenta/indisponível sob carga — sem isto, um
// pedido preso lá ficava pendurado (sem timeout) e o utilizador só via "Não
// foi possível procurar agora" muito depois, ou nunca. Com timeout curto por
// tentativa e um espelho público de reserva, uma falha na instância
// principal recupera automaticamente em vez de deixar a funcionalidade
// inutilizável enquanto essa instância estiver em baixo.
const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OVERPASS_TIMEOUT_MS = 12000;
async function fetchOverpass(key, query, ttlMs) {
  const now = Date.now();
  if (transportCache[key] && (now - transportCache[key].t) < ttlMs) return transportCache[key].data;
  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status + ' ao consultar ' + endpoint); continue; }
      const data = await r.json();
      transportCache[key] = { t: now, data };
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;
    }
  }
  throw lastErr || new Error('Overpass indisponível.');
}

app.get('/api/transport/buses', async (req, res) => {
  try {
    const data = await cachedFetch('buses', 'https://api.carrismetropolitana.pt/v2/vehicles', 10000);
    res.json(data);
  } catch (err) {
    console.error('Erro autocarros:', err.message);
    res.status(502).json({ error: 'Não foi possível obter os autocarros agora.' });
  }
});

app.get('/api/transport/metro-stations', async (req, res) => {
  try {
    const data = await cachedFetch('metro', 'https://api.carrismetropolitana.pt/v2/facilities/subway_stations', 3600000);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Não foi possível obter as estações de metro.' });
  }
});
app.get('/api/transport/train-stations', async (req, res) => {
  try {
    const data = await cachedFetch('train', 'https://api.carrismetropolitana.pt/v2/facilities/train_stations', 3600000);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Não foi possível obter as estações de comboio.' });
  }
});

// ==================== BICICLETAS PARTILHADAS (GIRA — Lisboa) ====================
// Pediram para juntar GIRA + Lime + Bolt aqui. Só a GIRA entra: é o sistema
// municipal (gerido pela EMEL/Câmara de Lisboa), com dados publicados no
// portal de dados abertos oficial deles (dados.emel.pt, CKAN — o mesmo tipo
// de plataforma já usado por outros municípios nesta app). A Lime e a Bolt
// são empresas privadas que, tal como confirmado pelo próprio pedido ("API
// não oficial"), não têm uma API pública genuína em Lisboa — só endpoints
// internos das apps deles, sem documentação nem autorização para uso
// externo. Seguindo o mesmo critério já aplicado a outras fontes nesta app
// (rejeitámos LetsFG, a API não-oficial da CP, etc. pela mesma razão), não
// fazemos scraping/engenharia reversa dessas duas.
//
// O portal é CKAN: primeiro perguntamos ao "package_show" quais os recursos
// (ficheiros) do dataset, depois descarregamos o recurso certo — em vez de
// apontar diretamente para um URL de recurso (que é um UUID que muda se o
// dataset for republicado).
const GIRA_CKAN_BASE = process.env.GIRA_CKAN_BASE || 'https://dados.emel.pt';
const GIRA_DATASET_ID = process.env.GIRA_DATASET_ID || 'girastations';
function firstNumber(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (!Number.isNaN(n) && v !== null && v !== undefined && v !== '') return n;
  }
  return null;
}
function normalizeGiraStation(raw) {
  // Nomes de campo não confirmados a partir deste ambiente (domínio .pt
  // bloqueado) — tentamos várias hipóteses comuns em datasets CKAN
  // portugueses e em GeoJSON, para não depender de acertar um nome exato.
  const props = raw.properties || raw;
  const geometry = raw.geometry;
  const lat = firstNumber(props.lat, props.latitude, props.Latitude, props.y, geometry?.coordinates?.[1]);
  const lon = firstNumber(props.lon, props.lng, props.longitude, props.Longitude, props.x, geometry?.coordinates?.[0]);
  if (lat == null || lon == null) return null;
  const name = props.name || props.Name || props.designacao || props.Designacao || props.station_name || 'Estação GIRA';
  const bikes = firstNumber(props.bikes, props.available_bikes, props.num_bikes_available, props.docas_disponiveis, props.free_bikes);
  const docks = firstNumber(props.docks, props.available_docks, props.num_docks_available, props.empty_slots, props.docas_livres);
  const capacity = firstNumber(props.capacity, props.capacidade, props.total_docks);
  return { id: props.id ?? props.station_id ?? `${lat},${lon}`, name, lat, lon, bikes, docks, capacity };
}
let giraResourceUrlCache = null;
async function resolveGiraResourceUrl() {
  const now = Date.now();
  if (giraResourceUrlCache && (now - giraResourceUrlCache.t) < 24 * 60 * 60 * 1000) return giraResourceUrlCache.url;
  const data = await cachedFetch('gira_package', `${GIRA_CKAN_BASE}/api/3/action/package_show?id=${GIRA_DATASET_ID}`, 24 * 60 * 60 * 1000, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' }
  });
  const resources = data?.result?.resources || [];
  const preferredFormats = ['geojson', 'json'];
  const resource = preferredFormats.map((fmt) => resources.find((r) => (r.format || '').toLowerCase() === fmt)).find(Boolean) || resources[0];
  if (!resource?.url) throw new Error('O dataset da GIRA não tem nenhum recurso descarregável.');
  giraResourceUrlCache = { t: now, url: resource.url };
  return resource.url;
}
app.get('/api/transport/bikes/gira', async (req, res) => {
  try {
    const resourceUrl = await resolveGiraResourceUrl();
    const data = await cachedFetch('gira_stations_data', resourceUrl, 5 * 60 * 1000, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' }
    });
    const rawList = Array.isArray(data) ? data : (data.features || data.stations || data.results || []);
    const stations = rawList.map((raw) => {
      try { return normalizeGiraStation(raw); } catch (err) { return null; }
    }).filter(Boolean);
    res.json({ stations });
  } catch (err) {
    console.error('Erro GIRA (bicicletas):', err.message);
    res.status(502).json({ error: 'Não foi possível obter as estações da GIRA agora.' });
  }
});

// ==================== MOTOR GTFS GENÉRICO (partilhado entre feeds) ====================
// Vários operadores publicam os seus horários programados em formato aberto GTFS (um
// .zip com várias tabelas .csv) — este motor descarrega, processa em memória (com cache
// por feed) e serve pesquisa de paragem/estação + próximas partidas a partir daí, para
// qualquer feed que lhe seja apontado (CP, autocarros de Guimarães, etc.).
const GTFS_TTL_MS = 24 * 60 * 60 * 1000; // os horários não mudam a cada minuto — um dia chega
const gtfsFeedCache = new Map(); // feedKey -> {data, loadedAt, loadPromise}

// Parser mínimo de uma linha CSV do GTFS — sem bibliotecas extra só para isto. Trata
// aspas à volta de campos com vírgulas lá dentro (o suficiente para o GTFS real, que
// não costuma ter quebras de linha dentro de um campo).
function parseGtfsCsvLine(line) {
  const fields = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}
function parseGtfsCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const headers = parseGtfsCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseGtfsCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
    return row;
  });
}
async function loadGtfsFeed(url, urlEnvVarName) {
  if (!AdmZip) throw new Error('O servidor não tem o pacote "adm-zip" instalado.');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  let resp;
  try {
    // Alguns portais/CDNs recusam ou falham em pedidos sem User-Agent de browser real —
    // o mesmo problema já visto nas notícias/pré-visualizações de links.
    resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        'Accept': 'application/zip,application/octet-stream,*/*'
      }
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao descarregar o GTFS`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
  if (!isZip) throw new Error(`A resposta de ${url} não é um ficheiro ZIP válido — a variável ${urlEnvVarName} provavelmente está desatualizada ou aponta para a página errada.`);
  let zip;
  try {
    zip = new AdmZip(buf);
  } catch (err) {
    throw new Error(`Não foi possível ler o ZIP de ${url}: ${err.message} — a variável ${urlEnvVarName} provavelmente está desatualizada.`);
  }
  const readCsv = (filename) => {
    const entry = zip.getEntry(filename);
    if (!entry) return [];
    return parseGtfsCsv(zip.readAsText(entry));
  };

  const stops = new Map(); // stop_id -> {id, name, lat, lon}
  readCsv('stops.txt').forEach((r) => {
    if (!r.stop_id) return;
    stops.set(r.stop_id, { id: r.stop_id, name: r.stop_name || r.stop_id, lat: Number(r.stop_lat), lon: Number(r.stop_lon) });
  });

  const routes = new Map(); // route_id -> {shortName, longName}
  readCsv('routes.txt').forEach((r) => {
    if (!r.route_id) return;
    routes.set(r.route_id, { shortName: r.route_short_name || '', longName: r.route_long_name || '' });
  });

  const trips = new Map(); // trip_id -> {routeId, serviceId, headsign}
  readCsv('trips.txt').forEach((r) => {
    if (!r.trip_id) return;
    trips.set(r.trip_id, { routeId: r.route_id, serviceId: r.service_id, headsign: r.trip_headsign || '' });
  });

  const calendar = new Map(); // service_id -> {days:[dom..sáb], start, end}
  readCsv('calendar.txt').forEach((r) => {
    if (!r.service_id) return;
    calendar.set(r.service_id, {
      days: [r.sunday, r.monday, r.tuesday, r.wednesday, r.thursday, r.friday, r.saturday].map((v) => v === '1'),
      start: r.start_date, end: r.end_date
    });
  });
  const calendarExceptions = new Map(); // service_id -> Map(YYYYMMDD -> 1 adicionado | 2 removido)
  readCsv('calendar_dates.txt').forEach((r) => {
    if (!r.service_id || !r.date) return;
    if (!calendarExceptions.has(r.service_id)) calendarExceptions.set(r.service_id, new Map());
    calendarExceptions.get(r.service_id).set(r.date, Number(r.exception_type));
  });

  const stopTimesByStop = new Map(); // stop_id -> [{tripId, arrival, departure}]
  const stopTimesByTrip = new Map(); // trip_id -> [{stopId, arrival, departure, sequence}], ordenado pela viagem
  readCsv('stop_times.txt').forEach((r) => {
    if (!r.stop_id || !r.trip_id) return;
    const entry = { tripId: r.trip_id, arrival: r.arrival_time || '', departure: r.departure_time || r.arrival_time || '' };
    if (!stopTimesByStop.has(r.stop_id)) stopTimesByStop.set(r.stop_id, []);
    stopTimesByStop.get(r.stop_id).push(entry);
    if (!stopTimesByTrip.has(r.trip_id)) stopTimesByTrip.set(r.trip_id, []);
    stopTimesByTrip.get(r.trip_id).push({ stopId: r.stop_id, arrival: entry.arrival, departure: entry.departure, sequence: Number(r.stop_sequence) || 0 });
  });
  stopTimesByTrip.forEach((list) => list.sort((a, b) => a.sequence - b.sequence));

  return { stops, routes, trips, calendar, calendarExceptions, stopTimesByStop, stopTimesByTrip };
}
async function ensureGtfsFeedLoaded(feedKey, resolveUrl, urlEnvVarName) {
  const entry = gtfsFeedCache.get(feedKey) || {};
  if (entry.data && Date.now() - entry.loadedAt < GTFS_TTL_MS) return entry.data;
  if (entry.loadPromise) return entry.loadPromise;
  const loadPromise = (async () => loadGtfsFeed(await resolveUrl(), urlEnvVarName))()
    .then((data) => { gtfsFeedCache.set(feedKey, { data, loadedAt: Date.now(), loadPromise: null }); return data; })
    .catch((err) => { gtfsFeedCache.set(feedKey, {}); throw err; });
  gtfsFeedCache.set(feedKey, { ...entry, loadPromise });
  return loadPromise;
}
// service_id de um horário GTFS só se aplica em certos dias da semana, dentro de um
// intervalo de datas — e pode ter exceções pontuais (feriados, dias especiais).
// Os horários de cada feed GTFS são sempre hora local DESSE país/rede (ex.:
// Europe/Lisbon para os feeds portugueses, Europe/Madrid para os espanhóis —
// que NÃO é o mesmo fuso: Espanha usa CET/CEST, uma hora à frente de Portugal
// (WET/WEST), apesar de geograficamente estarem no mesmo fuso). O servidor
// pode correr num fuso horário totalmente diferente de ambos (ex.: UTC no
// Railway) — sem isto, comparar os horários do GTFS com `new Date()`
// diretamente dava resultados errados sempre que o fuso do servidor não
// coincidisse com o do feed. Devolve um Date cujos "getters" locais
// (getHours, getDate, getDay, etc.) refletem a hora local do fuso pedido,
// seja qual for o fuso horário real do processo.
function nowInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  let hour = get('hour');
  if (hour === 24) hour = 0; // o Intl às vezes devolve "24" para a meia-noite em vez de "00"
  return new Date(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}
function nowInLisbon() { return nowInTimeZone('Europe/Lisbon'); }
function isServiceActiveOnDate(gtfs, serviceId, dateObj) {
  const dateStr = dateObj.getFullYear() + String(dateObj.getMonth() + 1).padStart(2, '0') + String(dateObj.getDate()).padStart(2, '0');
  const exceptions = gtfs.calendarExceptions.get(serviceId);
  if (exceptions?.has(dateStr)) return exceptions.get(dateStr) === 1;
  const cal = gtfs.calendar.get(serviceId);
  if (!cal) return false;
  if (dateStr < cal.start || dateStr > cal.end) return false;
  return !!cal.days[dateObj.getDay()];
}
function gtfsSearchStops(gtfs, q) {
  let list = [...gtfs.stops.values()];
  if (q) list = list.filter((s) => s.name.toLowerCase().includes(q));
  return list.slice(0, 30).map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon }));
}
function gtfsNextDepartures(gtfs, stationId, timeZone = 'Europe/Lisbon') {
  const station = gtfs.stops.get(stationId);
  if (!station) return null;
  const now = nowInTimeZone(timeZone);
  // Nota: horas GTFS depois da meia-noite vêm como "25:10:00" etc. (ainda contam para o
  // serviço do dia anterior) — esta comparação simples por string não lida com esse caso
  // à volta da meia-noite, é uma simplificação aceitável para uma lista de "próximas partidas".
  const nowHHMMSS = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
  const times = gtfs.stopTimesByStop.get(stationId) || [];
  const departures = times
    .filter((st) => st.departure >= nowHHMMSS)
    .map((st) => {
      const trip = gtfs.trips.get(st.tripId);
      if (!trip || !isServiceActiveOnDate(gtfs, trip.serviceId, now)) return null;
      const route = gtfs.routes.get(trip.routeId);
      return { time: st.departure, headsign: trip.headsign || route?.longName || '', routeName: route?.longName || route?.shortName || '' };
    })
    .filter(Boolean)
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 12);
  return { stationName: station.name, departures };
}

// Nenhum operador GTFS que usamos (CP, Guimarães, Metro/STCP do Porto) publica posição
// ao vivo dos veículos gratuitamente — confirmado e documentado no README. Em vez de
// nada, esta função ESTIMA a posição de cada viagem em curso por interpolação linear
// entre as duas paragens do horário que envolvem a hora atual (ou a posição exata da
// paragem, se o comboio estiver parado nela dentro da janela chegada→partida). Isto
// NÃO é GPS real: assume que a viagem está a decorrer exatamente conforme o horário,
// sem atrasos nem paragens não planeadas — por isso tem de ser sempre apresentado como
// "estimativa", nunca como posição ao vivo verdadeira.
function gtfsTimeToMinutesOfDay(t) {
  const parts = (t || '').split(':').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
  return parts[0] * 60 + parts[1] + (parts[2] || 0) / 60;
}
// Não há forma honesta de saber atrasos reais (nenhuma fonte GTFS-RT gratuita
// para CP/Fertagus/Madrid/Valência/Renfe) — em vez de inventar um número de
// atraso, mostramos uma MARGEM DE INCERTEZA: além da posição "a horas"
// (assumindo que a viagem decorre exatamente conforme o horário), calculamos
// também onde o comboio seria capaz de estar se estivesse atrasado até
// TRAIN_DELAY_UNCERTAINTY_MIN minutos — sempre mais atrás na rota, nunca mais
// à frente (um comboio não chega adiantado). O cliente desenha as duas.
const TRAIN_DELAY_UNCERTAINTY_MIN = 10;
function interpolateTripPositionAt(stopsList, gtfs, atMin) {
  for (let i = 0; i < stopsList.length; i++) {
    const s = stopsList[i];
    const stop = gtfs.stops.get(s.stopId);
    if (!stop) continue;
    const arr = gtfsTimeToMinutesOfDay(s.arrival);
    const dep = gtfsTimeToMinutesOfDay(s.departure);
    if (arr != null && dep != null && atMin >= arr && atMin <= dep) return { lat: stop.lat, lon: stop.lon };
    if (i < stopsList.length - 1 && dep != null) {
      const next = stopsList[i + 1];
      const nextStop = gtfs.stops.get(next.stopId);
      const nextArr = gtfsTimeToMinutesOfDay(next.arrival);
      if (nextStop && nextArr != null && atMin > dep && atMin < nextArr) {
        const progresso = nextArr > dep ? (atMin - dep) / (nextArr - dep) : 0;
        return { lat: stop.lat + (nextStop.lat - stop.lat) * progresso, lon: stop.lon + (nextStop.lon - stop.lon) * progresso };
      }
    }
  }
  return null;
}
function getEstimatedTrainPositions(gtfs, dateObj) {
  const nowMin = dateObj.getHours() * 60 + dateObj.getMinutes() + dateObj.getSeconds() / 60;
  const positions = [];
  for (const [tripId, stopsList] of gtfs.stopTimesByTrip.entries()) {
    if (stopsList.length < 2) continue;
    const trip = gtfs.trips.get(tripId);
    if (!trip || !isServiceActiveOnDate(gtfs, trip.serviceId, dateObj)) continue;
    const firstDep = gtfsTimeToMinutesOfDay(stopsList[0].departure);
    const lastArr = gtfsTimeToMinutesOfDay(stopsList[stopsList.length - 1].arrival);
    if (firstDep == null || lastArr == null || nowMin < firstDep || nowMin > lastArr) continue;
    // Paragens todas da viagem, para desenhar a rota completa no mapa (não só o ponto do comboio),
    // com a hora de horário de cada uma (para mostrar num popup por paragem).
    const routeStops = stopsList.map((s) => {
      const stop = gtfs.stops.get(s.stopId);
      return stop ? { name: stop.name, lat: stop.lat, lon: stop.lon, arrival: s.arrival, departure: s.departure } : null;
    }).filter(Boolean);
    const uncertainAtMin = Math.max(firstDep, nowMin - TRAIN_DELAY_UNCERTAINTY_MIN);
    const uncertainPos = interpolateTripPositionAt(stopsList, gtfs, uncertainAtMin);
    for (let i = 0; i < stopsList.length; i++) {
      const s = stopsList[i];
      const stop = gtfs.stops.get(s.stopId);
      if (!stop) continue;
      const arr = gtfsTimeToMinutesOfDay(s.arrival);
      const dep = gtfsTimeToMinutesOfDay(s.departure);
      if (arr != null && dep != null && nowMin >= arr && nowMin <= dep) {
        const route = gtfs.routes.get(trip.routeId);
        positions.push({
          tripId, routeName: route?.longName || route?.shortName || '', headsign: trip.headsign || '',
          lat: stop.lat, lon: stop.lon, fromStop: stop.name, toStop: stop.name, etaMin: 0, dwelling: true,
          routeStops,
          uncertainLat: uncertainPos?.lat ?? stop.lat, uncertainLon: uncertainPos?.lon ?? stop.lon, uncertaintyMin: TRAIN_DELAY_UNCERTAINTY_MIN
        });
        break;
      }
      if (i < stopsList.length - 1 && dep != null) {
        const next = stopsList[i + 1];
        const nextStop = gtfs.stops.get(next.stopId);
        const nextArr = gtfsTimeToMinutesOfDay(next.arrival);
        if (nextStop && nextArr != null && nowMin > dep && nowMin < nextArr) {
          const progresso = nextArr > dep ? (nowMin - dep) / (nextArr - dep) : 0;
          const route = gtfs.routes.get(trip.routeId);
          positions.push({
            tripId, routeName: route?.longName || route?.shortName || '', headsign: trip.headsign || '',
            lat: stop.lat + (nextStop.lat - stop.lat) * progresso,
            lon: stop.lon + (nextStop.lon - stop.lon) * progresso,
            fromStop: stop.name, toStop: nextStop.name,
            etaMin: Math.max(0, Math.round(nextArr - nowMin)),
            dwelling: false,
            routeStops,
            uncertainLat: uncertainPos?.lat ?? stop.lat, uncertainLon: uncertainPos?.lon ?? stop.lon, uncertaintyMin: TRAIN_DELAY_UNCERTAINTY_MIN
          });
          break;
        }
      }
    }
  }
  return positions;
}

// ==================== HORÁRIOS DE COMBOIOS (CP) ====================
// A CP não tem posição ao vivo dos comboios disponível gratuitamente. A fonte GTFS
// "oficial" (dados.gov.pt -> transporlis.pt) está morta há mais de um ano — confirmámos
// que já devolvia um feed vazio em abril de 2024, e o mesmo se confirma na cópia mais
// recente indexada pela Mobility Database. Fica documentado no README como indisponível;
// o código mantém-se pronto a usar se a CP alguma vez publicar um feed a funcionar.
const MOBILITY_DB_FEED_ID = process.env.MOBILITY_DB_FEED_ID || 'mdb-1037';
let mobilityDbAccessToken = null;
let mobilityDbAccessTokenExpiresAt = 0;
async function getMobilityDbAccessToken() {
  if (mobilityDbAccessToken && Date.now() < mobilityDbAccessTokenExpiresAt) return mobilityDbAccessToken;
  const refreshToken = process.env.MOBILITY_DB_REFRESH_TOKEN;
  const resp = await fetch('https://api.mobilitydatabase.org/v1/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao autenticar na Mobility Database — o MOBILITY_DB_REFRESH_TOKEN pode estar errado ou ter sido revogado.`);
  const data = await resp.json();
  if (!data.access_token) throw new Error('A Mobility Database não devolveu um access_token.');
  mobilityDbAccessToken = data.access_token;
  mobilityDbAccessTokenExpiresAt = Date.now() + 55 * 60 * 1000; // o token real dura 1h; renovamos com 5 min de margem
  return mobilityDbAccessToken;
}
async function resolveGtfsUrlViaMobilityDb(feedId) {
  const token = await getMobilityDbAccessToken();
  const resp = await fetch(`https://api.mobilitydatabase.org/v1/gtfs_feeds/${feedId}/datasets?latest=true`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao consultar a Mobility Database`);
  const datasets = await resp.json();
  const latest = Array.isArray(datasets) ? datasets[0] : null;
  if (!latest || !latest.hosted_url) throw new Error(`A Mobility Database não tem nenhum ficheiro disponível para o feed "${feedId}".`);
  return latest.hosted_url;
}
const CP_GTFS_URL_DEFAULT = 'https://publico.cp.pt/gtfs/gtfs.zip';
async function resolveCpGtfsUrl() {
  if (process.env.CP_GTFS_URL) return process.env.CP_GTFS_URL;
  if (!process.env.MOBILITY_DB_REFRESH_TOKEN) return CP_GTFS_URL_DEFAULT;
  return resolveGtfsUrlViaMobilityDb(MOBILITY_DB_FEED_ID);
}

// ==================== FERTAGUS (comboio Lisboa <-> Península de Setúbal) ====================
// A Fertagus é uma operadora diferente da CP (opera a travessia do Tejo entre Roma-
// Areeiro/Sete Rios/Campolide e a Margem Sul — Pragal, Coina, Setúbal, etc.). O feed
// publicado no portal transporlis.pt (o mesmo domínio que já vimos "morto" para a CP)
// pode ter mudado de URL recentemente segundo o registo da Mobility Database (feed
// mdb-1034) — por isso, tal como a CP, há um fallback via Mobility Database se o valor
// por omissão deixar de funcionar.
const FERTAGUS_GTFS_URL_DEFAULT = 'http://www.transporlis.pt/Portals/0/OpenData/gtfs/zip/13/gtfs_13.zip';
const FERTAGUS_MOBILITY_DB_FEED_ID = process.env.FERTAGUS_MOBILITY_DB_FEED_ID || 'mdb-1034';
async function resolveFertagusGtfsUrl() {
  if (process.env.FERTAGUS_GTFS_URL) return process.env.FERTAGUS_GTFS_URL;
  if (!process.env.MOBILITY_DB_REFRESH_TOKEN) return FERTAGUS_GTFS_URL_DEFAULT;
  return resolveGtfsUrlViaMobilityDb(FERTAGUS_MOBILITY_DB_FEED_ID);
}

app.get('/api/trains/stations', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const [cpGtfs, fertagusGtfs] = await Promise.all([
    ensureGtfsFeedLoaded('cp', resolveCpGtfsUrl, 'CP_GTFS_URL').catch((err) => { console.error('Erro GTFS (estações CP):', err.message); return null; }),
    ensureGtfsFeedLoaded('fertagus', resolveFertagusGtfsUrl, 'FERTAGUS_GTFS_URL').catch((err) => { console.error('Erro GTFS (estações Fertagus):', err.message); return null; })
  ]);
  if (!cpGtfs && !fertagusGtfs) return res.status(503).json({ error: 'Não foi possível obter os horários de comboio agora.' });
  const results = [];
  if (cpGtfs) gtfsSearchStops(cpGtfs, q).forEach((s) => results.push({ ...s, type: 'cp', operatorName: 'CP' }));
  if (fertagusGtfs) gtfsSearchStops(fertagusGtfs, q).forEach((s) => results.push({ ...s, type: 'fertagus', operatorName: 'Fertagus' }));
  res.json(results.slice(0, 30));
});

app.get('/api/trains/departures', async (req, res) => {
  const type = req.query.type === 'fertagus' ? 'fertagus' : 'cp';
  try {
    const gtfs = type === 'fertagus'
      ? await ensureGtfsFeedLoaded('fertagus', resolveFertagusGtfsUrl, 'FERTAGUS_GTFS_URL')
      : await ensureGtfsFeedLoaded('cp', resolveCpGtfsUrl, 'CP_GTFS_URL');
    const result = gtfsNextDepartures(gtfs, req.query.stationId);
    if (!result) return res.status(400).json({ error: 'Estação inválida.' });
    res.json(result);
  } catch (err) {
    console.error(`Erro GTFS (partidas ${type === 'fertagus' ? 'Fertagus' : 'CP'}):`, err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários de comboio agora: ' + err.message });
  }
});

// Posição ESTIMADA (não é GPS real — ver aviso na função getEstimatedTrainPositions)
// de cada comboio da CP atualmente "em viagem" segundo o horário oficial.
app.get('/api/trains/positions-estimated', async (req, res) => {
  const now = nowInLisbon();
  // Espanha usa CET/CEST (Europe/Madrid), uma hora à frente de Portugal — os
  // horários do GTFS da Renfe são hora local de Espanha, por isso não dá para
  // reutilizar `now` (hora de Lisboa) ao calcular as posições estimadas da Renfe.
  const nowMadrid = nowInTimeZone('Europe/Madrid');
  const [cpGtfs, fertagusGtfs, renfeCercaniasGtfs, renfeAveGtfs] = await Promise.all([
    ensureGtfsFeedLoaded('cp', resolveCpGtfsUrl, 'CP_GTFS_URL').catch((err) => { console.error('Erro GTFS (posições estimadas CP):', err.message); return null; }),
    ensureGtfsFeedLoaded('fertagus', resolveFertagusGtfsUrl, 'FERTAGUS_GTFS_URL').catch((err) => { console.error('Erro GTFS (posições estimadas Fertagus):', err.message); return null; }),
    ensureGtfsFeedLoaded(RENFE_RAIL_FEEDS.cercanias.key, RENFE_RAIL_FEEDS.cercanias.resolve, RENFE_RAIL_FEEDS.cercanias.envVar).catch((err) => { console.error('Erro GTFS (posições estimadas Renfe Cercanías):', err.message); return null; }),
    ensureGtfsFeedLoaded(RENFE_RAIL_FEEDS.ave.key, RENFE_RAIL_FEEDS.ave.resolve, RENFE_RAIL_FEEDS.ave.envVar).catch((err) => { console.error('Erro GTFS (posições estimadas Renfe AVE):', err.message); return null; })
  ]);
  if (!cpGtfs && !fertagusGtfs && !renfeCercaniasGtfs && !renfeAveGtfs) return res.status(503).json({ error: 'Não foi possível calcular as posições estimadas agora.' });
  const trains = [];
  if (cpGtfs) getEstimatedTrainPositions(cpGtfs, now).forEach((t) => trains.push({ ...t, operator: 'CP' }));
  if (fertagusGtfs) getEstimatedTrainPositions(fertagusGtfs, now).forEach((t) => trains.push({ ...t, operator: 'Fertagus' }));
  if (renfeCercaniasGtfs) getEstimatedTrainPositions(renfeCercaniasGtfs, nowMadrid).forEach((t) => trains.push({ ...t, operator: 'Renfe Cercanías' }));
  if (renfeAveGtfs) getEstimatedTrainPositions(renfeAveGtfs, nowMadrid).forEach((t) => trains.push({ ...t, operator: 'Renfe AVE' }));
  res.json({ trains });
});

// ==================== METRO DE LISBOA — GTFS ====================
// Mesmo padrão que resolveu a CP: o próprio Metro de Lisboa publica um feed GTFS
// "Google Transit" no seu site público (não é a API bloqueada api.metrolisboa.pt).
const METRO_LISBOA_GTFS_URL_DEFAULT = 'https://www.metrolisboa.pt/google_transit/googleTransit.zip';
async function resolveMetroLisboaGtfsUrl() {
  return process.env.METRO_LISBOA_GTFS_URL || METRO_LISBOA_GTFS_URL_DEFAULT;
}

app.get('/api/transport/metro-lisboa/stops', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('metro-lisboa', resolveMetroLisboaGtfsUrl, 'METRO_LISBOA_GTFS_URL');
    res.json(gtfsSearchStops(gtfs, (req.query.q || '').toLowerCase().trim()));
  } catch (err) {
    console.error('Erro GTFS (estações Metro de Lisboa):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários do Metro de Lisboa agora: ' + err.message });
  }
});

app.get('/api/transport/metro-lisboa/departures', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('metro-lisboa', resolveMetroLisboaGtfsUrl, 'METRO_LISBOA_GTFS_URL');
    const result = gtfsNextDepartures(gtfs, req.query.stationId);
    if (!result) return res.status(400).json({ error: 'Estação inválida.' });
    res.json(result);
  } catch (err) {
    console.error('Erro GTFS (partidas Metro de Lisboa):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários do Metro de Lisboa agora: ' + err.message });
  }
});

// ==================== AUTOCARROS DE GUIMARÃES (GUIMABUS) — GTFS ====================
// Feed GTFS real e atual da GUIMABUS, publicado no nó regional de dados abertos do Minho
// (Minho Access Point), encontrado através do dataset "Rede de Transporte Público
// Guimabus" no portal MAP da Ubiwhere. Ao contrário da CP, esta fonte está mesmo a
// funcionar (validade até final de 2026 à data de escrita deste código).
const GUIMARAES_GTFS_URL_DEFAULT = 'https://minhoaccesspoint.eu/dataset/ee6d46e4-9f19-4f4a-ab93-1a3cd69df349/resource/8ccbc875-55ac-4adb-85e2-88294cd7e39e/download/xi_gmr_gtfs_complete.zip';
async function resolveGuimaraesGtfsUrl() {
  return process.env.GUIMARAES_GTFS_URL || GUIMARAES_GTFS_URL_DEFAULT;
}

app.get('/api/transport/guimaraes/stops', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('guimaraes', resolveGuimaraesGtfsUrl, 'GUIMARAES_GTFS_URL');
    res.json(gtfsSearchStops(gtfs, (req.query.q || '').toLowerCase().trim()));
  } catch (err) {
    console.error('Erro GTFS (paragens Guimarães):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários de Guimarães agora: ' + err.message });
  }
});

app.get('/api/transport/guimaraes/departures', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('guimaraes', resolveGuimaraesGtfsUrl, 'GUIMARAES_GTFS_URL');
    const result = gtfsNextDepartures(gtfs, req.query.stationId);
    if (!result) return res.status(400).json({ error: 'Paragem inválida.' });
    res.json(result);
  } catch (err) {
    console.error('Erro GTFS (partidas Guimarães):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários de Guimarães agora: ' + err.message });
  }
});

// ==================== PORTO — METRO DO PORTO (GTFS) + STCP (tempo real) ====================
// Ambos os feeds GTFS estão publicados no portal de dados abertos da Câmara do Porto
// (opendata.porto.digital) — encontrados a partir da configuração de um projeto
// open-source (transportes-portugal-api). O Metro do Porto só tem horários programados
// (sem posição ao vivo pública conhecida). A STCP tem, além do GTFS (usado só para
// pesquisar paragens por nome), uma API pública e sem autenticação no próprio site
// (stcp.pt/api) que dá chegadas em tempo real — a mesma que o site deles usa.
const METRO_PORTO_GTFS_URL_DEFAULT = 'https://opendata.porto.digital/dataset/15f22603-a216-492a-ab1c-40b1d8aa2f08/resource/fdaaddbe-4782-4f4e-9a30-98caedce8dc5/download/gtfs_mdp_11_09_2023.zip';
async function resolveMetroPortoGtfsUrl() {
  return process.env.METRO_PORTO_GTFS_URL || METRO_PORTO_GTFS_URL_DEFAULT;
}
const STCP_GTFS_URL_DEFAULT = 'https://opendata.porto.digital/dataset/5275c986-592c-43f5-8f87-aabbd4e4f3a4/resource/1f845744-1962-4108-a20c-ac3357d0957b/download/gtfs-stcp.zip';
async function resolveStcpGtfsUrl() {
  return process.env.STCP_GTFS_URL || STCP_GTFS_URL_DEFAULT;
}
async function getStcpRealtimeArrivals(stopId) {
  const resp = await fetch(`https://stcp.pt/api/stops/${encodeURIComponent(stopId)}/realtime`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const arrivals = data.arrivals || [];
  return arrivals.map((a) => ({
    minutes: a.arrival_minutes,
    routeName: a.route_short_name || a.route_long_name || '',
    headsign: a.route_long_name || a.destination || ''
  }));
}

app.get('/api/transport/porto/stops', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const [metroGtfs, stcpGtfs] = await Promise.all([
    ensureGtfsFeedLoaded('metro-porto', resolveMetroPortoGtfsUrl, 'METRO_PORTO_GTFS_URL').catch((err) => { console.error('Erro GTFS (Metro do Porto):', err.message); return null; }),
    ensureGtfsFeedLoaded('stcp', resolveStcpGtfsUrl, 'STCP_GTFS_URL').catch((err) => { console.error('Erro GTFS (STCP):', err.message); return null; })
  ]);
  if (!metroGtfs && !stcpGtfs) return res.status(503).json({ error: 'Não foi possível obter as paragens do Porto agora.' });
  const results = [];
  if (metroGtfs) gtfsSearchStops(metroGtfs, q).forEach((s) => results.push({ ...s, type: 'metro' }));
  if (stcpGtfs) gtfsSearchStops(stcpGtfs, q).forEach((s) => results.push({ ...s, type: 'bus' }));
  res.json(results.slice(0, 30));
});

app.get('/api/transport/porto/departures', async (req, res) => {
  const { type, stationId } = req.query;
  if (!stationId) return res.status(400).json({ error: 'Paragem inválida.' });
  try {
    if (type === 'bus') {
      const gtfs = await ensureGtfsFeedLoaded('stcp', resolveStcpGtfsUrl, 'STCP_GTFS_URL');
      const station = gtfs.stops.get(stationId);
      if (!station) return res.status(400).json({ error: 'Paragem inválida.' });
      const arrivals = await getStcpRealtimeArrivals(stationId);
      res.json({
        stationName: station.name,
        departures: arrivals.map((a) => ({ display: a.minutes != null ? `${a.minutes} min` : '—', headsign: a.headsign, routeName: a.routeName }))
      });
    } else {
      const gtfs = await ensureGtfsFeedLoaded('metro-porto', resolveMetroPortoGtfsUrl, 'METRO_PORTO_GTFS_URL');
      const result = gtfsNextDepartures(gtfs, stationId);
      if (!result) return res.status(400).json({ error: 'Estação inválida.' });
      res.json({
        stationName: result.stationName,
        departures: result.departures.map((d) => ({ display: (d.time || '').slice(0, 5), headsign: d.headsign, routeName: d.routeName }))
      });
    }
  } catch (err) {
    console.error('Erro Porto (partidas):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários do Porto agora: ' + err.message });
  }
});

// ==================== MADRID — EMT (autocarros) + CRTM (Metro/Cercanías/Metro Ligeiro) ====================
// Todos os feeds geridos pela CRTM (Consórcio Regional de Transportes de Madrid),
// publicados no próprio ArcGIS Online oficial deles (crtm.maps.arcgis.com) — downloads
// diretos, sem registo. Confirmado através de projetos open-source que já os usam
// (o dataset "GTFS Red de EMT" no portal de dados abertos da CRTM aponta para o mesmo
// item). Só têm horários programados — nenhum destes tem posição ao vivo pública
// confirmada (ao contrário da Carris/STCP em Portugal).
const EMT_MADRID_GTFS_URL_DEFAULT = 'http://crtm.maps.arcgis.com/sharing/rest/content/items/868df0e58fca47e79b942902dffd7da0/data';
async function resolveEmtMadridGtfsUrl() {
  return process.env.EMT_MADRID_GTFS_URL || EMT_MADRID_GTFS_URL_DEFAULT;
}
const METRO_MADRID_GTFS_URL_DEFAULT = 'http://crtm.maps.arcgis.com/sharing/rest/content/items/5c7f2951962540d69ffe8f640d94c246/data';
async function resolveMetroMadridGtfsUrl() {
  return process.env.METRO_MADRID_GTFS_URL || METRO_MADRID_GTFS_URL_DEFAULT;
}
const METRO_LIGERO_MADRID_GTFS_URL_DEFAULT = 'http://crtm.maps.arcgis.com/sharing/rest/content/items/aaed26cc0ff64b0c947ac0bc3e033196/data';
async function resolveMetroLigeroMadridGtfsUrl() {
  return process.env.METRO_LIGERO_MADRID_GTFS_URL || METRO_LIGERO_MADRID_GTFS_URL_DEFAULT;
}
const CERCANIAS_MADRID_GTFS_URL_DEFAULT = 'http://crtm.maps.arcgis.com/sharing/rest/content/items/1a25440bf66f499bae2657ec7fb40144/data';
async function resolveCercaniasMadridGtfsUrl() {
  return process.env.CERCANIAS_MADRID_GTFS_URL || CERCANIAS_MADRID_GTFS_URL_DEFAULT;
}

app.get('/api/transport/madrid/bus-stops', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('emt-madrid', resolveEmtMadridGtfsUrl, 'EMT_MADRID_GTFS_URL');
    res.json(gtfsSearchStops(gtfs, (req.query.q || '').toLowerCase().trim()));
  } catch (err) {
    console.error('Erro GTFS (paragens EMT Madrid):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários da EMT Madrid agora: ' + err.message });
  }
});
app.get('/api/transport/madrid/bus-departures', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('emt-madrid', resolveEmtMadridGtfsUrl, 'EMT_MADRID_GTFS_URL');
    const result = gtfsNextDepartures(gtfs, req.query.stationId, 'Europe/Madrid');
    if (!result) return res.status(400).json({ error: 'Paragem inválida.' });
    res.json(result);
  } catch (err) {
    console.error('Erro GTFS (partidas EMT Madrid):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários da EMT Madrid agora: ' + err.message });
  }
});

const MADRID_RAIL_FEEDS = {
  metro: { key: 'metro-madrid', resolve: resolveMetroMadridGtfsUrl, envVar: 'METRO_MADRID_GTFS_URL', label: 'Metro' },
  'metro-ligero': { key: 'metro-ligero-madrid', resolve: resolveMetroLigeroMadridGtfsUrl, envVar: 'METRO_LIGERO_MADRID_GTFS_URL', label: 'Metro Ligero' },
  cercanias: { key: 'cercanias-madrid', resolve: resolveCercaniasMadridGtfsUrl, envVar: 'CERCANIAS_MADRID_GTFS_URL', label: 'Cercanías' }
};
app.get('/api/transport/madrid/rail-stops', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const loaded = await Promise.all(Object.entries(MADRID_RAIL_FEEDS).map(([type, f]) =>
    ensureGtfsFeedLoaded(f.key, f.resolve, f.envVar)
      .then((gtfs) => ({ type, label: f.label, gtfs }))
      .catch((err) => { console.error(`Erro GTFS (${f.label} Madrid):`, err.message); return null; })
  ));
  const active = loaded.filter(Boolean);
  if (!active.length) return res.status(503).json({ error: 'Não foi possível obter as estações de Madrid agora.' });
  const results = [];
  active.forEach(({ type, label, gtfs }) => gtfsSearchStops(gtfs, q).forEach((s) => results.push({ ...s, type, operatorName: label })));
  res.json(results.slice(0, 30));
});
app.get('/api/transport/madrid/rail-departures', async (req, res) => {
  const feed = MADRID_RAIL_FEEDS[req.query.type];
  if (!feed) return res.status(400).json({ error: 'Tipo de rede inválido.' });
  try {
    const gtfs = await ensureGtfsFeedLoaded(feed.key, feed.resolve, feed.envVar);
    const result = gtfsNextDepartures(gtfs, req.query.stationId, 'Europe/Madrid');
    if (!result) return res.status(400).json({ error: 'Estação inválida.' });
    res.json(result);
  } catch (err) {
    console.error(`Erro GTFS (partidas ${feed.label} Madrid):`, err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários de Madrid agora: ' + err.message });
  }
});

// ==================== VALÊNCIA — EMT (autocarros) + Metrovalencia/FGV (metro/tram) ====================
// EMT Valência: feed GTFS oficial publicado no portal de dados abertos da própria
// câmara (opendata.vlci.valencia.es). Metrovalencia: o feed pedido inicialmente
// (transitpdf.com/uran) era uma cópia "melhorada" de terceiros, não a fonte oficial —
// confirmámos por pesquisa que a fonte real é a própria FGV (Ferrocarrils de la
// Generalitat Valenciana), no mesmo padrão de URL estática já usado para o Metro de
// Lisboa (metrolisboa.pt/google_transit) e para a CP (publico.cp.pt/gtfs).
const EMT_VALENCIA_GTFS_URL_DEFAULT = 'https://opendata.vlci.valencia.es/dataset/ab058cf8-ad3e-4d9c-ac89-0c6367ecf351/resource/c81b69e6-c082-44dc-acc6-66fc417b4e66/download/google_transit.zip';
async function resolveEmtValenciaGtfsUrl() {
  return process.env.EMT_VALENCIA_GTFS_URL || EMT_VALENCIA_GTFS_URL_DEFAULT;
}
// O site oficial (metrovalencia.es) recusa-se a ligar a partir do Railway —
// confirmado que nem HTTP nem HTTPS chegam sequer a estabelecer ligação
// ("fetch failed", um erro de rede, não um erro HTTP normal — provavelmente
// bloqueia tráfego de datacenter, o mesmo problema já visto no Metro de
// Lisboa). Mesmo fallback já usado para a CP/Fertagus: em vez do site
// oficial, a Mobility Database (mobilitydatabase.org) guarda a sua própria
// cópia do feed (mdb-1054) — se `MOBILITY_DB_REFRESH_TOKEN` estiver
// configurado, usa essa cópia em vez do URL direto.
const METRO_VALENCIA_GTFS_URL_DEFAULT = 'https://www.metrovalencia.es/google_transit_feed/google_transit.zip';
const METRO_VALENCIA_MOBILITY_DB_FEED_ID = process.env.METRO_VALENCIA_MOBILITY_DB_FEED_ID || 'mdb-1054';
async function resolveMetroValenciaGtfsUrl() {
  if (process.env.METRO_VALENCIA_GTFS_URL) return process.env.METRO_VALENCIA_GTFS_URL;
  if (!process.env.MOBILITY_DB_REFRESH_TOKEN) return METRO_VALENCIA_GTFS_URL_DEFAULT;
  return resolveGtfsUrlViaMobilityDb(METRO_VALENCIA_MOBILITY_DB_FEED_ID);
}

app.get('/api/transport/valencia/bus-stops', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('emt-valencia', resolveEmtValenciaGtfsUrl, 'EMT_VALENCIA_GTFS_URL');
    res.json(gtfsSearchStops(gtfs, (req.query.q || '').toLowerCase().trim()));
  } catch (err) {
    console.error('Erro GTFS (paragens EMT Valência):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários da EMT Valência agora: ' + err.message });
  }
});
app.get('/api/transport/valencia/bus-departures', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('emt-valencia', resolveEmtValenciaGtfsUrl, 'EMT_VALENCIA_GTFS_URL');
    const result = gtfsNextDepartures(gtfs, req.query.stationId, 'Europe/Madrid');
    if (!result) return res.status(400).json({ error: 'Paragem inválida.' });
    res.json(result);
  } catch (err) {
    console.error('Erro GTFS (partidas EMT Valência):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários da EMT Valência agora: ' + err.message });
  }
});
app.get('/api/transport/valencia/rail-stops', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('metro-valencia', resolveMetroValenciaGtfsUrl, 'METRO_VALENCIA_GTFS_URL');
    res.json(gtfsSearchStops(gtfs, (req.query.q || '').toLowerCase().trim()));
  } catch (err) {
    console.error('Erro GTFS (estações Metrovalencia):', err.message);
    res.status(503).json({ error: 'Não foi possível obter as estações do Metrovalencia agora: ' + err.message });
  }
});
app.get('/api/transport/valencia/rail-departures', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('metro-valencia', resolveMetroValenciaGtfsUrl, 'METRO_VALENCIA_GTFS_URL');
    const result = gtfsNextDepartures(gtfs, req.query.stationId, 'Europe/Madrid');
    if (!result) return res.status(400).json({ error: 'Estação inválida.' });
    res.json(result);
  } catch (err) {
    console.error('Erro GTFS (partidas Metrovalencia):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários do Metrovalencia agora: ' + err.message });
  }
});
// Endpoint de diagnóstico temporário — a investigar porque é que NENHUMA
// estação do Metrovalencia mostra partidas ("sem mais partidas hoje" em
// todas), depois de confirmado que a Mobility Database já está configurada e
// a devolver estações reais. Mostra o URL realmente usado e um resumo do
// calendário do feed (datas de validade, quantos serviços têm exceções vs.
// calendário semanal) — o suficiente para perceber se o feed está mesmo
// desatualizado (calendário já expirado) ou se é outra coisa. Remover depois
// de resolvido.
app.get('/api/transport/valencia/metro-debug', async (req, res) => {
  try {
    const url = await resolveMetroValenciaGtfsUrl();
    const gtfs = await ensureGtfsFeedLoaded('metro-valencia', resolveMetroValenciaGtfsUrl, 'METRO_VALENCIA_GTFS_URL');
    const now = nowInTimeZone('Europe/Madrid');
    const todayStr = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    const calendars = [...gtfs.calendar.entries()];
    const serviceIdsWithOnlyExceptions = [...gtfs.calendarExceptions.keys()].filter((id) => !gtfs.calendar.has(id));
    let activeToday = 0;
    let totalServices = new Set([...gtfs.calendar.keys(), ...gtfs.calendarExceptions.keys()]).size;
    for (const serviceId of new Set([...gtfs.calendar.keys(), ...gtfs.calendarExceptions.keys()])) {
      if (isServiceActiveOnDate(gtfs, serviceId, now)) activeToday++;
    }
    res.json({
      resolvedUrl: url,
      hoje: todayStr,
      totalStops: gtfs.stops.size,
      totalTrips: gtfs.trips.size,
      totalServices,
      servicesAtivosHoje: activeToday,
      totalCalendarEntries: calendars.length,
      amostraCalendar: calendars.slice(0, 5).map(([id, c]) => ({ serviceId: id, start: c.start, end: c.end, days: c.days })),
      totalCalendarDateExceptions: [...gtfs.calendarExceptions.values()].reduce((s, m) => s + m.size, 0),
      servicesSoComExcecoes: serviceIdsWithOnlyExceptions.length
    });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// ==================== RENFE (nacional) — Cercanías/Rodalies + AVE/Larga Distância ====================
// Terceira e última expansão para Espanha pedida pelo utilizador. Ao contrário de
// Madrid/Valência (redes de uma cidade), a Renfe é nacional — por isso entra como
// mais uma opção no mesmo alternador "Portugal/Madrid/Valência" da aba Metro/Comboio,
// não como uma cidade própria. As duas fontes vêm do portal de dados abertos da
// própria Renfe (data.renfe.com), que é CKAN — o mesmo tipo de plataforma já usado
// para a GIRA. Tal como na GIRA, resolvemos o URL do recurso via "package_show" em
// vez de apontar direto para um link de recurso (UUID que muda se o dataset for
// republicado); o "dataset ID" do pedido inicial ("horarios-viaje-...") estava
// desatualizado — confirmámos por pesquisa o slug atual de cada dataset.
const RENFE_CKAN_BASE = process.env.RENFE_CKAN_BASE || 'https://data.renfe.com';
const RENFE_CERCANIAS_DATASET_ID = process.env.RENFE_CERCANIAS_DATASET_ID || 'horarios-cercanias';
const RENFE_AVE_DATASET_ID = process.env.RENFE_AVE_DATASET_ID || 'horarios-de-alta-velocidad-larga-distancia-y-media-distancia';
const renfeResourceUrlCache = new Map(); // datasetId -> { t, url }
async function resolveRenfeResourceUrl(datasetId) {
  const now = Date.now();
  const cached = renfeResourceUrlCache.get(datasetId);
  if (cached && (now - cached.t) < 24 * 60 * 60 * 1000) return cached.url;
  const data = await cachedFetch(`renfe_package_${datasetId}`, `${RENFE_CKAN_BASE}/api/3/action/package_show?id=${datasetId}`, 24 * 60 * 60 * 1000, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' }
  });
  const resources = data?.result?.resources || [];
  const resource = resources.find((r) => /\.zip$/i.test(r.url || '') || (r.format || '').toLowerCase().includes('gtfs')) || resources[0];
  if (!resource?.url) throw new Error(`O dataset "${datasetId}" da Renfe não tem nenhum recurso descarregável.`);
  renfeResourceUrlCache.set(datasetId, { t: now, url: resource.url });
  return resource.url;
}
const RENFE_RAIL_FEEDS = {
  cercanias: { key: 'renfe-cercanias', resolve: () => resolveRenfeResourceUrl(RENFE_CERCANIAS_DATASET_ID), envVar: 'RENFE_CERCANIAS_DATASET_ID', label: 'Cercanías/Rodalies' },
  ave: { key: 'renfe-ave', resolve: () => resolveRenfeResourceUrl(RENFE_AVE_DATASET_ID), envVar: 'RENFE_AVE_DATASET_ID', label: 'AVE/Larga Distância' }
};
app.get('/api/transport/renfe/rail-stops', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const loaded = await Promise.all(Object.entries(RENFE_RAIL_FEEDS).map(([type, f]) =>
    ensureGtfsFeedLoaded(f.key, f.resolve, f.envVar)
      .then((gtfs) => ({ type, label: f.label, gtfs }))
      .catch((err) => { console.error(`Erro GTFS (${f.label} Renfe):`, err.message); return null; })
  ));
  const active = loaded.filter(Boolean);
  if (!active.length) return res.status(503).json({ error: 'Não foi possível obter as estações da Renfe agora.' });
  const results = [];
  active.forEach(({ type, label, gtfs }) => gtfsSearchStops(gtfs, q).forEach((s) => results.push({ ...s, type, operatorName: label })));
  res.json(results.slice(0, 30));
});
app.get('/api/transport/renfe/rail-departures', async (req, res) => {
  const feed = RENFE_RAIL_FEEDS[req.query.type];
  if (!feed) return res.status(400).json({ error: 'Tipo de rede inválido.' });
  try {
    const gtfs = await ensureGtfsFeedLoaded(feed.key, feed.resolve, feed.envVar);
    const result = gtfsNextDepartures(gtfs, req.query.stationId, 'Europe/Madrid');
    if (!result) return res.status(400).json({ error: 'Estação inválida.' });
    res.json(result);
  } catch (err) {
    console.error(`Erro GTFS (partidas ${feed.label} Renfe):`, err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários da Renfe agora: ' + err.message });
  }
});

// ==================== FRANÇA (SNCF Transilien — Paris/Île-de-França) ====================
// O feed nacional da SNCF (TER + Intercités + TGV, todo o país, janela rolante de
// ~150 dias) é enorme — dezenas/centenas de MB, pesado demais só para uma
// funcionalidade secundária de horários no meio de uma app de chat. Em vez disso,
// arrancamos com a Transilien (comboios suburbanos de Paris/Île-de-França: ~342
// estações, 28 linhas), um recorte MUITO mais leve do mesmo país, tal como Fertagus
// é um recorte leve para a área de Lisboa. Configurável por FRANCE_GTFS_URL se
// preferires apontar para outra rede (ex.: um TER regional específico do portal
// transport.data.gouv.fr) — o motor GTFS é o mesmo para qualquer feed válido.
const FRANCE_GTFS_URL_DEFAULT = 'https://eu.ftp.opendatasoft.com/sncf/gtfs/transilien-gtfs.zip';
async function resolveFranceGtfsUrl() {
  return process.env.FRANCE_GTFS_URL || FRANCE_GTFS_URL_DEFAULT;
}
app.get('/api/transport/france/rail-stops', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('france', resolveFranceGtfsUrl, 'FRANCE_GTFS_URL');
    res.json(gtfsSearchStops(gtfs, (req.query.q || '').toLowerCase().trim()));
  } catch (err) {
    console.error('Erro GTFS (estações França):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários de França agora: ' + err.message });
  }
});
app.get('/api/transport/france/rail-departures', async (req, res) => {
  try {
    const gtfs = await ensureGtfsFeedLoaded('france', resolveFranceGtfsUrl, 'FRANCE_GTFS_URL');
    const result = gtfsNextDepartures(gtfs, req.query.stationId, 'Europe/Paris');
    if (!result) return res.status(400).json({ error: 'Estação inválida.' });
    res.json(result);
  } catch (err) {
    console.error('Erro GTFS (partidas França):', err.message);
    res.status(503).json({ error: 'Não foi possível obter os horários de França agora: ' + err.message });
  }
});

// Estado do serviço do Metro de Lisboa — a API oficial (api.metrolisboa.pt) bloqueia
// ligações vindas de servidores na nuvem (confirmado: a ligação é rejeitada mesmo com
// credenciais corretas, tanto em desenvolvimento como no Railway). Em alternativa, usamos
// a API pública e gratuita da UnderLX (https://perturbacoes.pt), um projeto da comunidade
// que trata precisamente das perturbações do Metro de Lisboa (oficiais + reportadas pelos
// utilizadores) — sem necessidade de registo nem chave.
const UNDERLX_API_BASE = 'https://api.underlx.com/v1';
app.get('/api/metro/status', async (req, res) => {
  try {
    const [linesResp, disturbancesResp] = await Promise.all([
      fetch(`${UNDERLX_API_BASE}/lines`, { headers: { 'Accept': 'application/json' } }),
      fetch(`${UNDERLX_API_BASE}/disturbances?filter=ongoing`, { headers: { 'Accept': 'application/json' } })
    ]);
    if (!linesResp.ok) throw new Error(`HTTP ${linesResp.status} ao obter as linhas`);
    if (!disturbancesResp.ok) throw new Error(`HTTP ${disturbancesResp.status} ao obter as perturbações`);
    const lines = await linesResp.json();
    const disturbances = await disturbancesResp.json();
    const descriptionsByLine = new Map();
    (disturbances || []).forEach((d) => {
      if (!descriptionsByLine.has(d.line)) descriptionsByLine.set(d.line, []);
      descriptionsByLine.get(d.line).push(d.description || d.notes || 'Perturbação em curso');
    });
    const result = (lines || []).map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      status: descriptionsByLine.has(l.id) ? descriptionsByLine.get(l.id).join('; ') : 'Serviço normal'
    }));
    res.json({ lines: result });
  } catch (err) {
    console.error('Erro estado Metro Lisboa (UnderLX):', err.message);
    res.status(503).json({ error: 'Não foi possível obter o estado do Metro de Lisboa agora: ' + err.message });
  }
});

// Aviões em tempo real — OpenSky Network, gratuita, sem chave. O uso anónimo
// (sem conta) tem uma cota diária baixa (~400 "créditos"/dia) e cada pedido
// SEM caixa delimitadora (mundo inteiro) custa 4 créditos, contra 1 crédito
// para uma área pequena — ou seja, esgota a cota rapidamente se pedires o
// mundo inteiro a cada poucos segundos. Por isso: o cliente pode mandar
// lamin/lomin/lamax/lomax (a área do mapa que está a ver) e só cai para
// "mundo inteiro" se não mandar nada — e mesmo assim a cache de 15s é
// partilhada por todos os utilizadores, para poupar a cota o máximo possível.
app.get('/api/transport/flights', async (req, res) => {
  try {
    const { lamin, lomin, lamax, lomax } = req.query;
    const hasBox = lamin && lomin && lamax && lomax;
    const bbox = hasBox ? `lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}` : '';
    const cacheKey = hasBox ? `flights_${lamin}_${lomin}_${lamax}_${lomax}` : 'flights_world';
    const data = await cachedFetch(cacheKey, `https://opensky-network.org/api/states/all${bbox ? '?' + bbox : ''}`, 15000);
    res.json(data);
  } catch (err) {
    console.error('Erro voos:', err.message);
    res.status(502).json({ error: 'Não foi possível obter os voos agora (o serviço gratuito tem uma cota diária baixa — pode ter esgotado por hoje).' });
  }
});

// ==================== PREÇOS DE COMBOIO/AUTOCARRO NA EUROPA (Tictactrip) ====================
// Pesquisa de preços por rota+data (ao contrário do rastreamento ao vivo e dos
// horários GTFS acima) exige uma fonte comercial de tarifas. A Amadeus for
// Developers (voos) foi descontinuada para novos registos em 2025 — o programa
// self-service redireciona agora só para um portal "Enterprise" (confirmámos
// isto ao vivo, já não é possível criar conta). A Tictactrip (developers.tictactrip.eu)
// é uma alternativa real e documentada, mas só cobre comboio+autocarro na
// Europa (sem voos) — junta mais de 250 transportadoras (Flixbus, OUIGO, etc.).
// A autenticação não é self-service instantânea: pede-se um token por email a
// dev@tictactrip.eu. Sem TICTACTRIP_API_TOKEN configurado, os endpoints
// respondem "configured: false" e o cliente mostra um aviso a pedir
// configuração, em vez de rebentar.
const TICTACTRIP_API_BASE = process.env.TICTACTRIP_API_BASE || 'https://api.tictactrip.eu';
const TICTACTRIP_CONFIGURED = () => !!process.env.TICTACTRIP_API_TOKEN;

app.get('/api/transport/trip-search/stops', async (req, res) => {
  if (!TICTACTRIP_CONFIGURED()) return res.json({ configured: false, results: [] });
  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ configured: true, results: [] });
  try {
    // A própria documentação da Tictactrip pede para NÃO ir buscar isto em
    // tempo real a cada pesquisa (atualiza-se só de 1 em 1 ou 2 em 2 meses) —
    // por isso cache de 7 dias, e a pesquisa por nome é feita aqui em memória.
    const data = await cachedFetch('tictactrip_stopclusters', `${TICTACTRIP_API_BASE}/v2/stopClusters`, 7 * 24 * 60 * 60 * 1000, {
      headers: { Authorization: `Bearer ${process.env.TICTACTRIP_API_TOKEN}` }
    });
    const results = (Array.isArray(data) ? data : [])
      .filter((c) => (c.name || '').toLowerCase().includes(q) || (c.city || '').toLowerCase().includes(q))
      .slice(0, 20)
      .map((c) => ({ id: c.id, name: c.name, city: c.city, country: c.country, transportTypes: c.transportTypes || [] }));
    res.json({ configured: true, results });
  } catch (err) {
    console.error('Erro Tictactrip (paragens):', err.message);
    res.status(502).json({ error: 'Não foi possível pesquisar cidades/estações agora: ' + err.message });
  }
});

const tictactripOffersCache = {};
async function searchTictactripOffers(originGpuid, destinationGpuid, date, returnDate) {
  const cacheKey = `${originGpuid}_${destinationGpuid}_${date}_${returnDate || ''}`;
  const now = Date.now();
  if (tictactripOffersCache[cacheKey] && (now - tictactripOffersCache[cacheKey].t) < 10 * 60 * 1000) {
    return tictactripOffersCache[cacheKey].data;
  }
  const body = {
    originGpuid,
    destinationGpuid,
    outboundDate: `${date}T00:00:00Z`,
    passengers: [{ age: 30 }]
  };
  if (returnDate) body.returnDate = `${returnDate}T00:00:00Z`;
  const resp = await fetch(`${TICTACTRIP_API_BASE}/v2/results`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.TICTACTRIP_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const respBody = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}${respBody ? ' — ' + respBody.slice(0, 200) : ''}`);
  }
  const data = await resp.json();
  const trips = Object.values(data.trips || {});
  const offers = trips.map((trip) => ({
    priceEur: trip.priceCents != null ? (trip.priceCents / 100).toFixed(2) : null,
    transportType: (trip.transportType || '').toLowerCase(),
    providers: (trip.providers || []).map((p) => p.name).join(', '),
    durationMinutes: trip.durationMinutes,
    departure: trip.departureLocalISO,
    arrival: trip.arrivalLocalISO,
    stops: Math.max(0, (trip.segments || []).length - 1),
    co2g: trip.segments?.reduce((sum, s) => sum + (s.co2g || 0), 0) || null,
    direction: trip.direction === 'inboundTrip' ? 'inbound' : 'outbound'
  })).sort((a, b) => (parseFloat(a.priceEur) || Infinity) - (parseFloat(b.priceEur) || Infinity));
  tictactripOffersCache[cacheKey] = { t: now, data: offers };
  return offers;
}
app.get('/api/transport/trip-search/offers', async (req, res) => {
  if (!TICTACTRIP_CONFIGURED()) return res.json({ configured: false, offers: [] });
  const origin = (req.query.origin || '').trim();
  const destination = (req.query.destination || '').trim();
  const date = (req.query.date || '').trim();
  const returnDate = (req.query.returnDate || '').trim();
  if (!origin || !destination) return res.status(400).json({ error: 'Escolhe uma cidade/estação de origem e destino a partir da lista de pesquisa.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Indica uma data de partida válida.' });
  if (returnDate && !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) return res.status(400).json({ error: 'Data de volta inválida.' });
  if (returnDate && returnDate < date) return res.status(400).json({ error: 'A data de volta não pode ser antes da data de ida.' });
  try {
    const offers = await searchTictactripOffers(origin, destination, date, returnDate);
    res.json({ configured: true, offers });
  } catch (err) {
    console.error('Erro Tictactrip (pesquisa de viagens):', err.message);
    res.status(502).json({ error: 'Não foi possível pesquisar viagens agora: ' + err.message });
  }
});

// ==================== PREÇOS DE VOOS (Ignav) ====================
// A Amadeus (GDS oficial usado por agências de viagens) fechou o self-service
// gratuito a 17 de julho de 2026 — confirmámos isto ao vivo (o registo passou
// a exigir um contrato "Enterprise"). A Ignav posiciona-se especificamente
// como alternativa self-serve para quem ficou sem essa opção. Nunca processa
// pagamento: só devolve preços e um link de reserva para a companhia/OTA.
const IGNAV_API_BASE = process.env.IGNAV_API_BASE || 'https://ignav.com/api';
const IGNAV_CONFIGURED = () => !!process.env.IGNAV_API_KEY;

function summarizeIgnavLeg(leg) {
  const segments = leg?.segments || [];
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first) return null;
  return {
    airline: leg?.carrier || first?.operating_carrier_name || '',
    departure: first?.departure_time_local,
    arrival: last?.arrival_time_local,
    stops: Math.max(0, segments.length - 1)
  };
}
const ignavOffersCache = {};
async function fetchIgnavOffers(origin, destination, date, returnDate) {
  const cacheKey = `${origin}_${destination}_${date}_${returnDate || ''}`;
  const now = Date.now();
  if (ignavOffersCache[cacheKey] && (now - ignavOffersCache[cacheKey].t) < 10 * 60 * 1000) {
    return ignavOffersCache[cacheKey].data;
  }
  const endpoint = returnDate ? 'round-trip' : 'one-way';
  const body = returnDate
    ? { origin, destination, departure_date: date, return_date: returnDate }
    : { origin, destination, departure_date: date };
  const resp = await fetch(`${IGNAV_API_BASE}/fares/${endpoint}`, {
    method: 'POST',
    headers: { 'X-Api-Key': process.env.IGNAV_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const respBody = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}${respBody ? ' — ' + respBody.slice(0, 200) : ''}`);
  }
  const data = await resp.json();
  const offers = (data.itineraries || []).map((it) => ({
    price: it.price?.amount,
    currency: it.price?.currency,
    outbound: summarizeIgnavLeg(it.outbound),
    inbound: summarizeIgnavLeg(it.inbound),
    ignavId: it.ignav_id
  })).sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  ignavOffersCache[cacheKey] = { t: now, data: offers };
  return offers;
}

// ==================== HISTÓRICO/ESTATÍSTICAS DE PESQUISAS DE VOOS ====================
// Guarda cada pesquisa de voo bem-sucedida (com sessão válida) para depois
// mostrar um resumo tipo "quantas vezes pesquisei, qual a rota mais
// pesquisada, o preço mais baixo que já vi". Mesmo padrão de ficheiro local
// já usado para lembretes/mensagens agendadas — nada de novo a aprender.
const TRAVEL_HISTORY_FILE = path.join(__dirname, 'travel-history.json');
let travelHistoryByPhone = {}; // phone -> [{origin, destination, date, cheapestPrice, currency, isRoundTrip, searchedAt}]
function loadTravelHistoryLocal() {
  try { if (fs.existsSync(TRAVEL_HISTORY_FILE)) travelHistoryByPhone = JSON.parse(fs.readFileSync(TRAVEL_HISTORY_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar histórico de viagens:', err.message); }
}
function saveTravelHistoryLocal() {
  fs.writeFile(TRAVEL_HISTORY_FILE, JSON.stringify(travelHistoryByPhone), (err) => { if (err) console.error('Erro ao salvar histórico de viagens:', err.message); });
}
function logFlightSearch(phone, entry) {
  if (!phone) return;
  if (!travelHistoryByPhone[phone]) travelHistoryByPhone[phone] = [];
  travelHistoryByPhone[phone].push({ ...entry, searchedAt: Date.now() });
  if (travelHistoryByPhone[phone].length > 100) travelHistoryByPhone[phone] = travelHistoryByPhone[phone].slice(-100);
  saveTravelHistoryLocal();
}

app.get('/api/transport/flight-price/offers', async (req, res) => {
  if (!IGNAV_CONFIGURED()) return res.json({ configured: false, offers: [] });
  const origin = (req.query.origin || '').trim().toUpperCase();
  const destination = (req.query.destination || '').trim().toUpperCase();
  const date = (req.query.date || '').trim();
  const returnDate = (req.query.returnDate || '').trim();
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
    return res.status(400).json({ error: 'Indica códigos IATA de origem e destino válidos (3 letras).' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Indica uma data de partida válida.' });
  if (returnDate && !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) return res.status(400).json({ error: 'Data de volta inválida.' });
  if (returnDate && returnDate < date) return res.status(400).json({ error: 'A data de volta não pode ser antes da data de ida.' });
  try {
    const offers = await fetchIgnavOffers(origin, destination, date, returnDate);
    const phone = sessions[req.query.token];
    if (phone && offers.length) {
      // Distância/CO2 só dá para calcular quando ambos os códigos são das
      // cidades conhecidas do planeador (têm lat/lon) — pesquisas para
      // outros códigos IATA ficam sem esse dado, sem rebentar o resto.
      const originCity = PLANNER_CITIES[origin];
      const destCity = PLANNER_CITIES[destination];
      const distanceKm = (originCity && destCity) ? Math.round(haversineKm(originCity.lat, originCity.lon, destCity.lat, destCity.lon)) : null;
      const co2Kg = distanceKm != null ? Math.round(distanceKm * FLIGHT_CO2_G_PER_KM) / 1000 : null;
      logFlightSearch(phone, { origin, destination, date, cheapestPrice: offers[0].price, currency: offers[0].currency, isRoundTrip: !!returnDate, distanceKm, co2Kg });
    }
    res.json({ configured: true, offers });
  } catch (err) {
    console.error('Erro Ignav (pesquisa de voos):', err.message);
    res.status(502).json({ error: 'Não foi possível pesquisar voos agora: ' + err.message });
  }
});

app.get('/api/travel-stats', (req, res) => {
  const phone = sessions[req.query.token];
  if (!phone) return res.status(401).json({ error: 'Sessão inválida.' });
  const history = travelHistoryByPhone[phone] || [];
  if (!history.length) return res.json({ totalSearches: 0, cheapestFound: null, mostSearchedRoute: null, recentSearches: [] });
  const cheapestFound = history.reduce((min, h) => (h.cheapestPrice != null && (!min || h.cheapestPrice < min.cheapestPrice) ? h : min), null);
  const routeCounts = {};
  history.forEach((h) => {
    const key = `${h.origin} → ${h.destination}`;
    routeCounts[key] = (routeCounts[key] || 0) + 1;
  });
  const mostSearchedRoute = Object.entries(routeCounts).sort((a, b) => b[1] - a[1])[0];
  // Distância/CO2 só existem em pesquisas feitas depois desta funcionalidade
  // ter sido adicionada (pesquisas antigas não têm estes campos, contam como
  // 0 em vez de rebentar a soma) — por isso o total pode não refletir TODO o
  // histórico, só o que foi pesquisado a partir de agora.
  const totalDistanceKm = Math.round(history.reduce((sum, h) => sum + (h.distanceKm || 0), 0));
  const totalCo2Kg = Math.round(history.reduce((sum, h) => sum + (h.co2Kg || 0), 0) * 10) / 10;
  const EARTH_CIRCUMFERENCE_KM = 40075;
  const earthCircumferencePercent = totalDistanceKm > 0 ? Math.round((totalDistanceKm / EARTH_CIRCUMFERENCE_KM) * 1000) / 10 : 0;
  res.json({
    totalSearches: history.length,
    cheapestFound,
    mostSearchedRoute: mostSearchedRoute ? { route: mostSearchedRoute[0], count: mostSearchedRoute[1] } : null,
    totalDistanceKm,
    totalCo2Kg,
    earthCircumferencePercent,
    recentSearches: history.slice(-10).reverse()
  });
});

// Lista curada de destinos usada para "voos baratos" — a Ignav não tem um
// endpoint tipo "qualquer destino", só rota a rota, por isso pesquisamos
// esta lista fixa uma a uma (cada pesquisa gasta ~16 pedidos da cota
// gratuita da Ignav). Grandes cidades europeias + São Tomé e Príncipe
// (ligação relevante a partir de Portugal, fora da Europa).
const CHEAP_DEALS_DESTINATIONS = [
  { code: 'VLC', name: 'Valência' },
  { code: 'MAD', name: 'Madrid' },
  { code: 'BCN', name: 'Barcelona' },
  { code: 'LHR', name: 'Londres' },
  { code: 'CDG', name: 'Paris' },
  { code: 'FCO', name: 'Roma' },
  { code: 'MXP', name: 'Milão' },
  { code: 'AMS', name: 'Amesterdão' },
  { code: 'BRU', name: 'Bruxelas' },
  { code: 'BER', name: 'Berlim' },
  { code: 'MUC', name: 'Munique' },
  { code: 'ZRH', name: 'Zurique' },
  { code: 'VIE', name: 'Viena' },
  { code: 'ATH', name: 'Atenas' },
  { code: 'DUB', name: 'Dublin' },
  { code: 'TMS', name: 'São Tomé' }
];

app.get('/api/transport/flight-price/deals', async (req, res) => {
  if (!IGNAV_CONFIGURED()) return res.json({ configured: false, deals: [] });
  const origin = (req.query.origin || '').trim().toUpperCase();
  const date = (req.query.date || '').trim();
  if (!/^[A-Z]{3}$/.test(origin)) return res.status(400).json({ error: 'Indica um código IATA de origem válido (3 letras).' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Indica uma data de partida válida.' });
  const destinations = CHEAP_DEALS_DESTINATIONS.filter((d) => d.code !== origin);
  const results = await Promise.allSettled(destinations.map((d) => fetchIgnavOffers(origin, d.code, date)));
  const deals = destinations.map((d, i) => {
    if (results[i].status !== 'fulfilled' || !results[i].value.length) return null;
    const cheapest = results[i].value[0];
    return {
      destinationCode: d.code,
      destinationName: d.name,
      price: cheapest.price,
      currency: cheapest.currency,
      airline: cheapest.outbound?.airline || '',
      departure: cheapest.outbound?.departure,
      stops: cheapest.outbound?.stops ?? 0,
      ignavId: cheapest.ignavId
    };
  }).filter(Boolean).sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  res.json({ configured: true, deals });
});

app.get('/api/transport/flight-price/booking-link', async (req, res) => {
  if (!IGNAV_CONFIGURED()) return res.json({ configured: false, url: null });
  const ignavId = (req.query.ignavId || '').trim();
  if (!ignavId) return res.status(400).json({ error: 'Falta o identificador do voo.' });
  try {
    const resp = await fetch(`${IGNAV_API_BASE}/fares/booking-links`, {
      method: 'POST',
      headers: { 'X-Api-Key': process.env.IGNAV_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ignav_id: ignavId })
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}${body ? ' — ' + body.slice(0, 200) : ''}`);
    }
    const data = await resp.json();
    const url = data.booking_options?.[0]?.links?.[0]?.url || null;
    res.json({ configured: true, url });
  } catch (err) {
    console.error('Erro Ignav (link de reserva):', err.message);
    res.status(502).json({ error: 'Não foi possível obter o link de reserva agora: ' + err.message });
  }
});

// ==================== PLANEADOR DE VIAGENS MULTIMODAL ====================
// Combina as três fontes de transporte já integradas (Ignav para voos,
// Tictactrip para comboio/autocarro na Europa, GTFS da CP para comboios
// diretos dentro de Portugal) numa comparação lado a lado por preço,
// duração, número de escalas e pegada de CO2.
//
// Limitação importante, por honestidade: isto NÃO é um planeador porta-a-porta
// de verdade. Cada opção mostrada é uma viagem de UM MODO só (voo, ou
// comboio/autocarro, ou comboio CP direto) — não juntamos pernas de
// transportadoras diferentes numa única viagem combinada (ex.: "voo até
// à cidade + metro até ao centro" com horários e preços reais encadeados),
// porque não temos dados fiáveis de ligação porta-a-porta entre o
// aeroporto e a rede de transporte local em cada cidade. Em vez de
// inventar essa ligação, a "recomendação" indica qual o modo geral mais
// vantajoso e, quando aplicável, uma nota informativa (estática, não
// calculada) sobre a ligação de transporte público conhecida a partir do
// aeroporto de chegada.
const PLANNER_CITIES = {
  LIS: { name: 'Lisboa', lat: 38.7813, lon: -9.1359, cpStation: 'Lisboa Oriente' },
  OPO: { name: 'Porto', lat: 41.2481, lon: -8.6814, cpStation: 'Porto Campanha', airportTransit: 'Aeroporto do Porto: estação "Aeroporto" da Linha E (violeta) do Metro do Porto, ligação direta ao centro.' },
  FAO: { name: 'Faro', lat: 37.0144, lon: -7.9364, cpStation: 'Faro' },
  VLC: { name: 'Valência', lat: 39.4893, lon: -0.3776 },
  MAD: { name: 'Madrid', lat: 40.4719, lon: -3.5626, airportTransit: 'Aeroporto de Madrid-Barajas: Linha 8 do Metro de Madrid liga direto ao centro.' },
  BCN: { name: 'Barcelona', lat: 41.2974, lon: 2.0833, airportTransit: 'Aeroporto de Barcelona: linha R2 Nord de Rodalies (comboio) liga direto ao centro.' },
  LHR: { name: 'Londres', lat: 51.4700, lon: -0.4543, airportTransit: 'Aeroporto de Heathrow: Piccadilly Line do Metro e Elizabeth Line ligam direto ao centro.' },
  CDG: { name: 'Paris', lat: 49.0097, lon: 2.5479, airportTransit: 'Aeroporto Charles de Gaulle: RER B liga direto ao centro.' },
  FCO: { name: 'Roma', lat: 41.8003, lon: 12.2389, airportTransit: 'Aeroporto de Fiumicino: comboio Leonardo Express liga direto à Estação Termini.' },
  MXP: { name: 'Milão', lat: 45.6306, lon: 8.7281 },
  AMS: { name: 'Amesterdão', lat: 52.3105, lon: 4.7683, airportTransit: 'Aeroporto de Schiphol: comboio direto à Estação Central de Amesterdão.' },
  BRU: { name: 'Bruxelas', lat: 50.9014, lon: 4.4844 },
  BER: { name: 'Berlim', lat: 52.3667, lon: 13.5033, airportTransit: 'Aeroporto de Berlim (BER): comboio direto à Berlin Hauptbahnhof.' },
  MUC: { name: 'Munique', lat: 48.3538, lon: 11.7861, airportTransit: 'Aeroporto de Munique: S-Bahn (S1/S8) liga direto ao centro.' },
  ZRH: { name: 'Zurique', lat: 47.4647, lon: 8.5492, airportTransit: 'Aeroporto de Zurique: comboio direto à Estação Central (Zürich HB).' },
  VIE: { name: 'Viena', lat: 48.1103, lon: 16.5697, airportTransit: 'Aeroporto de Viena: comboio CAT/S7 liga direto ao centro.' },
  ATH: { name: 'Atenas', lat: 37.9364, lon: 23.9445, airportTransit: 'Aeroporto de Atenas: Linha 3 do Metro liga direto ao centro.' },
  DUB: { name: 'Dublin', lat: 53.4264, lon: -6.2499 },
  TMS: { name: 'São Tomé', lat: 0.3782, lon: 6.7122 }
};
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Fatores de emissão aproximados por passageiro-km (ordem de grandeza usada
// por várias calculadoras públicas — não é uma pegada certificada, serve
// só para comparar visualmente as opções entre si).
const FLIGHT_CO2_G_PER_KM = 115;
const TRAIN_CO2_G_PER_KM = 35;

async function resolveTictactripCluster(cityName) {
  if (!TICTACTRIP_CONFIGURED()) return null;
  const data = await cachedFetch('tictactrip_stopclusters', `${TICTACTRIP_API_BASE}/v2/stopClusters`, 7 * 24 * 60 * 60 * 1000, {
    headers: { Authorization: `Bearer ${process.env.TICTACTRIP_API_TOKEN}` }
  });
  const list = Array.isArray(data) ? data : [];
  const q = cityName.toLowerCase();
  return list.find((c) => (c.name || '').toLowerCase() === q || (c.city || '').toLowerCase() === q)
    || list.find((c) => (c.name || '').toLowerCase().includes(q) || (c.city || '').toLowerCase().includes(q))
    || null;
}

function gtfsTimeToMinutes(t) {
  const [h, m] = (t || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
async function findDirectCpTrip(originStationName, destinationStationName, dateObj) {
  const gtfs = await ensureGtfsFeedLoaded('cp', resolveCpGtfsUrl, 'CP_GTFS_URL');
  const stopsList = [...gtfs.stops.values()];
  const originStop = stopsList.find((s) => s.name === originStationName) || stopsList.find((s) => s.name.includes(originStationName));
  const destStop = stopsList.find((s) => s.name === destinationStationName) || stopsList.find((s) => s.name.includes(destinationStationName));
  if (!originStop || !destStop) return null;
  const originTimes = gtfs.stopTimesByStop.get(originStop.id) || [];
  const destTimes = gtfs.stopTimesByStop.get(destStop.id) || [];
  const destByTrip = new Map(destTimes.map((t) => [t.tripId, t]));
  const candidates = [];
  for (const ot of originTimes) {
    const dt = destByTrip.get(ot.tripId);
    if (!dt) continue;
    // Comparação simples de string HH:MM:SS — não lida com viradas de meia-noite,
    // a mesma simplificação já assumida no resto do motor GTFS desta app.
    if (dt.arrival <= ot.departure) continue;
    const trip = gtfs.trips.get(ot.tripId);
    if (!trip || !isServiceActiveOnDate(gtfs, trip.serviceId, dateObj)) continue;
    const route = gtfs.routes.get(trip.routeId);
    const durationMin = gtfsTimeToMinutes(dt.arrival) - gtfsTimeToMinutes(ot.departure);
    if (durationMin == null || durationMin <= 0) continue;
    candidates.push({ departure: ot.departure, arrival: dt.arrival, durationMin, routeName: route?.longName || route?.shortName || 'CP' });
  }
  candidates.sort((a, b) => a.departure.localeCompare(b.departure));
  return candidates[0] || null;
}

app.get('/api/transport/planner', async (req, res) => {
  const origin = (req.query.origin || '').trim().toUpperCase();
  const destination = (req.query.destination || '').trim().toUpperCase();
  const date = (req.query.date || '').trim();
  if (!PLANNER_CITIES[origin] || !PLANNER_CITIES[destination]) return res.status(400).json({ error: 'Escolhe uma origem e um destino válidos da lista.' });
  if (origin === destination) return res.status(400).json({ error: 'A origem e o destino não podem ser os mesmos.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Indica uma data de viagem válida.' });
  const originCity = PLANNER_CITIES[origin];
  const destCity = PLANNER_CITIES[destination];
  const distanceKm = Math.round(haversineKm(originCity.lat, originCity.lon, destCity.lat, destCity.lon));
  const dateObj = new Date(date + 'T12:00:00');

  const options = [];

  if (IGNAV_CONFIGURED()) {
    try {
      const offers = await fetchIgnavOffers(origin, destination, date);
      const best = offers[0];
      if (best) {
        options.push({
          mode: 'flight',
          label: '✈️ Avião',
          provider: 'Ignav',
          price: best.price,
          currency: best.currency || 'EUR',
          durationMin: null,
          stops: best.outbound?.stops ?? null,
          co2Kg: Math.round(distanceKm * FLIGHT_CO2_G_PER_KM) / 1000,
          co2Estimated: true,
          extra: { airline: best.outbound?.airline || '' }
        });
      }
    } catch (err) {
      console.error('Erro no planeador (Ignav):', err.message);
    }
  }

  if (TICTACTRIP_CONFIGURED()) {
    try {
      const [originCluster, destCluster] = await Promise.all([resolveTictactripCluster(originCity.name), resolveTictactripCluster(destCity.name)]);
      if (originCluster && destCluster) {
        const offers = await searchTictactripOffers(originCluster.id, destCluster.id, date);
        const best = offers.find((o) => o.direction === 'outbound');
        if (best) {
          options.push({
            mode: 'train_bus',
            label: '🚆🚌 Comboio/Autocarro',
            provider: 'Tictactrip',
            price: best.priceEur != null ? parseFloat(best.priceEur) : null,
            currency: 'EUR',
            durationMin: best.durationMinutes ?? null,
            stops: best.stops ?? null,
            co2Kg: best.co2g != null ? Math.round(best.co2g) / 1000 : Math.round(distanceKm * TRAIN_CO2_G_PER_KM) / 1000,
            co2Estimated: best.co2g == null,
            extra: { providers: best.providers || '' }
          });
        }
      }
    } catch (err) {
      console.error('Erro no planeador (Tictactrip):', err.message);
    }
  }

  if (originCity.cpStation && destCity.cpStation) {
    try {
      const direct = await findDirectCpTrip(originCity.cpStation, destCity.cpStation, dateObj);
      if (direct) {
        options.push({
          mode: 'cp_direct',
          label: '🚄 Comboio direto (CP)',
          provider: 'CP (GTFS)',
          price: null,
          currency: null,
          durationMin: direct.durationMin,
          stops: 0,
          co2Kg: Math.round(distanceKm * TRAIN_CO2_G_PER_KM) / 1000,
          co2Estimated: true,
          extra: { departure: direct.departure, arrival: direct.arrival, routeName: direct.routeName, priceNote: 'Preço não disponível via GTFS — consulta a CP diretamente.' }
        });
      }
    } catch (err) {
      console.error('Erro no planeador (CP GTFS):', err.message);
    }
  }

  // Recomendação: normaliza preço/duração/CO2 (0-1, menor é melhor) entre as
  // opções que têm essa informação, e soma com peso igual. Sem preço/duração
  // disponíveis para comparar, cai para a opção mais barata ou a primeira.
  let recommendation = null;
  if (options.length) {
    const withPrice = options.filter((o) => o.price != null);
    const withDuration = options.filter((o) => o.durationMin != null);
    const minMax = (arr, key) => {
      const vals = arr.map((o) => o[key]);
      return { min: Math.min(...vals), max: Math.max(...vals) };
    };
    const priceRange = withPrice.length ? minMax(withPrice, 'price') : null;
    const durationRange = withDuration.length ? minMax(withDuration, 'durationMin') : null;
    const co2Range = minMax(options, 'co2Kg');
    const norm = (val, range) => (!range || range.max === range.min) ? 0.5 : (val - range.min) / (range.max - range.min);
    let best = null;
    let bestScore = Infinity;
    for (const o of options) {
      const parts = [norm(o.co2Kg, co2Range)];
      if (o.price != null && priceRange) parts.push(norm(o.price, priceRange));
      if (o.durationMin != null && durationRange) parts.push(norm(o.durationMin, durationRange));
      const score = parts.reduce((a, b) => a + b, 0) / parts.length;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    recommendation = {
      mode: best.mode,
      label: best.label,
      tip: best.mode === 'flight' ? (destCity.airportTransit || null) : null
    };
  }

  res.json({
    origin, originName: originCity.name,
    destination, destinationName: destCity.name,
    distanceKm,
    options,
    recommendation
  });
});

// ==================== ALERTAS DE PREÇO DE VOOS (Ignav) ====================
// Uma rota+data+preço-alvo por alerta. Verificado periodicamente (ver
// setInterval mais abaixo); ao disparar, manda notificação push e remove-se
// (não continua a repetir o aviso). Limite por utilizador para não esgotar
// a cota gratuita da Ignav com demasiados alertas.
const PRICE_ALERTS_FILE = path.join(__dirname, 'price-alerts.json');
let priceAlerts = []; // [{id, phone, origin, originName, destination, destinationName, date, maxPrice, createdAt}]
function loadPriceAlertsLocal() {
  try { if (fs.existsSync(PRICE_ALERTS_FILE)) priceAlerts = JSON.parse(fs.readFileSync(PRICE_ALERTS_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar alertas de preço:', err.message); }
}
function savePriceAlertsLocal() {
  fs.writeFile(PRICE_ALERTS_FILE, JSON.stringify(priceAlerts), (err) => { if (err) console.error('Erro ao salvar alertas de preço:', err.message); });
}
const MAX_PRICE_ALERTS_PER_USER = 5;

app.post('/api/price-alerts', (req, res) => {
  const { token, origin, originName, destination, destinationName, date, maxPrice } = req.body || {};
  const phone = sessions[token];
  if (!phone || !accounts[phone]) return res.status(401).json({ error: 'Sessão inválida.' });
  const originCode = (origin || '').trim().toUpperCase();
  const destinationCode = (destination || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(originCode) || !/^[A-Z]{3}$/.test(destinationCode)) {
    return res.status(400).json({ error: 'Indica códigos IATA de origem e destino válidos.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Indica uma data válida.' });
  const price = Number(maxPrice);
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Indica um preço-alvo válido.' });
  if (priceAlerts.filter((a) => a.phone === phone).length >= MAX_PRICE_ALERTS_PER_USER) {
    return res.status(400).json({ error: `Já tens o máximo de ${MAX_PRICE_ALERTS_PER_USER} alertas ativos — apaga um antes de criar outro.` });
  }
  const alert = {
    id: 'pa' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    phone,
    origin: originCode, originName: originName || originCode,
    destination: destinationCode, destinationName: destinationName || destinationCode,
    date, maxPrice: price, createdAt: Date.now()
  };
  priceAlerts.push(alert);
  savePriceAlertsLocal();
  res.json({ success: true, alert });
});

app.get('/api/price-alerts', (req, res) => {
  const phone = sessions[req.query.token];
  if (!phone) return res.status(401).json({ error: 'Sessão inválida.' });
  res.json({ alerts: priceAlerts.filter((a) => a.phone === phone) });
});

app.delete('/api/price-alerts/:id', (req, res) => {
  const phone = sessions[req.query.token];
  if (!phone) return res.status(401).json({ error: 'Sessão inválida.' });
  const before = priceAlerts.length;
  priceAlerts = priceAlerts.filter((a) => !(a.id === req.params.id && a.phone === phone));
  if (priceAlerts.length !== before) savePriceAlertsLocal();
  res.json({ success: true });
});

async function checkPriceAlerts() {
  if (!IGNAV_CONFIGURED() || !priceAlerts.length) return;
  const stillActive = [];
  for (const alert of priceAlerts) {
    let fired = false;
    try {
      const offers = await fetchIgnavOffers(alert.origin, alert.destination, alert.date);
      const cheapest = offers[0];
      if (cheapest && cheapest.price != null && cheapest.price <= alert.maxPrice) {
        await sendPushToPhone(alert.phone, {
          title: '🎫 Alerta de preço!',
          body: `${alert.originName} → ${alert.destinationName}: ${cheapest.price} ${cheapest.currency || 'EUR'} (alvo: ${alert.maxPrice})`
        });
        fired = true;
      }
    } catch (err) {
      console.error('Erro ao verificar alerta de preço:', err.message);
    }
    if (!fired) stillActive.push(alert);
  }
  if (stillActive.length !== priceAlerts.length) {
    priceAlerts = stillActive;
    savePriceAlertsLocal();
  }
}

// ==================== EVENTOS CULTURAIS (Agenda Cultural de Lisboa) ====================
// API oficial, aberta e gratuita da Câmara Municipal de Lisboa — sem chave,
// sem registo. Só cobre eventos em Lisboa; não encontrámos equivalente
// confirmado para o Porto ou outras cidades.
function normalizeAgendalxCategories(raw) {
  if (Array.isArray(raw)) return raw.map((c) => (c && typeof c === 'object' ? c.name : c)).filter(Boolean);
  if (raw && typeof raw === 'object') return Object.values(raw).map((c) => (c && typeof c === 'object' ? c.name : c)).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
function agendalxText(val) {
  // Campos de texto desta API aparecem em três formas diferentes consoante
  // o campo: objeto {rendered}, string simples, ou lista de parágrafos
  // (confirmado num evento real: title vem como {rendered}, subtitle e
  // description vêm como array de strings).
  let raw;
  if (Array.isArray(val)) raw = val.join(' ');
  else if (val && typeof val === 'object') raw = val.rendered || '';
  else raw = val || '';
  return String(raw).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
app.get('/api/culture/events', async (req, res) => {
  try {
    const url = process.env.AGENDALX_EVENTS_URL || 'https://www.agendalx.pt/wp-json/agendalx/v1/events';
    // Tal como outros sites/CDNs portugueses (RTP, etc.), pedidos sem um
    // User-Agent de browser real podem ser recusados — por isso identificamo-nos
    // como um browser normal, em vez de um robô.
    const data = await cachedFetch('agendalx_events', url, 60 * 60 * 1000, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', 'Accept': 'application/json' }
    });
    const events = (Array.isArray(data) ? data : []).map((e) => {
      // A resposta real da Agenda Cultural de Lisboa não segue exatamente a
      // forma documentada/inferida (ex.: categories_name_list já apareceu
      // como algo que não é uma lista) — por isso cada evento é processado
      // em separado, para um campo inesperado num evento não derrubar a
      // lista inteira.
      try {
        return {
          id: e.id,
          title: agendalxText(e.title),
          subtitle: agendalxText(e.subtitle),
          description: agendalxText(e.description),
          dates: e.string_dates || '',
          times: e.string_times || '',
          venue: e.venue?.name || '',
          image: e.featured_media_large || null,
          categories: normalizeAgendalxCategories(e.categories_name_list),
          url: e.link || (e.slug ? `https://www.agendalx.pt/events/event/${e.slug}/` : null)
        };
      } catch (err) {
        console.error('Erro ao processar um evento da Agenda Cultural de Lisboa:', err.message);
        return null;
      }
    }).filter((e) => e && e.title);
    res.json({ events });
  } catch (err) {
    console.error('Erro Agenda Cultural de Lisboa:', err.message);
    res.status(502).json({ error: 'Não foi possível obter os eventos agora.' });
  }
});

// ==================== INCÊNDIOS EM TEMPO REAL (mundo inteiro) ====================
// NASA FIRMS (Fire Information for Resource Management System) — focos de
// incêndio/calor detetados por satélite (VIIRS), atualizados a cada poucas
// horas, cobrindo o planeta todo (inclui Portugal). Gratuita, mas exige uma
// chave própria (grátis, só um email): https://firms.modaps.eosdis.nasa.gov/api/map_key/
// Sem a chave configurada, o endpoint responde "configured: false" e o
// cliente mostra um aviso a pedir configuração, em vez de travar.
const firesCacheStore = {};
function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i]; });
    return obj;
  });
}
async function fetchFiresArea(area) {
  const now = Date.now();
  const cacheKey = 'fires_' + area;
  if (firesCacheStore[cacheKey] && (now - firesCacheStore[cacheKey].t) < 15 * 60 * 1000) return firesCacheStore[cacheKey].data;
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${process.env.NASA_FIRMS_KEY}/VIIRS_SNPP_NRT/${area}/1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();
  if (/invalid|error/i.test(text.slice(0, 40))) throw new Error('Chave da NASA FIRMS inválida ou pedidos esgotados.');
  const fires = parseCsv(text).map(f => ({
    lat: parseFloat(f.latitude), lng: parseFloat(f.longitude),
    date: f.acq_date, time: f.acq_time, confidence: f.confidence,
    frp: f.frp ? parseFloat(f.frp) : null, daynight: f.daynight
  })).filter(f => !isNaN(f.lat) && !isNaN(f.lng));
  firesCacheStore[cacheKey] = { t: now, data: fires };
  return fires;
}
app.get('/api/fires', async (req, res) => {
  if (!process.env.NASA_FIRMS_KEY) return res.json({ configured: false, fires: [] });
  const { west, south, east, north } = req.query;
  if (!west || !south || !east || !north) return res.status(400).json({ error: 'Área do mapa em falta.' });
  try {
    const fires = await fetchFiresArea(`${west},${south},${east},${north}`);
    res.json({ configured: true, fires });
  } catch (err) {
    console.error('Erro incêndios (NASA FIRMS):', err.message);
    res.status(502).json({ error: 'Não foi possível obter dados de incêndios agora.' });
  }
});

// Envia um email real de aviso (ex.: "possível incêndio perto de mim") para
// um destinatário que a PRÓPRIA pessoa escolhe — nunca um envio automático
// para serviços de emergência (ver aviso no README sobre isso). Usa uma
// conta de email própria (Gmail com "palavra-passe de aplicação", ou outro
// serviço SMTP) configurada no servidor — grátis, mas precisa de configuração.
let mailTransporter = null;
// Timeouts explícitos: sem isto, se a rede do servidor bloquear a porta SMTP
// (comum em muitos serviços de alojamento, por prevenção de spam) ou o Gmail
// demorar a responder, o pedido fica pendurado por muito tempo (ou para
// sempre) em vez de falhar — o utilizador via "A enviar email..." parado sem
// nunca saber que não estava a funcionar.
const MAIL_TIMEOUT_MS = 12000;
function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  const { EMAIL_USER, EMAIL_PASS, SMTP_HOST, SMTP_PORT } = process.env;
  if (!EMAIL_USER || !EMAIL_PASS || !nodemailer) return null;
  const timeouts = { connectionTimeout: MAIL_TIMEOUT_MS, greetingTimeout: MAIL_TIMEOUT_MS, socketTimeout: MAIL_TIMEOUT_MS };
  mailTransporter = SMTP_HOST
    ? nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT) || 587, secure: Number(SMTP_PORT) === 465, auth: { user: EMAIL_USER, pass: EMAIL_PASS }, ...timeouts })
    : nodemailer.createTransport({ service: 'gmail', auth: { user: EMAIL_USER, pass: EMAIL_PASS }, ...timeouts });
  return mailTransporter;
}
function escapeHtmlServer(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ==================== VERIFICAÇÃO EM DUAS ETAPAS (login em dispositivo novo) ====================
// Opcional (a pessoa ativa no perfil) e só entra em ação quando: a conta tem
// um email guardado E o servidor tem envio de email configurado (mesma
// getMailTransporter() dos avisos de incêndio) E o dispositivo a tentar
// entrar é mesmo NOVO — os dispositivos já ligados continuam a entrar
// normalmente, sem código nenhum. Se o envio do email falhar por qualquer
// razão (ex.: SMTP em baixo), o login segue em frente sem 2FA em vez de
// bloquear para sempre o dono legítimo da conta.
const pendingLoginCodes = {}; // phone -> {code, deviceId, deviceName, attempts, expiresAt}
const TWOFA_CODE_TTL_MS = 10 * 60 * 1000;
function generateLoginCode() {
  return String(crypto.randomInt(100000, 1000000));
}
function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(user.length - visible.length, 1))}@${domain}`;
}
async function sendLoginCodeEmail(user, code) {
  const transporter = getMailTransporter();
  if (!transporter) return false;
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: '🔐 Código de verificação — ChatApp',
      text: `O teu código de verificação é: ${code}\n\nVálido por 10 minutos. Se não foste tu a tentar entrar, ignora este email — a tua conta continua segura.`,
      html: `<p>O teu código de verificação é:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>Válido por 10 minutos. Se não foste tu a tentar entrar, ignora este email — a tua conta continua segura.</p>`
    });
    return true;
  } catch (err) {
    console.error('Erro ao enviar código de verificação:', err.message);
    return false;
  }
}

// ==================== REDEFINIR SENHA (esqueci a senha) ====================
// Só funciona para contas com email guardado e com o servidor de email
// configurado — sem isso, não há como provar que é mesmo o dono da conta a
// pedir, e a única alternativa continua a ser o administrador apagar a
// conta (ver /api/admin/delete-account) para a pessoa se registar de novo.
const passwordResetCodes = {}; // phone -> {code, attempts, expiresAt}
const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000;
async function sendPasswordResetEmail(user, code) {
  const transporter = getMailTransporter();
  if (!transporter) return false;
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: '🔑 Redefinir senha — ChatApp',
      text: `Pediste para redefinir a senha da tua conta. O código é: ${code}\n\nVálido por 10 minutos. Se não foste tu, ignora este email — a tua senha continua igual.`,
      html: `<p>Pediste para redefinir a senha da tua conta. O código é:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>Válido por 10 minutos. Se não foste tu, ignora este email — a tua senha continua igual.</p>`
    });
    return true;
  } catch (err) {
    console.error('Erro ao enviar código de redefinição de senha:', err.message);
    return false;
  }
}
app.post('/api/password-reset/request', async (req, res) => {
  const phone = (req.body?.phone || '').trim();
  const user = accounts[phone];
  if (!user) return res.status(404).json({ error: 'Não existe nenhuma conta com esse telefone.' });
  if (!user.email) return res.status(400).json({ error: 'Esta conta não tem email guardado — não há para onde enviar o código. Pede a um administrador para apagar a conta e regista-te de novo.' });
  if (!getMailTransporter()) return res.status(503).json({ error: 'O envio de email não está configurado neste servidor agora. Pede a um administrador para apagar a conta e regista-te de novo.' });
  const code = generateLoginCode();
  passwordResetCodes[phone] = { code, attempts: 0, expiresAt: Date.now() + PASSWORD_RESET_TTL_MS };
  const sent = await sendPasswordResetEmail(user, code);
  if (!sent) { delete passwordResetCodes[phone]; return res.status(502).json({ error: 'Não foi possível enviar o email agora. Tenta novamente daqui a pouco.' }); }
  log(`🔑 Código de redefinição de senha enviado para ${user.name}`, 'AUTH');
  res.json({ success: true, maskedEmail: maskEmail(user.email) });
});
app.post('/api/password-reset/confirm', async (req, res) => {
  const phone = (req.body?.phone || '').trim();
  const { code, newPassword } = req.body || {};
  const user = accounts[phone];
  const pending = passwordResetCodes[phone];
  if (!user || !pending) return res.status(400).json({ error: 'Não há nenhum pedido de redefinição pendente para este telefone. Pede um novo código.' });
  if (Date.now() > pending.expiresAt) { delete passwordResetCodes[phone]; return res.status(400).json({ error: 'O código expirou. Pede um novo.' }); }
  if (pending.attempts >= 5) { delete passwordResetCodes[phone]; return res.status(429).json({ error: 'Demasiadas tentativas erradas. Pede um novo código.' }); }
  if (String(code || '').trim() !== pending.code) {
    pending.attempts++;
    return res.status(401).json({ error: 'Código incorreto.' });
  }
  if (String(newPassword || '').length < 8) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
  if (isWeakPassword(newPassword)) return res.status(400).json({ error: 'Essa senha é demasiado comum/fácil de adivinhar (ex.: sequências ou senhas muito usadas). Escolhe uma diferente.' });
  delete passwordResetCodes[phone];
  const salt = crypto.randomBytes(16).toString('hex');
  user.salt = salt;
  user.passwordHash = hashPassword(newPassword, salt);
  // Redefinir a senha invalida logo todas as sessões ativas desta conta —
  // se alguém tinha acesso indevido (era precisamente por isso que a pessoa
  // veio redefinir), perde-o já em vez de continuar ligado.
  Object.keys(sessions).forEach((t) => { if (sessions[t] === phone) delete sessions[t]; });
  const activeSockets = phoneToSockets[phone];
  if (activeSockets) {
    activeSockets.forEach((sid) => {
      io.to(sid).emit('password_was_reset');
      io.sockets.sockets.get(sid)?.disconnect(true);
    });
    delete phoneToSockets[phone];
  }
  if (isDbConnected) {
    await AccountModel.updateOne({ phone }, { salt: user.salt, passwordHash: user.passwordHash }).catch((e) => console.error('Erro Mongo (redefinir senha):', e.message));
  } else {
    saveUsers();
  }
  log(`🔑 Senha redefinida: ${user.name} (${phone})`, 'AUTH');
  res.json({ success: true });
});
async function completeLogin(user, existingDevice, deviceId, deviceName, res) {
  if (existingDevice) {
    existingDevice.name = deviceName;
    existingDevice.lastSeenAt = new Date().toISOString();
  } else {
    if (!user.devices) user.devices = [];
    user.devices.push({ id: deviceId, name: deviceName, lastSeenAt: new Date().toISOString() });
  }
  if (isDbConnected) {
    await AccountModel.updateOne({ phone: user.phone }, { devices: user.devices }).catch((e) => console.error('Erro Mongo (dispositivos):', e.message));
  } else {
    saveUsers();
  }
  const token = makeToken();
  sessions[token] = user.phone;
  log(`✅ Login: ${user.name} (${user.phone})`, 'AUTH');
  res.json({ success: true, user: publicUser(user), token });
}
app.post('/api/fires/send-email', async (req, res) => {
  const transporter = getMailTransporter();
  if (!transporter) return res.json({ configured: false });
  const token = req.headers['x-auth-token'] || req.body?.token;
  const phone = sessions[token];
  const account = accounts[phone];
  if (!account) return res.status(403).json({ error: 'Sessão inválida — faz login de novo.' });
  const { to, lat, lng } = req.body || {};
  if (!to || typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'Dados em falta.' });
  try {
    const mapsLink = `https://maps.google.com/?q=${lat},${lng}`;
    const senderName = escapeHtmlServer(account.name);
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject: '🔥 Aviso de possível incêndio — ChatApp',
      text: `${account.name} reportou um possível incêndio perto desta localização: ${mapsLink}\n\nCoordenadas: ${lat}, ${lng}`,
      html: `<p>🔥 <strong>${senderName}</strong> reportou um possível incêndio perto desta localização:</p><p><a href="${mapsLink}">${mapsLink}</a></p><p>Coordenadas: ${lat}, ${lng}</p><p style="color:#888;font-size:12px;">Enviado automaticamente pelo ChatApp — não é um alerta oficial dos bombeiros.</p>`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao enviar email de incêndio:', err.message);
    res.status(502).json({ error: 'Não foi possível enviar o email agora.' });
  }
});

// ==================== TURISMO (pontos de interesse pelo mundo) ====================
// Usa a pesquisa geográfica da Wikipédia em português (gratuita, sem chave)
// para encontrar pontos de interesse perto de um sítio, e o resumo da página
// (extract + imagem) para dar uma breve "história" de cada um. Sem API de
// transportes própria — "como chegar" é feito pelo cliente com um link direto
// para direções de transporte público no Google Maps, sem precisarmos de
// manter dados de autocarros/comboios/metros nós próprios.
app.get('/api/tourism/poi', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'Coordenadas em falta.' });
  const radius = Math.min(Math.max(parseInt(req.query.radius) || 10000, 1000), 10000); // limite da própria API da Wikipédia
  try {
    const url = `https://pt.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=${radius}&gslimit=30&format=json`;
    const cacheKey = `tourism_poi_${lat.toFixed(3)}_${lon.toFixed(3)}_${radius}`;
    const data = await cachedFetch(cacheKey, url, 3600000, { headers: { 'User-Agent': 'ChatAppTurismo/1.0 (funcionalidade de turismo dentro de uma app de mensagens; sem contacto público)' } });
    const points = (data.query?.geosearch || []).map((p) => ({ title: p.title, lat: p.lat, lon: p.lon, distanceM: Math.round(p.dist) }));
    res.json({ points });
  } catch (err) {
    console.error('Erro pontos turísticos:', err.message);
    res.status(502).json({ error: 'Não foi possível procurar pontos turísticos agora.' });
  }
});
// Praias, museus, atrações e parques/praças perto de um sítio — usa o
// Overpass API (gratuito, sem chave), que consulta diretamente as tags reais
// do OpenStreetMap (ex.: natural=beach, tourism=museum), muito mais preciso
// para isto do que a pesquisa genérica da Wikipédia usada em "Geral" acima.
// Quando o próprio OSM já liga o sítio a um artigo da Wikipédia (tag
// "wikipedia"), guardamos esse título para a ficha do ponto ir buscar a
// descrição certa, em vez de adivinhar pelo nome do OSM.
const TOURISM_CATEGORY_FILTERS = {
  praias: [['natural', 'beach']],
  museus: [['tourism', 'museum'], ['tourism', 'gallery']],
  atracoes: [['tourism', 'attraction'], ['tourism', 'viewpoint'], ['tourism', 'theme_park'], ['tourism', 'zoo'], ['tourism', 'aquarium']],
  parques: [['leisure', 'park'], ['place', 'square'], ['landuse', 'recreation_ground']]
};
app.get('/api/tourism/category', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const category = req.query.category;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'Coordenadas em falta.' });
  const filters = TOURISM_CATEGORY_FILTERS[category];
  if (!filters) return res.status(400).json({ error: 'Categoria desconhecida.' });
  const radius = Math.min(Math.max(parseInt(req.query.radius) || 10000, 500), 15000);
  try {
    const clauses = filters.map(([k, v]) => `node["${k}"="${v}"](around:${radius},${lat},${lon});\n  way["${k}"="${v}"](around:${radius},${lat},${lon});`).join('\n  ');
    const query = `[out:json][timeout:20];\n(\n  ${clauses}\n);\nout center 40;`;
    const cacheKey = `tourism_cat_${category}_${lat.toFixed(3)}_${lon.toFixed(3)}_${radius}`;
    const data = await fetchOverpass(cacheKey, query, 3600000);
    const points = (data.elements || [])
      .filter((el) => el.tags?.name)
      .map((el) => {
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        const wikiTag = el.tags.wikipedia; // formato "pt:Título do artigo"
        const wikiTitle = wikiTag ? wikiTag.split(':').slice(1).join(':') || wikiTag : null;
        return { title: el.tags.name, lat: elLat, lon: elLon, wikiTitle };
      })
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .slice(0, 40);
    res.json({ points });
  } catch (err) {
    console.error('Erro categoria turística:', err.message);
    res.status(502).json({ error: 'Não foi possível procurar agora.' });
  }
});
app.get('/api/tourism/details', async (req, res) => {
  const title = (req.query.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Falta o título do ponto.' });
  try {
    const url = `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const cacheKey = `tourism_details_${title.toLowerCase()}`;
    const data = await cachedFetch(cacheKey, url, 24 * 3600000, { headers: { 'User-Agent': 'ChatAppTurismo/1.0 (funcionalidade de turismo dentro de uma app de mensagens; sem contacto público)' } });
    res.json({
      extract: data.extract || null,
      thumbnail: data.thumbnail?.source || null,
      wikiUrl: data.content_urls?.desktop?.page || null
    });
  } catch (err) {
    console.error('Erro detalhes de ponto turístico:', err.message);
    res.status(502).json({ error: 'Não foi possível carregar mais informação agora.' });
  }
});

// ==================== ONDE ASSISTIR (filmes e séries) ====================
// Pesquisa um título e mostra em que serviços de streaming está disponível
// (Netflix, Prime Video, Disney+, etc.) — usa a API gratuita do TMDB (The
// Movie Database), cujos dados de disponibilidade vêm licenciados da
// JustWatch. Nunca mostra o filme/série em si, só a informação de onde
// assistir legalmente, com um link para abrir no serviço — o mesmo modelo
// do próprio JustWatch. Precisa de uma chave gratuita (ver README).
const watchCacheStore = {};
async function tmdbFetch(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set('api_key', process.env.TMDB_API_KEY);
  url.searchParams.set('language', 'pt-PT');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
app.get('/api/watch/search', async (req, res) => {
  if (!process.env.TMDB_API_KEY) return res.json({ configured: false, results: [] });
  const query = (req.query.q || '').trim();
  if (!query) return res.json({ configured: true, results: [] });
  const cacheKey = 'search_' + query.toLowerCase();
  const now = Date.now();
  if (watchCacheStore[cacheKey] && (now - watchCacheStore[cacheKey].t) < 60 * 60 * 1000) {
    return res.json({ configured: true, results: watchCacheStore[cacheKey].data });
  }
  try {
    const data = await tmdbFetch('/search/multi', { query, include_adult: 'false' });
    const results = (data.results || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        mediaType: r.media_type,
        title: r.title || r.name,
        year: (r.release_date || r.first_air_date || '').slice(0, 4),
        posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : null
      }));
    watchCacheStore[cacheKey] = { t: now, data: results };
    res.json({ configured: true, results });
  } catch (err) {
    console.error('Erro TMDB (pesquisa):', err.message);
    res.status(502).json({ error: 'Não foi possível pesquisar agora.' });
  }
});
app.get('/api/watch/providers', async (req, res) => {
  if (!process.env.TMDB_API_KEY) return res.json({ configured: false });
  const { id, type } = req.query;
  if (!id || (type !== 'movie' && type !== 'tv')) return res.status(400).json({ error: 'Dados em falta.' });
  const cacheKey = `providers_${type}_${id}`;
  const now = Date.now();
  if (watchCacheStore[cacheKey] && (now - watchCacheStore[cacheKey].t) < 6 * 60 * 60 * 1000) {
    return res.json({ configured: true, results: watchCacheStore[cacheKey].data });
  }
  try {
    const data = await tmdbFetch(`/${type}/${id}/watch/providers`);
    const results = data.results || {};
    watchCacheStore[cacheKey] = { t: now, data: results };
    res.json({ configured: true, results });
  } catch (err) {
    console.error('Erro TMDB (fornecedores):', err.message);
    res.status(502).json({ error: 'Não foi possível obter onde assistir agora.' });
  }
});

// ==================== CÂMBIO (conversor de moedas) ====================
// API gratuita, mundial, sem chave nem registo — ExchangeRate-API (endpoint
// de acesso livre, atualizado uma vez por dia). Cobre ~160 moedas, incluindo
// as menos comuns como a Dobra de São Tomé e Príncipe (STN) e o Kwanza
// angolano (AOA).
app.get('/api/currency/rates', async (req, res) => {
  const base = (req.query.base || 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) return res.status(400).json({ error: 'Moeda base inválida.' });
  try {
    const data = await cachedFetch('currency_' + base, `https://open.er-api.com/v6/latest/${base}`, 6 * 60 * 60 * 1000);
    if (data.result !== 'success') throw new Error('A API de câmbio devolveu um erro.');
    res.json({ base: data.base_code, rates: data.rates, updated: data.time_last_update_utc });
  } catch (err) {
    console.error('Erro ao obter taxas de câmbio:', err.message);
    res.status(502).json({ error: 'Não foi possível obter as taxas de câmbio agora.' });
  }
});

// ==================== MÚSICA (Jamendo) ====================
// Catálogo de artistas independentes com licenças abertas (Creative
// Commons e afins) — ao contrário do Spotify, a própria Jamendo distribui
// o ficheiro áudio completo de cada faixa (não é só um preview de 30s),
// por isso dá para tocar a música toda dentro da própria app com um
// simples <audio>. Precisa de um client_id gratuito (ver README).
const jamendoCacheStore = {};
async function jamendoFetch(params = {}) {
  const url = new URL('https://api.jamendo.com/v3.0/tracks/');
  url.searchParams.set('client_id', process.env.JAMENDO_CLIENT_ID);
  url.searchParams.set('format', 'json');
  url.searchParams.set('imagesize', '300');
  url.searchParams.set('include', 'musicinfo');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function mapJamendoTrack(t) {
  return {
    id: t.id,
    title: t.name,
    artist: t.artist_name,
    album: t.album_name || '',
    image: t.image || t.album_image || null,
    audio: t.audio,
    duration: t.duration
  };
}
app.get('/api/music/search', async (req, res) => {
  if (!process.env.JAMENDO_CLIENT_ID) return res.json({ configured: false, results: [] });
  const query = (req.query.q || '').trim();
  const cacheKey = 'music_' + (query ? 'q_' + query.toLowerCase() : 'popular');
  const now = Date.now();
  if (jamendoCacheStore[cacheKey] && (now - jamendoCacheStore[cacheKey].t) < 60 * 60 * 1000) {
    return res.json({ configured: true, results: jamendoCacheStore[cacheKey].data });
  }
  try {
    const params = query
      ? { search: query, order: 'relevance', limit: '30' }
      : { order: 'popularity_month', limit: '30' };
    const data = await jamendoFetch(params);
    const results = (data.results || []).filter((t) => t.audio).map(mapJamendoTrack);
    jamendoCacheStore[cacheKey] = { t: now, data: results };
    res.json({ configured: true, results });
  } catch (err) {
    console.error('Erro Jamendo (pesquisa):', err.message);
    res.status(502).json({ error: 'Não foi possível pesquisar música agora.' });
  }
});

// ==================== GIFS E STICKERS (Giphy) ====================
// Precisa de uma chave gratuita da Giphy (ver README) — sem ela, devolve
// {configured:false} e o modal mostra apenas o aviso, tal como as outras
// integrações opcionais desta app.
app.get('/api/gifs/search', async (req, res) => {
  if (!process.env.GIPHY_API_KEY) return res.json({ configured: false, results: [] });
  const query = (req.query.q || '').trim();
  const kind = req.query.type === 'stickers' ? 'stickers' : 'gifs';
  try {
    const endpoint = query ? 'search' : 'trending';
    const url = new URL(`https://api.giphy.com/v1/${kind}/${endpoint}`);
    url.searchParams.set('api_key', process.env.GIPHY_API_KEY);
    url.searchParams.set('limit', '24');
    url.searchParams.set('rating', 'pg');
    if (query) url.searchParams.set('q', query);
    const cacheKey = `gifs_${kind}_${endpoint}_${query.toLowerCase()}`;
    const data = await cachedFetch(cacheKey, url.toString(), 30 * 60 * 1000);
    const results = (data.data || []).map((g) => ({
      preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url,
      full: g.images?.fixed_width?.url || g.images?.original?.url,
      title: g.title || ''
    })).filter((g) => g.preview && g.full);
    res.json({ configured: true, results });
  } catch (err) {
    console.error('Erro Giphy (pesquisa):', err.message);
    res.status(502).json({ error: 'Não foi possível pesquisar agora.' });
  }
});

// ==================== GERADOR DE IMAGENS POR IA (Pollinations.ai) ====================
// Serviço gratuito e sem chave nenhuma — ao contrário do DALL-E/Stability AI
// (que exigem uma chave paga), a Pollinations gera a imagem na hora só a
// partir do próprio URL, como um CDN que "revela" a imagem ao ser pedida.
// Por isso este endpoint não faz upload nem processamento nenhum: só
// constrói o URL com o prompt escolhido, e o cliente usa-o diretamente
// como fonte de uma <img> — igual ao que já se faz com os GIFs da Giphy.
app.get('/api/generate-image', (req, res) => {
  const prompt = (req.query.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Escreve uma descrição para a imagem.' });
  const seed = Math.floor(Math.random() * 1000000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&nologo=true&seed=${seed}`;
  res.json({ url });
});

// ==================== PRÉ-VISUALIZAÇÃO DE LINKS (Open Graph) ====================
// Quando uma mensagem tem um URL, mostra um cartão com título/imagem/descrição
// (tal como WhatsApp/Telegram), lido dos meta tags Open Graph da própria
// página. Isto obriga o SERVIDOR a ir buscar um URL escolhido por quem
// escreve a mensagem — sem cuidado, isso é um risco clássico de SSRF
// (alguém mandava, por exemplo, "http://localhost:27017" ou um IP interno da
// rede, usando o nosso servidor como sonda para a rede interna). Por isso,
// antes de qualquer pedido: só protocolo http(s), resolve o nome para IP e
// recusa se o IP resolvido for privado/reservado (localhost, redes locais,
// link-local — que inclui o endereço de metadados de nuvem 169.254.169.254).
function isPrivateOrReservedIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA (fc00::/7)
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.split(':').pop());
    return false;
  }
  return true; // não reconhecido como IP válido — recusa por precaução
}
function extractMetaContent(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${property}["']`, 'i')
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}
const linkPreviewCache = {};
app.get('/api/link-preview', async (req, res) => {
  const rawUrl = (req.query.url || '').trim();
  let parsed;
  try { parsed = new URL(rawUrl); } catch (e) { return res.status(400).json({ error: 'URL inválido.' }); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return res.status(400).json({ error: 'URL inválido.' });

  const cacheKey = parsed.toString();
  const now = Date.now();
  if (linkPreviewCache[cacheKey] && (now - linkPreviewCache[cacheKey].t) < 3600000) {
    return res.json(linkPreviewCache[cacheKey].data);
  }

  try {
    const { address } = await dns.promises.lookup(parsed.hostname);
    if (isPrivateOrReservedIp(address)) {
      return res.json({ url: rawUrl }); // sem preview, mas não revela que foi bloqueado por segurança
    }
  } catch (e) {
    return res.json({ url: rawUrl }); // não resolveu o nome — sem preview, sem erro
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const r = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChatAppLinkPreview/1.0)' }
    });
    clearTimeout(timeoutId);
    const contentType = r.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      const data = { url: rawUrl };
      linkPreviewCache[cacheKey] = { t: now, data };
      return res.json(data);
    }
    // Só lê os primeiros ~100KB — chega de sobra para o <head>, sem descarregar páginas gigantes.
    const reader = r.body.getReader();
    let html = '', received = 0;
    while (received < 100000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += Buffer.from(value).toString('utf-8');
      received += value.length;
    }
    reader.cancel().catch(() => {});
    const title = extractMetaContent(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || null);
    const description = extractMetaContent(html, 'og:description') || extractMetaContent(html, 'description');
    let image = extractMetaContent(html, 'og:image');
    if (image) {
      try { image = new URL(image, parsed).toString(); } catch (e) { image = null; }
      if (image && !/^https:\/\//i.test(image)) image = null; // não mistura conteúdo http:// numa app servida em https
    }
    const data = {
      url: rawUrl,
      title: title ? title.trim().slice(0, 200) : null,
      description: description ? description.trim().slice(0, 300) : null,
      image: image || null
    };
    linkPreviewCache[cacheKey] = { t: now, data };
    res.json(data);
  } catch (err) {
    res.json({ url: rawUrl }); // falha graciosamente: sem pré-visualização, mas o link continua a funcionar normalmente na mensagem
  }
});

// ==================== FRASE DO DIA ====================
// API gratuita (ZenQuotes) — sem chave, mas pede atribuição de origem quando
// usada sem chave paga, por isso mostramos "— ZenQuotes.io" no ecrã. Vem em
// inglês; traduz-se para português com o mesmo serviço gratuito já usado no
// tradutor da app (falha graciosamente para o texto original se a tradução
// não estiver disponível). Cache de 24h, já que é "do dia" e igual para todos.
app.get('/api/quote-of-day', async (req, res) => {
  try {
    const data = await cachedFetch('quote_of_day', 'https://zenquotes.io/api/today', 24 * 60 * 60 * 1000);
    const entry = (data || [])[0];
    if (!entry?.q) throw new Error('Resposta inesperada da ZenQuotes.');
    let quote = entry.q;
    try {
      const translateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q=${encodeURIComponent(entry.q)}`;
      const tr = await fetch(translateUrl);
      if (tr.ok) {
        const trData = await tr.json();
        quote = (trData[0] || []).map(chunk => chunk[0]).join('') || entry.q;
      }
    } catch (e) { /* se a tradução falhar, segue com a frase original em inglês */ }
    res.json({ quote, author: entry.a || 'Desconhecido' });
  } catch (err) {
    console.error('Erro na frase do dia:', err.message);
    res.status(502).json({ error: 'Não foi possível obter a frase do dia agora.' });
  }
});

// ==================== METEOROLOGIA (Open-Meteo) ====================
// API gratuita, mundial, sem chave nem registo — Open-Meteo. Primeiro
// converte o nome da localidade em coordenadas (geocoding), depois pede a
// previsão para essas coordenadas. Não precisa de nenhuma configuração.
app.get('/api/weather', async (req, res) => {
  const query = (req.query.q || '').trim();
  const rawLat = parseFloat(req.query.lat);
  const rawLon = parseFloat(req.query.lon);
  let place = null;
  let latitude, longitude;
  try {
    if (query) {
      const geoData = await cachedFetch(
        'weather_geo_' + query.toLowerCase(),
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=pt&format=json`,
        24 * 60 * 60 * 1000
      );
      place = (geoData.results || [])[0];
      if (!place) return res.status(404).json({ error: 'Não encontrei essa localidade.' });
      latitude = place.latitude;
      longitude = place.longitude;
    } else if (Number.isFinite(rawLat) && Number.isFinite(rawLon)) {
      // Usado pela aba de Turismo: tempo para onde quer que o mapa esteja
      // centrado, sem precisar de saber o nome do sítio.
      latitude = rawLat;
      longitude = rawLon;
    } else {
      return res.status(400).json({ error: 'Indica uma cidade/localidade, ou coordenadas.' });
    }
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5`;
    const cacheKey = place ? ('weather_fc_' + place.id) : `weather_fc_${latitude.toFixed(2)}_${longitude.toFixed(2)}`;
    const data = await cachedFetch(cacheKey, forecastUrl, 30 * 60 * 1000);
    res.json({
      place: place ? { name: place.name, country: place.country, admin1: place.admin1 || null } : null,
      current: data.current,
      daily: data.daily
    });
  } catch (err) {
    console.error('Erro ao obter meteorologia:', err.message);
    res.status(502).json({ error: 'Não foi possível obter a meteorologia agora.' });
  }
});

// ==================== SALA "CONDUZIR E OUVIR" (Drive & Listen) ====================
// Inspirado no driveandlisten.app: vídeo de condução pela cidade (YouTube) +
// rádio local a tocar ao mesmo tempo. A lista de cidades é curada à mão (com
// vídeos verificados); o link do YouTube só toca imagem (sem som do vídeo),
// e o som vem de uma rádio real do país, obtida através da Radio Browser
// (radio-browser.info) — uma base de dados aberta e mundial de rádios, que
// verifica periodicamente se os links ainda funcionam, para não depender de
// um link fixo que pode "morrer" com o tempo.
const DRIVE_LISTEN_CITIES = [
  { id: 'lisbon', name: 'Lisboa', country: 'Portugal', flag: '🇵🇹', videoId: 's0zi01sRxNs', videoId2: 'pbaQXuoJVgA' },
  { id: 'madrid', name: 'Madrid', country: 'Spain', flag: '🇪🇸', videoId: 'C911U_Fo-QU', videoId2: 'fnW0SsBPjwM' },
  { id: 'valencia', name: 'Valência', country: 'Spain', flag: '🇪🇸', videoId: 'AtbPS5N9jKw', videoId2: 'w5TeQGONSEw' },
  { id: 'barcelona', name: 'Barcelona', country: 'Spain', flag: '🇪🇸', videoId: 'xp05mxNpJVo', videoId2: 'uM-GMmcOuXo' },
  { id: 'paris', name: 'Paris', country: 'France', flag: '🇫🇷', videoId: 'lN43inpI2lk', videoId2: 'IW8jllqb8BE' },
  { id: 'london', name: 'Londres', country: 'United Kingdom', flag: '🇬🇧', videoId: '7lqBxVD9lI0' },
  { id: 'newyork', name: 'Nova Iorque', country: 'United States', flag: '🇺🇸', videoId: 'usyrgSEbx_A' },
  { id: 'tokyo', name: 'Tóquio', country: 'Japan', flag: '🇯🇵', videoId: 'fkoDgPOFtHY', videoId2: '39-riPjjmBg' }
];

app.get('/api/drivelisten/cities', (req, res) => {
  res.json(DRIVE_LISTEN_CITIES);
});

app.get('/api/drivelisten/radio', async (req, res) => {
  const { country } = req.query;
  if (!country) return res.status(400).json({ error: 'Parâmetro "country" é obrigatório.' });
  try {
    const url = `https://de1.api.radio-browser.info/json/stations/bycountry/${encodeURIComponent(country)}?hidebroken=true&order=votes&reverse=true&limit=5`;
    const stations = await cachedFetch('radio_' + country, url, 3600000, {
      headers: { 'User-Agent': 'SinalApp/1.0' } // a Radio Browser pede um User-Agent identificável
    });
    const valid = (Array.isArray(stations) ? stations : []).find(s => s.url_resolved || s.url);
    if (!valid) return res.status(404).json({ error: 'Nenhuma rádio encontrada para este país.' });
    res.json({ name: valid.name, url: valid.url_resolved || valid.url, homepage: valid.homepage || null });
  } catch (err) {
    console.error('Erro rádio:', err.message);
    res.status(502).json({ error: 'Não foi possível obter uma rádio agora.' });
  }
});

// ==================== NOTÍCIAS (Portugal + Mundo) ====================
// Agrega notícias via RSS público (sem chave, sem scraping) de fontes
// conhecidas. Atualiza sozinho de X em X minutos e avisa quem estiver ligado
// (via socket) assim que sai uma notícia nova — parecido com o Google Notícias.
// Se alguma destas fontes deixar de responder (os sites mudam o endereço do
// RSS de vez em quando), fica só sem essa fonte — as outras continuam a
// funcionar normalmente (ver log do servidor para saber qual falhou).
const NEWS_FEEDS = [
  { id: 'publico', name: 'Público', flag: '🇵🇹', category: 'portugal', url: 'https://www.publico.pt/rss' },
  { id: 'observador', name: 'Observador', flag: '🇵🇹', category: 'portugal', url: 'https://observador.pt/feed/' },
  { id: 'rtp', name: 'RTP Notícias', flag: '🇵🇹', category: 'portugal', url: 'https://www.rtp.pt/noticias/rss' },
  { id: 'bbc', name: 'BBC World', flag: '🌍', category: 'mundo', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'euronews', name: 'Euronews', flag: '🇪🇺', category: 'mundo', url: 'https://pt.euronews.com/rss' },
  { id: 'cnn', name: 'CNN', flag: '🌍', category: 'mundo', url: 'http://rss.cnn.com/rss/edition.rss' },
  { id: 'rtpafrica', name: 'RTP África', flag: '🌍', category: 'mundo', url: 'https://www.rtp.pt/africa/rss' },
  { id: 'elpais', name: 'El País', flag: '🇪🇸', category: 'mundo', url: 'https://elpais.com/rss/elpais/portada.xml' },
  { id: 'abc', name: 'ABC', flag: '🇪🇸', category: 'mundo', url: 'https://www.abc.es/rss/feeds/abcPortada.xml' },
  { id: 'lemonde', name: 'Le Monde', flag: '🇫🇷', category: 'mundo', url: 'https://www.lemonde.fr/rss/une.xml' },
  { id: 'g1', name: 'G1', flag: '🇧🇷', category: 'mundo', url: 'https://g1.globo.com/rss/g1/' },
  { id: 'telanon', name: 'Téla Nón', flag: '🇸🇹', category: 'mundo', url: 'https://www.telanon.info/feed/' },
  { id: 'record', name: 'Record', flag: '⚽', category: 'futebol', url: 'https://www.record.pt/rss' }
];
let newsItems = []; // lista mesclada de todas as fontes, mais recente primeiro
let newsKnownLinks = new Set();
let newsInitialized = false; // evita tratar a primeira carga inteira como "notícias novas"

function decodeXmlEntities(str) {
  return (str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '') // remove tags html residuais (comuns dentro de <description>)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? decodeXmlEntities(m[1]) : '';
}
function extractLink(block) {
  const rssLink = block.match(/<link>([\s\S]*?)<\/link>/i); // RSS: <link>URL</link>
  if (rssLink) return decodeXmlEntities(rssLink[1]);
  const atomLink = block.match(/<link[^>]*href=["']([^"']+)["']/i); // Atom: <link href="URL" .../>
  return atomLink ? atomLink[1] : '';
}
function parseRssXml(xml, feed) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return blocks.map(block => {
    const title = extractTag(block, 'title');
    const link = extractLink(block);
    if (!title || !link) return null;
    const dateStr = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated');
    const date = dateStr ? new Date(dateStr) : new Date();
    const snippet = (extractTag(block, 'description') || extractTag(block, 'summary')).slice(0, 220);
    return {
      title, link, snippet,
      time: (isNaN(date.getTime()) ? new Date() : date).toISOString(),
      source: feed.name, flag: feed.flag, category: feed.category
    };
  }).filter(Boolean);
}
async function fetchNewsFeed(feed) {
  try {
    const r = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChatAppNews/1.0)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return parseRssXml(await r.text(), feed);
  } catch (err) {
    console.error(`⚠️ Erro ao obter notícias de ${feed.name}:`, err.message);
    return [];
  }
}
async function refreshNews() {
  const results = await Promise.all(NEWS_FEEDS.map(fetchNewsFeed));
  const merged = results.flat().sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 80);
  const brandNew = merged.filter(it => !newsKnownLinks.has(it.link));
  newsItems = merged;
  newsKnownLinks = new Set(merged.map(it => it.link));
  if (newsInitialized && brandNew.length) {
    brandNew.slice(0, 5).forEach(item => io.emit('news_new_item', item));
    log(`📰 ${brandNew.length} notícia(s) nova(s)`, 'NEWS');
  }
  newsInitialized = true;
}
app.get('/api/news', (req, res) => res.json(newsItems));

// ==================== MODO LEITURA (extrai o artigo, sem depender do site) ====================
// Alguns sites bloqueiam deliberadamente aparecer dentro de outras apps
// (proteção contra clickjacking, X-Frame-Options/CSP). Em vez de tentar
// contornar isso no navegador (não é possível — a proteção é do lado do
// site), o SERVIDOR vai buscar o HTML da notícia, extrai só o artigo (texto,
// título, imagens — como o Modo Leitura do Safari/Firefox) com o Readability
// da Mozilla, e limpa o resultado com o DOMPurify antes de mandar ao
// telemóvel — assim nunca depende da proteção anti-iframe de ninguém.
app.get('/api/news/read', async (req, res) => {
  if (!JSDOM || !Readability || !createDOMPurify) return res.json({ success: false, error: 'not_available' });
  const articleUrl = req.query.url;
  if (!articleUrl) return res.status(400).json({ error: 'URL em falta.' });
  try {
    // Alguns sites (ex.: RTP) recusam ou devolvem uma página vazia a pedidos
    // que não se pareçam com um browser real — por isso usamos aqui um
    // User-Agent e cabeçalhos completos de um Chrome normal, em vez de nos
    // identificarmos como um robô.
    const r = await fetch(articleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8'
      }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    const dom = new JSDOM(html, { url: articleUrl });
    const article = new Readability(dom.window.document).parse();
    if (!article?.content) throw new Error('Não foi possível identificar o artigo nesta página.');
    const purifyWindow = new JSDOM('').window;
    const DOMPurify = createDOMPurify(purifyWindow);
    const cleanContent = DOMPurify.sanitize(article.content, {
      ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'strong', 'em', 'b', 'i', 'a', 'ul', 'ol', 'li', 'blockquote', 'img', 'figure', 'figcaption', 'br', 'span'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title']
    });
    res.json({ success: true, title: article.title || '', byline: article.byline || '', content: cleanContent });
  } catch (err) {
    console.error('Erro no modo leitura (' + articleUrl + '):', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ==================== SERVIDOR TURN ====================
let turnCache = null;
let turnCacheAt = 0;

// ==================== ESPAÇO (ISS, Sol e satélites visíveis) ====================
// Posição da Estação Espacial Internacional em tempo real + tripulação atual —
// API pública e gratuita do Open Notify, sem chave necessária.
app.get('/api/space/iss', async (req, res) => {
  try {
    // wheretheiss.at é uma API mais fiável e sempre em HTTPS — a open-notify.org
    // (usada antes) é um projeto voluntário com quebras frequentes, que estava a
    // fazer esta secção falhar com bastante regularidade.
    const posR = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
    if (!posR.ok) throw new Error('HTTP ' + posR.status);
    const pos = await posR.json();
    let peopleInSpace = [];
    // A tripulação atual não é essencial — se a open-notify.org estiver em baixo
    // (é frequente), a posição da ISS continua a aparecer na mesma, só sem a lista de nomes.
    try {
      const astrosR = await fetch('http://api.open-notify.org/astros.json');
      if (astrosR.ok) {
        const astros = await astrosR.json();
        peopleInSpace = (astros.people || []).filter(p => p.craft === 'ISS').map(p => ({ name: p.name, craft: p.craft }));
      }
    } catch (e) { /* tripulação é opcional, segue sem ela */ }
    res.json({ lat: pos.latitude, lon: pos.longitude, timestamp: pos.timestamp, peopleInSpace });
  } catch (err) {
    console.error('Erro ISS:', err.message);
    res.status(502).json({ error: 'Não foi possível obter a posição da ISS agora.' });
  }
});

// Horas do nascer/pôr do sol para a localização da pessoa — API pública e
// gratuita (sunrise-sunset.org), sem chave necessária.
app.get('/api/space/sun', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'Localização em falta.' });
  try {
    const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data.status !== 'OK') throw new Error('resposta inválida');
    res.json(data.results);
  } catch (err) {
    console.error('Erro nascer/pôr do sol:', err.message);
    res.status(502).json({ error: 'Não foi possível obter os horários do sol agora.' });
  }
});

// Satélites atualmente visíveis por cima da localização da pessoa — usa a
// N2YO (gratuita, mas precisa de uma chave de API pessoal e grátis em
// n2yo.com/api). Sem a variável de ambiente N2YO_API_KEY configurada, esta
// funcionalidade fica desativada de forma graciosa (o resto do "Espaço"
// continua a funcionar na mesma: ISS, Sol e fase da Lua não precisam dela).
const N2YO_API_KEY = process.env.N2YO_API_KEY || '';
app.get('/api/space/satellites', async (req, res) => {
  const { lat, lon } = req.query;
  if (!N2YO_API_KEY) return res.status(501).json({ error: 'not_configured', message: 'Satélites visíveis exigem uma chave gratuita da N2YO (n2yo.com/api) — define N2YO_API_KEY no servidor para ativar.' });
  if (!lat || !lon) return res.status(400).json({ error: 'Localização em falta.' });
  try {
    // category 0 = todos; raio de busca 70° acima do horizonte
    const url = `https://api.n2yo.com/rest/v1/satellite/above/${lat}/${lon}/0/70/0/&apiKey=${N2YO_API_KEY}`;
    const data = await cachedFetch(`n2yo_${lat}_${lon}`, url, 60000);
    res.json({ satellites: (data.above || []).slice(0, 30) });
  } catch (err) {
    console.error('Erro satélites N2YO:', err.message);
    res.status(502).json({ error: 'Não foi possível obter os satélites agora.' });
  }
});

// ==================== NAVEGAÇÃO GPS (tipo Waze, mundo inteiro) ====================
// Endereço -> coordenadas, via Nominatim (OpenStreetMap) — gratuita, mas exige
// um User-Agent identificável e pede para não bombardear com pedidos; aqui é
// sempre 1 pedido por pesquisa feita pelo utilizador, com cache de 1 minuto.
// Sem restrição de país — pesquisa em qualquer lugar do mundo.
app.get('/api/nav/geocode', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Escreve um endereço para procurar.' });
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=1&q=${encodeURIComponent(q)}`;
    const data = await cachedFetch('geocode_' + q.toLowerCase(), url, 60000, { headers: { 'User-Agent': 'SinalApp/1.0 (navegacao dentro da app de mensagens)' } });
    res.json(data);
  } catch (err) {
    console.error('Erro geocodificação:', err.message);
    res.status(502).json({ error: 'Não foi possível procurar esse endereço agora.' });
  }
});

// Cálculo de rota de condução — OSRM (servidor público de demonstração,
// gratuito mas com uso justo/limitado; adequado para uma app pessoal, não
// para tráfego pesado de produção). Pede sempre 2 alternativas quando existem,
// para a pessoa poder escolher entre rotas — como no Waze/Google Maps.
app.get('/api/nav/route', async (req, res) => {
  const { fromLat, fromLng, toLat, toLng } = req.query;
  if (!fromLat || !fromLng || !toLat || !toLng) return res.status(400).json({ error: 'Coordenadas em falta.' });
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=true&alternatives=true`;
    const cacheKey = `route_${fromLat}_${fromLng}_${toLat}_${toLng}`;
    const data = await cachedFetch(cacheKey, url, 20000);
    if (data.code !== 'Ok' || !data.routes?.length) return res.status(404).json({ error: 'Não foi possível calcular uma rota entre estes dois pontos.' });
    res.json(data);
  } catch (err) {
    console.error('Erro rota:', err.message);
    res.status(502).json({ error: 'Não foi possível calcular a rota agora.' });
  }
});

// Prioridade: Cloudflare Realtime (se configurado) > Metered.ca (se configurado)
// > TURN público partilhado (grátis, mas sobrecarregado — só como último recurso).
const TURN_FALLBACK = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:openrelay.metered.ca:80' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};
async function fetchCloudflareTurn() {
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.CF_TURN_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 3600 })
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...(data.iceServers || [])] };
}
async function fetchMeteredTurn() {
  const r = await fetch(`https://${process.env.METERED_APP_NAME}.metered.live/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const iceServers = await r.json();
  return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...(Array.isArray(iceServers) ? iceServers : [])] };
}
app.get('/api/turn-credentials', async (req, res) => {
  const now = Date.now();
  if (turnCache && (now - turnCacheAt) < 20 * 60 * 1000) return res.json(turnCache);
  try {
    let combined;
    if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) {
      combined = await fetchCloudflareTurn();
    } else if (process.env.METERED_APP_NAME && process.env.METERED_API_KEY) {
      combined = await fetchMeteredTurn();
    } else {
      return res.json(TURN_FALLBACK);
    }
    turnCache = combined;
    turnCacheAt = now;
    res.json(combined);
  } catch (err) {
    console.error('Erro ao gerar credenciais TURN:', err.message);
    res.json(TURN_FALLBACK);
  }
});

// ==================== ASSISTENTE GEMINI (Google) ====================
// Assistente de IA da app — usa a API gratuita do Google AI Studio (Gemini),
// que aceita nativamente texto, imagens, vídeo e documentos na mesma
// conversa. Precisa da variável de ambiente GEMINI_API_KEY (gratuita em
// https://aistudio.google.com/apikey).
// (Antes havia um segundo assistente via GitHub Models, mas a GitHub retirou
// esse serviço por completo a 30 de julho de 2026 — deixou de existir.)
//
// Importante ser realista sobre "sem limites": mesmo gratuito, o Gemini tem
// limites reais de uso (pedidos por minuto/dia) e ficheiros muito grandes
// (a app já limita anexos a 10MB) — não há forma de contornar isso com uma
// chave gratuita, mas dentro desses limites, aceita mesmo qualquer tipo de
// ficheiro comum (fotos, vídeos, PDFs, áudio, texto).
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
// 'gemini-flash-latest' é um "alias" mantido pela própria Google que aponta
// sempre para a versão Flash mais recente disponível — evita que a app
// volte a partir sempre que a Google desativa um modelo específico (foi o
// que aconteceu com o 'gemini-2.0-flash', usado antes).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

// Converte fileData (data:URL em base64, ou um link http(s) já enviado antes
// para o Cloudinary) no formato inline_data que o Gemini espera. Ficheiros
// remotos são descarregados aqui no servidor e reencodados em base64.
async function toGeminiInlineData(fileData, fileType) {
  if (!fileData) return null;
  try {
    if (fileData.startsWith('data:')) {
      const match = fileData.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      return { mime_type: fileType || match[1], data: match[2] };
    }
    if (/^https?:\/\//.test(fileData)) {
      const r = await fetch(fileData);
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 15 * 1024 * 1024) return null; // não tenta ficheiros enormes inline
      return { mime_type: fileType || r.headers.get('content-type') || 'application/octet-stream', data: buf.toString('base64') };
    }
  } catch (e) {
    console.error('Erro ao converter ficheiro para o Gemini:', e.message);
  }
  return null;
}

app.post('/api/gemini-chat', async (req, res) => {
  const { history } = req.body || {};
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Assistente Gemini não configurado: falta GEMINI_API_KEY no servidor.' });
  }
  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'Mensagem vazia.' });
  }
  try {
    const contents = [];
    for (const m of history) {
      const parts = [];
      if (m.text) parts.push({ text: m.text });
      if (m.fileData) {
        const inline = await toGeminiInlineData(m.fileData, m.fileType);
        if (inline) parts.push({ inline_data: inline });
        else if (!m.text) parts.push({ text: '[Enviou um ficheiro que não foi possível processar — pode ser demasiado grande.]' });
      }
      if (!parts.length) continue;
      contents.push({ role: m.role === 'user' ? 'user' : 'model', parts });
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: 'Você é o assistente Gemini, integrado num app de chat. Consegue analisar fotos, vídeos e documentos que lhe enviarem. Responda em português, de forma clara e útil.' }] }
    });
    // O Gemini às vezes devolve 503 "model overloaded" em picos de utilização
    // — é passageiro na grande maioria das vezes, por isso tenta mais uma vez
    // sozinho (com uma pequena pausa) antes de mostrar erro à pessoa.
    let r, data;
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      data = await r.json();
      if (r.ok || r.status !== 503 || attempt === 1) break;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (!r.ok) {
      let error;
      if (r.status === 429) error = 'O Gemini atingiu o limite gratuito de pedidos por agora — tenta novamente daqui a um bocado.';
      else if (r.status === 503) error = 'O Gemini está sobrecarregado agora (muita gente a usar ao mesmo tempo) — tenta novamente daqui a um instante.';
      else error = 'Não foi possível obter resposta do Gemini agora.';
      console.error('Erro Gemini (' + r.status + '):', data?.error?.message || 'sem detalhe');
      return res.status(r.status === 429 ? 429 : 502).json({ error });
    }
    const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') || 'Não consegui gerar uma resposta para isto.';
    res.json({ reply });
  } catch (err) {
    console.error('Erro Gemini:', err.message);
    res.status(503).json({ error: 'Falha ao contactar o Gemini. Tenta novamente em instantes.' });
  }
});

// ==================== TRADUTOR ====================
app.get('/api/translate', async (req, res) => {
  const { text, target } = req.query;
  if (!text || !target) return res.status(400).json({ error: 'Parâmetros obrigatórios emfalta.' });
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Erro na tradução');
    const data = await r.json();
    const translated = (data[0] || []).map(chunk => chunk[0]).join('');
    const detected = data[2] || null; // língua de origem detetada automaticamente (ex.: 'pt', 'es')
    res.json({ translated, detected });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao traduzir.' });
  }
});

// ==================== UPLOAD DE FICHEIROS (Cloudinary — armazenamento externo) ====================
// Por padrão, fotos/áudios/documentos são guardados diretamente na mensagem
// (em base64), o que enche depressa os 512MB grátis do MongoDB Atlas. Se
// configurares o Cloudinary (gratuito até 25GB), os ficheiros passam a ficar
// lá guardados e a mensagem só leva o link — muito mais leve.
//   1. Cria uma conta grátis em https://cloudinary.com/users/register/free
//   2. No painel principal ("Dashboard"), copia: Cloud Name, API Key, API Secret
//   3. Define as variáveis de ambiente CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
//      CLOUDINARY_API_SECRET no Railway/Render
// Sem essas variáveis, os ficheiros continuam a ser guardados em base64 como
// até agora (não obriga a nada).
app.post('/api/upload', async (req, res) => {
  const { fileData } = req.body || {};
  if (!fileData) return res.status(400).json({ error: 'Sem ficheiro.' });
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return res.json({ success: false, configured: false }); // o cliente usa o base64 normalmente, sem erro
  }
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash('sha1').update(`timestamp=${timestamp}${CLOUDINARY_API_SECRET}`).digest('hex');
    const form = new URLSearchParams();
    form.append('file', fileData);
    form.append('timestamp', String(timestamp));
    form.append('api_key', CLOUDINARY_API_KEY);
    form.append('signature', signature);
    const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, { method: 'POST', body: form });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Erro desconhecido do Cloudinary');
    res.json({ success: true, configured: true, url: data.secure_url });
  } catch (err) {
    console.error('Erro no upload para o Cloudinary:', err.message);
    res.status(500).json({ error: 'Falha ao enviar o ficheiro para o armazenamento externo.' });
  }
});

// ==================== NOTIFICAÇÕES PUSH ====================
// Avisa a pessoa de mensagens novas mesmo com a app fechada/em segundo plano.
// As chaves VAPID são geradas automaticamente na primeira vez que o servidor
// arranca e depois guardadas (no MongoDB se estiver ligado, senão num ficheiro
// local) — não precisas de configurar nada à mão para isto funcionar.
let webpush = null;
try { webpush = require('web-push'); } catch (e) { console.warn('⚠️ Pacote "web-push" não instalado — notificações push desativadas.'); }
let vapidKeys = null;
const VAPID_FILE = path.join(__dirname, 'vapid.json');
const settingsSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: Object });
const SettingModel = mongoose.model('Setting', settingsSchema);

async function initPush() {
  if (!webpush) return;
  if (isDbConnected) {
    const doc = await SettingModel.findOne({ key: 'vapid' }).catch(() => null);
    if (doc) vapidKeys = doc.value;
    else {
      vapidKeys = webpush.generateVAPIDKeys();
      await SettingModel.create({ key: 'vapid', value: vapidKeys }).catch(e => console.error('Erro ao guardar chaves VAPID:', e.message));
    }
  } else {
    try {
      if (fs.existsSync(VAPID_FILE)) vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'));
      else { vapidKeys = webpush.generateVAPIDKeys(); fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys)); }
    } catch (e) { console.error('Erro ao gerir chaves VAPID locais:', e.message); }
  }
  if (vapidKeys) webpush.setVapidDetails('mailto:admin@chatnadiel.app', vapidKeys.publicKey, vapidKeys.privateKey);
  console.log(vapidKeys ? '🔔 Notificações push prontas.' : '⚠️ Não foi possível preparar as notificações push.');
}

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys?.publicKey || null });
});

app.post('/api/push-subscribe', async (req, res) => {
  const { token, subscription } = req.body || {};
  const phone = sessions[token];
  if (!phone || !accounts[phone] || !subscription) return res.status(400).json({ error: 'Pedido inválido.' });
  if (!accounts[phone].pushSubscriptions) accounts[phone].pushSubscriptions = [];
  const already = accounts[phone].pushSubscriptions.some(s => s.endpoint === subscription.endpoint);
  if (!already) {
    accounts[phone].pushSubscriptions.push(subscription);
    if (isDbConnected) await AccountModel.updateOne({ phone }, { pushSubscriptions: accounts[phone].pushSubscriptions }).catch(e => console.error('Erro Mongo (push):', e.message));
    else saveUsers();
  }
  res.json({ success: true });
});

async function sendPushToPhone(phone, payload) {
  if (!webpush || !vapidKeys) return;
  const account = accounts[phone];
  if (!account?.pushSubscriptions?.length) return;
  const stillValid = [];
  for (const sub of account.pushSubscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      stillValid.push(sub);
    } catch (err) {
      if (err.statusCode !== 410 && err.statusCode !== 404) stillValid.push(sub); // 410/404 = inscrição expirada, descarta; outros erros mantém para tentar depois
    }
  }
  if (stillValid.length !== account.pushSubscriptions.length) {
    account.pushSubscriptions = stillValid;
    if (isDbConnected) await AccountModel.updateOne({ phone }, { pushSubscriptions: stillValid }).catch(() => {});
    else saveUsers();
  }
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  // Aumentado para 40MB para permitir áudios estendidos longos e ficheiros pesados sem cortes
  maxHttpBufferSize: 40 * 1024 * 1024
});

const users = {};

// Mesmo cálculo de id de sala 1-para-1 usado no cliente (index.html, função
// dmRoomId) — precisamos dele aqui para validar que quem entra numa sala
// "dm_..." ou envia mensagem para lá é mesmo um dos dois participantes. Sem
// isto, qualquer pessoa autenticada que soubesse dois números de telefone
// conseguia calcular o id da conversa e ler/escrever nela sem nunca ter sido
// contacto de nenhum dos dois lados (grupos continuam públicos de propósito).
function dmRoomId(phoneA, phoneB) {
  return 'dm_' + [phoneA, phoneB].sort().join('_').replace(/[^a-zA-Z0-9_]/g, '');
}
// Verifica a sala 1-para-1 só com dados que o SERVIDOR já tem guardados (a
// lista de contactos da conta), em vez de confiar num "toPhone" enviado pelo
// cliente — um cliente com a app em cache antiga (ex.: PWA que ainda não
// atualizou) podia nunca mandar esse campo e ficava para sempre sem conseguir
// entrar nas próprias conversas privadas, mesmo sendo legítimo.
function isDmRoomAllowedForPhone(myPhone, roomId) {
  if (!roomId.startsWith('dm_')) return true;
  if (!myPhone) return false;
  const contacts = accounts[myPhone]?.contacts || [];
  return contacts.some((cp) => dmRoomId(myPhone, cp) === roomId);
}

// Grupos são abertos a todos por padrão (ver README) — 'private' é a exceção:
// só quem está em 'memberPhones' (criador + quem entrou por convite) o vê.
function isGroupMember(group, phone) {
  return !group?.private || (group.memberPhones || []).includes(phone);
}
function visibleGroupsForPhone(phone) {
  return Object.values(groups)
    .filter((g) => isGroupMember(g, phone))
    // Um grupo privado pode ter membros que não são contactos de quem o gere (ex.:
    // entraram por convite) — sem isto, "Gerir grupo" não tinha como mostrar sequer o
    // nome de quem convidar não é já um contacto seu, quanto mais geri-lo.
    .map((g) => (g.private ? { ...g, memberNames: (g.memberPhones || []).map((p) => ({ phone: p, name: accounts[p]?.name || p })) } : g));
}
// Sempre que a lista de grupos muda, cada socket ligado recebe de novo só os grupos que lhe
// dizem respeito — os privados ficam de fora de quem não é membro, tal como um grupo do
// WhatsApp normal nunca aparece a quem nunca foi convidado.
function broadcastGroupsUpdate() {
  io.sockets.sockets.forEach((sock) => {
    const phone = users[sock.id]?.phone;
    sock.emit('groups_update', visibleGroupsForPhone(phone));
  });
}

// ==================== PERSISTÊNCIA DE MENSAGENS ====================
const DATA_FILE = path.join(__dirname, 'messages.json');
let messagesByRoom = {};

function loadMessagesLocal() {
  try {
    if (fs.existsSync(DATA_FILE)) messagesByRoom = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (err) {
    console.error('Erro ao carregar histórico local:', err.message);
  }
}
function saveMessagesLocal() {
  if (isDbConnected) return;
  fs.writeFile(DATA_FILE, JSON.stringify(messagesByRoom), (err) => {
    if (err) console.error('Erro ao salvar histórico local:', err.message);
  });
}

const MAX_HISTORY_PER_ROOM = 500;

// ==================== GRUPOS ====================
const GROUPS_FILE = path.join(__dirname, 'groups.json');
let groups = {};

function loadGroupsLocal() {
  try {
    if (fs.existsSync(GROUPS_FILE)) groups = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8'));
  } catch (err) {
    console.error('Erro ao carregar grupos localmente:', err.message);
  }
}
function saveGroupsLocal() {
  if (isDbConnected) return;
  fs.writeFile(GROUPS_FILE, JSON.stringify(groups), (err) => {
    if (err) console.error('Erro ao salvar grupos localmente:', err.message);
  });
}

// ==================== ATIVIDADES (estilo Strava — corridas/caminhadas/bicicleta) ====================
const ACTIVITIES_FILE = path.join(__dirname, 'activities.json');
let activities = []; // lista simples, mais recente primeiro

function loadActivitiesLocal() {
  try {
    if (fs.existsSync(ACTIVITIES_FILE)) activities = JSON.parse(fs.readFileSync(ACTIVITIES_FILE, 'utf-8'));
  } catch (err) {
    console.error('Erro ao carregar atividades localmente:', err.message);
  }
}
function saveActivitiesLocal() {
  if (isDbConnected) return;
  fs.writeFile(ACTIVITIES_FILE, JSON.stringify(activities.slice(0, 500)), (err) => {
    if (err) console.error('Erro ao salvar atividades localmente:', err.message);
  });
}

// ==================== TAREFAS (lista partilhada por conversa) ====================
const TODOS_FILE = path.join(__dirname, 'todos.json');
let todosByRoom = {}; // roomId -> [{id, text, done, addedBy}]

function loadTodosLocal() {
  try {
    if (fs.existsSync(TODOS_FILE)) todosByRoom = JSON.parse(fs.readFileSync(TODOS_FILE, 'utf-8'));
  } catch (err) {
    console.error('Erro ao carregar tarefas localmente:', err.message);
  }
}
function saveTodosLocal() {
  if (isDbConnected) return;
  fs.writeFile(TODOS_FILE, JSON.stringify(todosByRoom), (err) => {
    if (err) console.error('Erro ao salvar tarefas localmente:', err.message);
  });
}
async function persistTodoRoom(roomId) {
  if (isDbConnected) {
    await TodoModel.updateOne({ roomId }, { roomId, items: todosByRoom[roomId] || [] }, { upsert: true }).catch(e => console.error('Erro Mongo (tarefas):', e.message));
  } else {
    saveTodosLocal();
  }
}

// ==================== NOTAS PESSOAIS (privadas) ====================
const NOTES_FILE = path.join(__dirname, 'notes.json');
let notesByPhone = {}; // phone -> [{id, title, text, updatedAt}]

function loadNotesLocal() {
  try {
    if (fs.existsSync(NOTES_FILE)) notesByPhone = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'));
  } catch (err) {
    console.error('Erro ao carregar notas localmente:', err.message);
  }
}
function saveNotesLocal() {
  if (isDbConnected) return;
  fs.writeFile(NOTES_FILE, JSON.stringify(notesByPhone), (err) => {
    if (err) console.error('Erro ao salvar notas localmente:', err.message);
  });
}

// ==================== MENSAGENS FIXADAS (várias por conversa, até MAX_PINS_PER_ROOM) ====================
const PINS_FILE = path.join(__dirname, 'pins.json');
const MAX_PINS_PER_ROOM = 10;
let pinnedByRoom = {}; // roomId -> [{ messageId, text, sender, pinnedAt }, ...]
function loadPinsLocal() {
  try {
    if (fs.existsSync(PINS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PINS_FILE, 'utf-8'));
      // Compatibilidade com o formato antigo (um único pin por conversa, não era um array).
      pinnedByRoom = {};
      Object.entries(raw || {}).forEach(([roomId, val]) => {
        pinnedByRoom[roomId] = Array.isArray(val) ? val : (val ? [val] : []);
      });
    }
  } catch (err) { console.error('Erro ao carregar mensagens fixadas:', err.message); }
}
function savePinsLocal() {
  fs.writeFile(PINS_FILE, JSON.stringify(pinnedByRoom), (err) => { if (err) console.error('Erro ao salvar mensagens fixadas:', err.message); });
}

// ==================== MENSAGENS TEMPORÁRIAS (autodestrutivas) ====================
const DISAPPEAR_FILE = path.join(__dirname, 'disappearing.json');
let disappearingByRoom = {}; // roomId -> segundos até apagar (ausente/0 = desligado)
function loadDisappearingLocal() {
  try { if (fs.existsSync(DISAPPEAR_FILE)) disappearingByRoom = JSON.parse(fs.readFileSync(DISAPPEAR_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar mensagens temporárias:', err.message); }
}
function saveDisappearingLocal() {
  fs.writeFile(DISAPPEAR_FILE, JSON.stringify(disappearingByRoom), (err) => { if (err) console.error('Erro ao salvar mensagens temporárias:', err.message); });
}

// ==================== ESTADOS (tipo "stories", expiram em 24h) ====================
const STATUSES_FILE = path.join(__dirname, 'statuses.json');
let statusesByPhone = {}; // phone -> [{id, text, photoData, postedAt, expiresAt}]
function loadStatusesLocal() {
  try { if (fs.existsSync(STATUSES_FILE)) statusesByPhone = JSON.parse(fs.readFileSync(STATUSES_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar estados:', err.message); }
}
function saveStatusesLocal() {
  fs.writeFile(STATUSES_FILE, JSON.stringify(statusesByPhone), (err) => { if (err) console.error('Erro ao salvar estados:', err.message); });
}
function pruneExpiredStatuses() {
  const now = Date.now();
  let changed = false;
  Object.keys(statusesByPhone).forEach((phone) => {
    const before = statusesByPhone[phone].length;
    statusesByPhone[phone] = statusesByPhone[phone].filter((s) => s.expiresAt > now);
    if (statusesByPhone[phone].length !== before) changed = true;
    if (statusesByPhone[phone].length === 0) delete statusesByPhone[phone];
  });
  if (changed) saveStatusesLocal();
  return changed;
}
function buildStatusFeed() {
  return Object.entries(statusesByPhone).map(([phone, items]) => ({
    phone, name: accounts[phone]?.name || 'Alguém', avatarUrl: accounts[phone]?.avatarUrl || null, items
  }));
}

// ==================== HISTÓRICO DE CHAMADAS ====================
const CALLLOG_FILE = path.join(__dirname, 'calllog.json');
let callLogByPhone = {}; // phone -> [{id, peerPhone, peerName, type, direction, status, durationSec, timestamp}]
function loadCallLogLocal() {
  try { if (fs.existsSync(CALLLOG_FILE)) callLogByPhone = JSON.parse(fs.readFileSync(CALLLOG_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar histórico de chamadas:', err.message); }
}
function saveCallLogLocal() {
  fs.writeFile(CALLLOG_FILE, JSON.stringify(callLogByPhone), (err) => { if (err) console.error('Erro ao salvar histórico de chamadas:', err.message); });
}

// ==================== MENSAGENS AGENDADAS ====================
const SCHEDULED_FILE = path.join(__dirname, 'scheduled.json');
let scheduledMessages = []; // [{id, chatId, senderPhone, senderName, toPhone, text, sendAt}]
function loadScheduledLocal() {
  try { if (fs.existsSync(SCHEDULED_FILE)) scheduledMessages = JSON.parse(fs.readFileSync(SCHEDULED_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar mensagens agendadas:', err.message); }
}
function saveScheduledLocal() {
  fs.writeFile(SCHEDULED_FILE, JSON.stringify(scheduledMessages), (err) => { if (err) console.error('Erro ao salvar mensagens agendadas:', err.message); });
}
// Avança 'prevSendAt' pelo intervalo da recorrência até passar de 'now' — nunca só
// soma um único intervalo, porque se o servidor esteve em baixo o suficiente para
// perder várias ocorrências, isto evita um "catch-up" a disparar todas de seguida:
// salta as perdidas em silêncio e agenda só a próxima que ainda não aconteceu.
function nextRecurrenceTime(prevSendAt, recurrence, now) {
  const d = new Date(prevSendAt);
  do {
    if (recurrence === 'daily') d.setDate(d.getDate() + 1);
    else if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
    else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
    else break;
  } while (d.getTime() <= now);
  return d.getTime();
}

// ==================== CONVERSAS SILENCIADAS ====================
const MUTED_FILE = path.join(__dirname, 'muted.json');
let mutedByPhone = {}; // phone -> [chatId, ...]
function loadMutedLocal() {
  try { if (fs.existsSync(MUTED_FILE)) mutedByPhone = JSON.parse(fs.readFileSync(MUTED_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar conversas silenciadas:', err.message); }
}
function saveMutedLocal() {
  fs.writeFile(MUTED_FILE, JSON.stringify(mutedByPhone), (err) => { if (err) console.error('Erro ao salvar conversas silenciadas:', err.message); });
}

// ==================== CONVERSAS ARQUIVADAS ====================
const ARCHIVED_FILE = path.join(__dirname, 'archived.json');
let archivedByPhone = {}; // phone -> [chatId, ...]
function loadArchivedLocal() {
  try { if (fs.existsSync(ARCHIVED_FILE)) archivedByPhone = JSON.parse(fs.readFileSync(ARCHIVED_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar conversas arquivadas:', err.message); }
}
function saveArchivedLocal() {
  fs.writeFile(ARCHIVED_FILE, JSON.stringify(archivedByPhone), (err) => { if (err) console.error('Erro ao salvar conversas arquivadas:', err.message); });
}

// ==================== CONVERSAS FIXADAS NO TOPO ====================
// Igual a arquivadas (mesmo modelo: uma lista de chatIds por conta), só que
// para o efeito oposto — destacar uma conversa no topo da lista em vez de a
// esconder. Uma conta pode fixar até 5 conversas (limite razoável, como no
// WhatsApp), mantendo a ordem em que foram fixadas.
const PINNED_CHATS_FILE = path.join(__dirname, 'pinned-chats.json');
let pinnedChatsByPhone = {}; // phone -> [chatId, ...]
function loadPinnedChatsLocal() {
  try { if (fs.existsSync(PINNED_CHATS_FILE)) pinnedChatsByPhone = JSON.parse(fs.readFileSync(PINNED_CHATS_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar conversas fixadas:', err.message); }
}
function savePinnedChatsLocal() {
  fs.writeFile(PINNED_CHATS_FILE, JSON.stringify(pinnedChatsByPhone), (err) => { if (err) console.error('Erro ao salvar conversas fixadas:', err.message); });
}

// ==================== UTILIZADORES BLOQUEADOS ====================
const BLOCKED_FILE = path.join(__dirname, 'blocked.json');
let blockedByPhone = {}; // phone -> [phone bloqueado, ...]
function loadBlockedLocal() {
  try { if (fs.existsSync(BLOCKED_FILE)) blockedByPhone = JSON.parse(fs.readFileSync(BLOCKED_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar bloqueados:', err.message); }
}
function saveBlockedLocal() {
  fs.writeFile(BLOCKED_FILE, JSON.stringify(blockedByPhone), (err) => { if (err) console.error('Erro ao salvar bloqueados:', err.message); });
}

// ==================== LISTAS DE TRANSMISSÃO ====================
// Cada lista pertence só a quem a criou (guardada por telefone). Enviar para
// uma lista não cria nenhuma "sala" nova — o cliente reaproveita o envio
// normal de mensagem 1-para-1, disparado uma vez por cada membro da lista,
// para que cada pessoa a receba como conversa privada normal, sem saber
// quem mais está na lista nem ver as respostas dos outros.
const BROADCASTS_FILE = path.join(__dirname, 'broadcasts.json');
let broadcastsByPhone = {}; // phone -> [{id, name, members:[phone,...]}]
function loadBroadcastsLocal() {
  try { if (fs.existsSync(BROADCASTS_FILE)) broadcastsByPhone = JSON.parse(fs.readFileSync(BROADCASTS_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar listas de transmissão:', err.message); }
}
function saveBroadcastsLocal() {
  fs.writeFile(BROADCASTS_FILE, JSON.stringify(broadcastsByPhone), (err) => { if (err) console.error('Erro ao salvar listas de transmissão:', err.message); });
}

// ==================== PASTAS/ETIQUETAS PARA ORGANIZAR CONVERSAS ====================
// Cada pasta pertence só a quem a criou — é só uma forma pessoal de organizar
// a própria lista de conversas (ex.: "Trabalho", "Família"), não afeta quem
// mais vê essas conversas nem precisa de sincronizar com mais ninguém.
const FOLDERS_FILE = path.join(__dirname, 'folders.json');
let foldersByPhone = {}; // phone -> [{id, name, chatIds:[chatId,...]}]
function loadFoldersLocal() {
  try { if (fs.existsSync(FOLDERS_FILE)) foldersByPhone = JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar pastas de conversas:', err.message); }
}
function saveFoldersLocal() {
  fs.writeFile(FOLDERS_FILE, JSON.stringify(foldersByPhone), (err) => { if (err) console.error('Erro ao salvar pastas de conversas:', err.message); });
}

// ==================== FAVORITOS DO TURISMO ====================
// Guarda pontos de interesse para uma lista pessoal — organização própria,
// tal como as pastas de conversas acima, sem afetar mais ninguém.
const TOURISM_FAVORITES_FILE = path.join(__dirname, 'tourism-favorites.json');
let tourismFavoritesByPhone = {}; // phone -> [{id, title, lat, lon, wikiTitle}]
function loadTourismFavoritesLocal() {
  try { if (fs.existsSync(TOURISM_FAVORITES_FILE)) tourismFavoritesByPhone = JSON.parse(fs.readFileSync(TOURISM_FAVORITES_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar favoritos de turismo:', err.message); }
}
function saveTourismFavoritesLocal() {
  fs.writeFile(TOURISM_FAVORITES_FILE, JSON.stringify(tourismFavoritesByPhone), (err) => { if (err) console.error('Erro ao salvar favoritos de turismo:', err.message); });
}

// ==================== LISTA DE COMPRAS ====================
// Lista pessoal (por conta, como as notas/favoritos acima) — não é reiniciada
// automaticamente todo o mês: fica sempre ativa até se tocar em "Finalizar",
// que arquiva os artigos atuais no histórico (com data e total) e limpa a
// lista para recomeçar, dando o mesmo efeito de "mês novo" sem depender de um
// calendário rígido (nem todos fazem compras no mesmo dia do mês).
const SHOPPING_LIST_FILE = path.join(__dirname, 'shopping-list.json');
const MAX_SHOPPING_ITEMS = 200;
const MAX_SHOPPING_HISTORY = 30;
// Ordem fixa = ordem sugerida de corredores no supermercado (mesma lista usada
// no cliente, para agrupar a lista por categoria).
const SHOPPING_CATEGORIES = ['frutas', 'padaria', 'laticinios', 'carnes', 'congelados', 'mercearia', 'bebidas', 'limpeza', 'higiene', 'outros'];
// Unidades de quantidade — "kg"/"g"/"l"/"ml" permitem casas decimais (ex.:
// 1,5 kg de carne), ao contrário de "un" (só faz sentido em número inteiro).
const SHOPPING_UNITS = ['un', 'kg', 'g', 'l', 'ml'];
function parseShoppingQty(rawQty, unit) {
  const value = parseFloat(rawQty);
  if (!Number.isFinite(value) || value <= 0) return 1;
  const clamped = Math.min(999, value);
  return unit === 'un' ? Math.max(1, Math.round(clamped)) : Math.round(clamped * 1000) / 1000;
}
let shoppingListByPhone = {}; // phone -> { items: [{id, name, qty, unit, category, prices: [{id, store, price}], bought}], history: [{id, finalizedAt, items, total}] }
function loadShoppingListLocal() {
  try { if (fs.existsSync(SHOPPING_LIST_FILE)) shoppingListByPhone = JSON.parse(fs.readFileSync(SHOPPING_LIST_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar lista de compras:', err.message); }
}
function saveShoppingListLocal() {
  fs.writeFile(SHOPPING_LIST_FILE, JSON.stringify(shoppingListByPhone), (err) => { if (err) console.error('Erro ao salvar lista de compras:', err.message); });
}
function getMyShoppingList(phone) {
  if (!shoppingListByPhone[phone]) shoppingListByPhone[phone] = { items: [], history: [] };
  return shoppingListByPhone[phone];
}

// ==================== LEMBRETES PESSOAIS ====================
// Pessoais (por conta), com aviso mesmo que a app esteja fechada — reaproveita
// a mesma notificação push já usada para mensagens (sendPushToPhone), em vez
// de criar um mecanismo novo. Um "setInterval" próprio (como o das mensagens
// agendadas) verifica periodicamente quais já venceram.
const REMINDERS_FILE = path.join(__dirname, 'reminders.json');
let remindersByPhone = {}; // phone -> [{id, text, remindAt (epoch ms), notified}]
function loadRemindersLocal() {
  try { if (fs.existsSync(REMINDERS_FILE)) remindersByPhone = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar lembretes:', err.message); }
}
function saveRemindersLocal() {
  fs.writeFile(REMINDERS_FILE, JSON.stringify(remindersByPhone), (err) => { if (err) console.error('Erro ao salvar lembretes:', err.message); });
}

// ==================== DESPESAS FIXAS MENSAIS (RECORRENTES) ====================
// Cada conversa pode ter "modelos" de despesa fixa (ex.: renda, Netflix) que,
// todos os meses, lançam sozinhos uma despesa a sério nessa conversa (ver a
// verificação periódica mais abaixo) — tal como se alguém a tivesse criado à
// mão, reaproveitando o mesmo campo msg.expense da despesa avulsa já
// existente. "dayOfMonth" é limitado ao último dia real do mês em curso (ex.:
// dia 31 num mês de 30 dias cai no dia 30), e "lastPostedKey" (ano-mês, ex.:
// "2026-08") impede lançar a mesma despesa duas vezes no mesmo mês.
const RECURRING_EXPENSES_FILE = path.join(__dirname, 'recurring-expenses.json');
let recurringExpensesByChat = {}; // chatId -> [{id, description, amount, currency, paidBy, participants, dayOfMonth, createdBy, lastPostedKey}]
function loadRecurringExpensesLocal() {
  try { if (fs.existsSync(RECURRING_EXPENSES_FILE)) recurringExpensesByChat = JSON.parse(fs.readFileSync(RECURRING_EXPENSES_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar despesas fixas:', err.message); }
}
function saveRecurringExpensesLocal() {
  fs.writeFile(RECURRING_EXPENSES_FILE, JSON.stringify(recurringExpensesByChat), (err) => { if (err) console.error('Erro ao salvar despesas fixas:', err.message); });
}
function getRoomParticipantPhones(chatId) {
  const phones = new Set();
  (messagesByRoom[chatId] || []).forEach((m) => { if (m.senderPhone) phones.add(m.senderPhone); });
  return [...phones];
}

// ==================== CHAMADA AGENDADA ====================
// Marca uma data/hora para uma chamada de voz/vídeo numa conversa — não liga
// sozinha (ligar de verdade exige pedir câmara/microfone a partir de um toque
// genuíno da pessoa, não dá para automatizar isso em segurança), só avisa as
// duas partes na hora marcada (push + evento em tempo real, ver verificação
// periódica mais abaixo) com um botão de "iniciar chamada agora", que usa o
// mesmo fluxo normal de ligar já existente. Numa conversa 1-para-1 "toPhone"
// vem do cliente (para funcionar mesmo numa conversa nova, sem histórico
// ainda); num grupo usa getRoomParticipantPhones (deriva de quem já falou lá).
const SCHEDULED_CALLS_FILE = path.join(__dirname, 'scheduled-calls.json');
let scheduledCalls = []; // [{id, chatId, callType, scheduledAt, createdByPhone, createdByName, toPhone, notified}]
function loadScheduledCallsLocal() {
  try { if (fs.existsSync(SCHEDULED_CALLS_FILE)) scheduledCalls = JSON.parse(fs.readFileSync(SCHEDULED_CALLS_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar chamadas agendadas:', err.message); }
}
function saveScheduledCallsLocal() {
  fs.writeFile(SCHEDULED_CALLS_FILE, JSON.stringify(scheduledCalls), (err) => { if (err) console.error('Erro ao salvar chamadas agendadas:', err.message); });
}

// ==================== "NÃO INCOMODAR" AGENDADO ====================
// O horário em si (ex.: 22h-7h) fica guardado no aparelho da pessoa (é a
// única forma simples de respeitar o fuso horário local sem complicar o
// servidor). O servidor só guarda se está ATIVO neste preciso momento
// (dndActiveByPhone), que o cliente atualiza a cada minuto — assim o
// servidor sabe se deve ou não enviar notificações push, sem precisar de
// perceber fusos horários.
const dndActiveByPhone = {}; // phone -> true/false

// ==================== ALERTAS DE ESTRADA (tipo Waze — comunitários) ====================
// Polícia, acidente, obras, trânsito, perigo/objeto na via, radar — reportados
// pelos próprios utilizadores e visíveis a todos enquanto navegam, tal como no
// Waze. Cada tipo expira sozinho ao fim de um tempo (mais curto para o que
// muda rápido, como trânsito; mais longo para obras).
const ALERTS_FILE = path.join(__dirname, 'roadalerts.json');
let roadAlerts = []; // [{id, type, lat, lng, reportedBy, reportedAt, expiresAt, confirms, denies}]

// ==================== QUADRO BRANCO SINCRONIZADO (chamadas 1-a-1 e de grupo) ====================
// Histórico de traços por sala, só em memória — permite que quem abra o
// quadro a meio de uma chamada (sobretudo em grupo) veja o que já foi
// desenhado, em vez de começar sempre com um quadro vazio.
const whiteboardState = {}; // { [roomId]: { segments: [...], lastActivity } }
const WHITEBOARD_MAX_SEGMENTS = 3000;
const ALERT_TYPE_TTL_MS = {
  police: 45 * 60 * 1000,
  accident: 2 * 60 * 60 * 1000,
  roadwork: 12 * 60 * 60 * 1000,
  traffic: 45 * 60 * 1000,
  hazard: 3 * 60 * 60 * 1000,
  camera: 30 * 24 * 60 * 60 * 1000 // radar fixo — dura muito mais
};
function loadAlertsLocal() {
  try { if (fs.existsSync(ALERTS_FILE)) roadAlerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar alertas de estrada:', err.message); }
}
function saveAlertsLocal() {
  fs.writeFile(ALERTS_FILE, JSON.stringify(roadAlerts), (err) => { if (err) console.error('Erro ao salvar alertas de estrada:', err.message); });
}
function pruneExpiredAlerts() {
  const now = Date.now();
  const before = roadAlerts.length;
  roadAlerts = roadAlerts.filter((a) => a.expiresAt > now && a.denies < 3);
  if (roadAlerts.length !== before) { saveAlertsLocal(); return true; }
  return false;
}

// ==================== CONTATOS (por pesquisa, não automáticos) ====================
// Antes, todo usuário cadastrado aparecia na lista de todo mundo. Agora só
// aparece quem procuraste pelo nome de utilizador (@username) e escolheste
// "Iniciar conversa", ou quem já te mandou uma mensagem — tal como no
// WhatsApp/Telegram, é preciso saber quem procurar; ninguém aparece sozinho.
const onlinePhones = new Set();
// telefone -> Set de socket.ids ativos dessa pessoa (pode ter mais de um: várias
// abas/dispositivos). Usado para entregar chamadas diretamente à pessoa certa,
// em vez de depender só de "salas" do Socket.IO — que exigiam que o outro lado
// já tivesse (re)entrado na sala daquela conversa. Isso falhava sempre que o
// socket reconectava (ex.: app em segundo plano no telemóvel, Wi-Fi -> 4G,
// servidor reiniciou) porque o socket novo tinha um id novo e ainda não tinha
// entrado em sala nenhuma: a pessoa continuava a parecer "online" mas ficava
// muda para chamadas a chegar — exatamente o sintoma de "toca de um lado só".
const phoneToSockets = {};
function registerPhoneSocket(phone, socketId) {
  if (!phone) return;
  if (!phoneToSockets[phone]) phoneToSockets[phone] = new Set();
  phoneToSockets[phone].add(socketId);
}
function unregisterPhoneSocket(phone, socketId) {
  if (!phone || !phoneToSockets[phone]) return;
  phoneToSockets[phone].delete(socketId);
  if (phoneToSockets[phone].size === 0) delete phoneToSockets[phone];
}
// Entrega um evento diretamente a todos os sockets ativos de um telefone
// (normalmente 1, pode ser mais com várias abas). Devolve true se entregou a
// pelo menos um socket, para o chamador saber se a pessoa está mesmo alcançável.
function deliverToPhone(phone, event, payload, excludeSocketId) {
  const sockets = phoneToSockets[phone];
  if (!sockets || sockets.size === 0) return false;
  let delivered = false;
  sockets.forEach((sid) => {
    if (sid === excludeSocketId) return;
    io.to(sid).emit(event, payload);
    delivered = true;
  });
  return delivered;
}
// Uma conta pode ter até 2 dispositivos ligados ao mesmo tempo (ver /api/login),
// e uma chamada 1-para-1 é entregue a TODOS eles (deliverToPhone acima) — sem
// isto, se a pessoa atendesse ou recusasse num dos aparelhos, o(s) outro(s)
// continuavam a tocar para sempre, sem saberem que a chamada já tinha resposta
// noutro lado. Se a pessoa depois tocasse em "Aceitar" no aparelho esquecido,
// criava uma segunda ligação a tentar responder à mesma chamada já respondida,
// e o lado que ligou recebia uma segunda resposta (SDP) inválida para a mesma
// negociação já fechada.
function notifySiblingDevicesCallTaken(socket) {
  const myPhone = users[socket.id]?.phone;
  if (myPhone) deliverToPhone(myPhone, 'call_taken_elsewhere', {}, socket.id);
}
const roomCallParticipants = {}; // roomId -> Set de socket.ids (Suporta até 20+ pessoas em simultâneo)
const vrRoomParticipants = {}; // roomId -> Map(socket.id -> {socketId, phone, name}) — sala de realidade virtual

const TIC_TAC_TOE_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
function checkGameWinner(board) {
  for (const [a, b, c] of TIC_TAC_TOE_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every((c) => c) ? 'draw' : null;
}

// UNO — jogável tanto em conversas 1-para-1 (2 jogadores fixos) como em
// grupos (quem começa escolhe entre 1 e 5 contactos, total 2 a 6 jogadores).
// Ao contrário do galo/damas, aqui não dá para confiar no cliente para o
// estado inicial: o baralho e a distribuição das cartas têm de ser gerados no
// servidor, senão alguém podia "escolher" as próprias cartas alterando o
// código no navegador. Pela mesma razão a mão de cada jogador nunca é
// incluída no que é enviado para os OUTROS jogadores — só o número de cartas
// que cada um tem (ver sanitizeUnoGame). Simplificações assumidas: sem a
// obrigação de "gritar UNO" com penalização, comprar carta passa sempre a vez
// (não deixa jogar a carta comprada na hora), e o +4 não tem o desafio
// clássico de contestar se quem jogou tinha mesmo uma carta da cor válida.
const UNO_COLORS = ['red', 'yellow', 'green', 'blue'];
const UNO_COLOR_LABEL = { red: '🔴', yellow: '🟡', green: '🟢', blue: '🔵', wild: '🌈' };
const UNO_VALUE_LABEL = { skip: 'Bloqueio', reverse: 'Inverter', draw2: '+2', wild: 'Curinga', wild4: '+4' };
function buildUnoDeck() {
  const deck = [];
  UNO_COLORS.forEach((color) => {
    deck.push({ color, value: '0' });
    for (let n = 1; n <= 9; n++) { deck.push({ color, value: String(n) }); deck.push({ color, value: String(n) }); }
    ['skip', 'reverse', 'draw2'].forEach((value) => { deck.push({ color, value }); deck.push({ color, value }); });
  });
  for (let i = 0; i < 4; i++) { deck.push({ color: 'wild', value: 'wild' }); deck.push({ color: 'wild', value: 'wild4' }); }
  return deck;
}
function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function unoCardPlayable(card, topCard, currentColor) {
  if (card.color === 'wild') return true;
  return card.color === currentColor || card.value === topCard.value;
}
function unoCardLabel(card) {
  return `${UNO_COLOR_LABEL[card.color] || ''}${UNO_VALUE_LABEL[card.value] || card.value}`;
}
function refreshUnoPublicFields(game) {
  game.discardTop = game.discardPile[game.discardPile.length - 1];
  game.discardCount = game.discardPile.length;
  game.drawCount = game.drawPile.length;
  game.handCounts = {};
  game.players.forEach((p) => { game.handCounts[p] = game.hands[p].length; });
}
function sanitizeUnoGame(game, forPhone) {
  const { hands, drawPile, discardPile, ...publicFields } = game;
  const sanitized = { ...publicFields };
  if (forPhone && game.players.includes(forPhone)) sanitized.myHand = hands[forPhone];
  return sanitized;
}
// Enquetes com "esconder resultados até votar": cada destinatário só vê os
// votos reais depois de ter votado (ou depois de a votação encerrar, altura
// em que esconder deixa de fazer sentido). Antes disso os votos vêm sempre
// vazios — a contagem real nunca chega ao browser de quem ainda não votou,
// para não dar para ver os resultados só a abrir as ferramentas de developer.
function sanitizePollForViewer(poll, phone) {
  if (!poll?.hideUntilVoted) return poll;
  // 'resultsHiddenForViewer' é sempre recalculado e sobreposto aqui (nunca
  // apenas acrescentado quando escondido) porque o objeto guardado no
  // servidor é o mesmo para todos os destinatários — sem isto, a "memória"
  // de quando a enquete foi criada (antes de haver qualquer voto) ficava
  // presa nela para sempre, mesmo depois de a pessoa já ter votado.
  const isExpired = !!(poll.expiresAt && Date.now() > poll.expiresAt);
  const hasVoted = poll.options.some((o) => o.votes.includes(phone));
  if (isExpired || hasVoted) return { ...poll, resultsHiddenForViewer: false };
  return { ...poll, options: poll.options.map((o) => ({ text: o.text, votes: [] })), resultsHiddenForViewer: true };
}
function ensureUnoDrawPile(game, needed) {
  while (game.drawPile.length < needed && game.discardPile.length > 1) {
    const top = game.discardPile.pop();
    game.drawPile.push(...shuffleDeck(game.discardPile));
    game.discardPile = [top];
  }
}
function drawUnoCards(game, phone, count) {
  ensureUnoDrawPile(game, count);
  const drawn = game.drawPile.splice(0, count);
  game.hands[phone].push(...drawn);
  return drawn;
}
function advanceUnoTurn(game, steps) {
  const n = game.players.length;
  for (let i = 0; i < steps; i++) game.turnIndex = (game.turnIndex + game.direction + n) % n;
}
async function persistUnoGame(messageId, game) {
  if (isDbConnected) {
    await MessageModel.updateOne({ id: messageId }, { game }).catch((e) => console.error('Erro Mongo (UNO):', e.message));
  } else {
    saveMessagesLocal();
  }
}
function broadcastUnoUpdate(chatId, messageId, game) {
  io.to(chatId).emit('uno_updated', { chatId, messageId, game: sanitizeUnoGame(game, null) });
  game.players.forEach((p) => deliverToPhone(p, 'uno_hand_update', { chatId, messageId, hand: game.hands[p] }));
}

function contactPublicInfo(u) {
  return { name: u.name, phone: u.phone, username: u.username || null, country: u.country, online: u.hideOnlineStatus ? false : onlinePhones.has(u.phone), publicKey: u.publicKey || null, avatarUrl: u.avatarUrl || null, preferredLang: u.preferredLang || null, birthday: u.birthday || null, pixKey: u.pixKey || null };
}

function sendContactsTo(phone) {
  const account = accounts[phone];
  if (!account) return;
  const list = (account.contacts || []).map(cp => accounts[cp] ? contactPublicInfo(accounts[cp]) : null).filter(Boolean);
  Object.entries(users).forEach(([sid, u]) => { if (u.phone === phone) io.to(sid).emit('contacts_update', list); });
}

// Quando alguém fica online/offline ou muda a chave pública, avisa só quem o
// tem nos contactos (para a bolinha/estado atualizar do lado deles)
function notifyContactsOfStatusChange(phone) {
  Object.values(accounts).forEach(acc => { if ((acc.contacts || []).includes(phone)) sendContactsTo(acc.phone); });
}

async function addContact(myPhone, targetPhone) {
  const me = accounts[myPhone];
  if (!me || !accounts[targetPhone] || myPhone === targetPhone) return false;
  if (!me.contacts) me.contacts = [];
  if (me.contacts.includes(targetPhone)) return false;
  me.contacts.push(targetPhone);
  if (isDbConnected) {
    await AccountModel.updateOne({ phone: myPhone }, { contacts: me.contacts }).catch(e => console.error('Erro Mongo (contacts):', e.message));
  } else {
    saveUsers();
  }
  return true;
}

const log = (msg, type = 'INFO') =>
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] [${type}] ${msg}`);

io.on('connection', (socket) => {
  log(`Novo utilizador conectado: ${socket.id}`, 'SOCKET');
  users[socket.id] = { name: 'Anônimo', phone: null, rooms: new Set() };
  // Os grupos abertos continuam visíveis a todos assim que conectas (os privados só depois do
  // login, quando já sabemos o telefone — ver o novo emit em 'user_login'); os contactos só
  // chegam depois do login.
  socket.emit('groups_update', visibleGroupsForPhone(null));

  socket.on('user_login', (userData) => {
    users[socket.id].name = userData?.name || 'Anônimo';
    users[socket.id].phone = userData?.phone || null;
    const myPhone = users[socket.id].phone;
    if (myPhone) {
      onlinePhones.add(myPhone);
      registerPhoneSocket(myPhone, socket.id);
      sendContactsTo(myPhone);
      notifyContactsOfStatusChange(myPhone);
      // Sincroniza de imediato o que é "meu" (não depende de sala nenhuma):
      // histórico de chamadas, mensagens agendadas pendentes, conversas
      // silenciadas e o mural de estados.
      socket.emit('call_log_update', callLogByPhone[myPhone] || []);
      socket.emit('scheduled_messages_list', scheduledMessages.filter((s) => s.senderPhone === myPhone));
      socket.emit('muted_list', mutedByPhone[myPhone] || []);
      socket.emit('archived_list', archivedByPhone[myPhone] || []);
      socket.emit('blocked_list', blockedByPhone[myPhone] || []);
      socket.emit('broadcast_list', broadcastsByPhone[myPhone] || []);
      socket.emit('folders_list', foldersByPhone[myPhone] || []);
      socket.emit('tourism_favorites_list', tourismFavoritesByPhone[myPhone] || []);
      socket.emit('shopping_list_updated', getMyShoppingList(myPhone));
      socket.emit('reminders_list', remindersByPhone[myPhone] || []);
      socket.emit('pinned_chats_list', pinnedChatsByPhone[myPhone] || []);
      socket.emit('groups_update', visibleGroupsForPhone(myPhone)); // agora já sabemos o telefone — inclui os grupos privados de que é membro
      socket.emit('privacy_updated', { hideOnlineStatus: !!accounts[myPhone]?.hideOnlineStatus, hideReadReceipts: !!accounts[myPhone]?.hideReadReceipts });
      pruneExpiredStatuses();
      socket.emit('statuses_update', buildStatusFeed());
    }
    socket.broadcast.emit('user_online', { id: socket.id, name: users[socket.id].name });
  });

  // Procurar alguém pelo nome de utilizador (@username) — não lista ninguém,
  // só devolve resultado se souberes o nome exato.
  socket.on('search_user', (data) => {
    const query = String(data?.username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const myPhone = users[socket.id]?.phone;
    if (!query || !myPhone) return socket.emit('search_user_result', { found: false, query });
    const targetPhone = usernameIndex[query];
    if (!targetPhone || targetPhone === myPhone || !accounts[targetPhone]) {
      return socket.emit('search_user_result', { found: false, query });
    }
    socket.emit('search_user_result', { found: true, query, user: contactPublicInfo(accounts[targetPhone]) });
  });

  // Info pública de uma conta pelo telefone — usado para acertar contas de
  // viagem num GRUPO: o nome de quem pagou/participa só existe como texto
  // nas mensagens (grupos aqui não têm lista fixa de membros a consultar —
  // ver "Dividir despesas de viagem"), por isso o telefone vem de uma
  // mensagem já enviada por essa pessoa nessa conversa, e só depois se
  // pergunta ao servidor a chave Pix/dados públicos dessa conta. Mesmos
  // campos que search_user já expõe — não é uma exposição nova.
  socket.on('get_public_info_by_phone', (data) => {
    const phone = String(data?.phone || '').trim();
    const myPhone = users[socket.id]?.phone;
    if (!phone || !myPhone || !accounts[phone]) return socket.emit('public_info_by_phone_result', { phone, found: false });
    socket.emit('public_info_by_phone_result', { phone, found: true, user: contactPublicInfo(accounts[phone]) });
  });

  // Atualiza a foto de perfil e avisa quem te tem como contacto para verem a nova foto
  socket.on('update_avatar', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !accounts[myPhone] || typeof data?.avatarUrl !== 'string') return;
    accounts[myPhone].avatarUrl = data.avatarUrl;
    if (isDbConnected) {
      await AccountModel.updateOne({ phone: myPhone }, { avatarUrl: data.avatarUrl }).catch(e => console.error('Erro Mongo (avatar):', e.message));
    } else {
      saveUsers();
    }
    notifyContactsOfStatusChange(myPhone);
    socket.emit('avatar_updated', { avatarUrl: data.avatarUrl });
  });

  // Guarda a língua preferida da pessoa (para a tradução automática saber
  // para que língua traduzir as mensagens que ela recebe) e avisa os
  // contactos, para poderem ver que língua a pessoa fala.
  socket.on('set_preferred_lang', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !accounts[myPhone] || typeof data?.lang !== 'string') return;
    accounts[myPhone].preferredLang = data.lang;
    if (isDbConnected) {
      await AccountModel.updateOne({ phone: myPhone }, { preferredLang: data.lang }).catch(e => console.error('Erro Mongo (língua):', e.message));
    } else {
      saveUsers();
    }
    notifyContactsOfStatusChange(myPhone);
    socket.emit('preferred_lang_updated', { lang: data.lang });
  });

  // Guarda/atualiza a data de nascimento (para o lembrete de aniversários dos
  // contactos) e avisa os contactos, para o lembrete deles atualizar também.
  socket.on('set_birthday', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !accounts[myPhone] || typeof data?.birthday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.birthday)) return;
    accounts[myPhone].birthday = data.birthday;
    if (isDbConnected) {
      await AccountModel.updateOne({ phone: myPhone }, { birthday: data.birthday }).catch(e => console.error('Erro Mongo (aniversário):', e.message));
    } else {
      saveUsers();
    }
    notifyContactsOfStatusChange(myPhone);
    socket.emit('birthday_updated', { birthday: data.birthday });
  });

  // Guarda a chave Pix (CPF, telefone, email ou chave aleatória) usada para
  // gerar um código Pix pronto a copiar quando alguém tem de pagar a esta
  // pessoa (ex.: ao acertar contas de viagem — ver "Dividir despesas de
  // viagem"). Puramente opcional e em texto livre — não há forma de validar
  // à distância que uma chave Pix é real sem integrar com o Banco Central,
  // por isso confiamos no que a pessoa introduzir, tal como já acontece com
  // o email no cadastro.
  socket.on('set_pix_key', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !accounts[myPhone] || typeof data?.pixKey !== 'string') return;
    const pixKey = data.pixKey.trim().slice(0, 140);
    accounts[myPhone].pixKey = pixKey || null;
    if (isDbConnected) {
      await AccountModel.updateOne({ phone: myPhone }, { pixKey: accounts[myPhone].pixKey }).catch(e => console.error('Erro Mongo (chave Pix):', e.message));
    } else {
      saveUsers();
    }
    notifyContactsOfStatusChange(myPhone);
    socket.emit('pix_key_updated', { pixKey: accounts[myPhone].pixKey });
  });

  socket.on('set_email', async (data) => {
    const myPhone = users[socket.id]?.phone;
    const account = accounts[myPhone];
    if (!myPhone || !account) return;
    const email = String(data?.email || '').trim();
    // Validação simples de formato — não confirma que a caixa existe de
    // verdade (isso exigiria enviar e esperar um clique de confirmação, fora
    // do âmbito aqui), só evita valores obviamente inválidos.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      socket.emit('email_updated', { email: account.email || '', error: 'Esse email não parece válido.' });
      return;
    }
    // Apagar o email desliga a verificação em duas etapas — sem email não há
    // para onde mandar o código, não faz sentido ficar "ativa" sem efeito.
    if (!email) account.twoFactorEnabled = false;
    account.email = email;
    if (isDbConnected) {
      await AccountModel.updateOne({ phone: myPhone }, { email, twoFactorEnabled: account.twoFactorEnabled }).catch(e => console.error('Erro Mongo (email):', e.message));
    } else {
      saveUsers();
    }
    socket.emit('email_updated', { email, twoFactorEnabled: account.twoFactorEnabled });
  });

  // Guarda a cor de destaque escolhida na personalização da app, para
  // acompanhar a pessoa em qualquer aparelho onde faça login (não é
  // partilhada com contactos, é só uma preferência pessoal de aparência).
  socket.on('update_accent_color', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !accounts[myPhone] || typeof data?.color !== 'string') return;
    if (!/^#[0-9a-fA-F]{6}$/.test(data.color)) return;
    accounts[myPhone].accentColor = data.color;
    if (isDbConnected) {
      await AccountModel.updateOne({ phone: myPhone }, { accentColor: data.color }).catch(e => console.error('Erro Mongo (cor):', e.message));
    } else {
      saveUsers();
    }
  });

  // Guarda o fundo das conversas escolhido (cor, gradiente ou imagem),
  // também pessoal — segue a pessoa entre aparelhos ao fazer login.
  socket.on('update_chat_wallpaper', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !accounts[myPhone] || typeof data?.wallpaper !== 'string') return;
    accounts[myPhone].chatWallpaper = data.wallpaper || null;
    if (isDbConnected) {
      await AccountModel.updateOne({ phone: myPhone }, { chatWallpaper: accounts[myPhone].chatWallpaper }).catch(e => console.error('Erro Mongo (fundo):', e.message));
    } else {
      saveUsers();
    }
  });

  // Adiciona alguém encontrado por pesquisa aos teus contactos (início de conversa)
  socket.on('add_contact', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !data?.phone) return;
    if (await addContact(myPhone, data.phone)) sendContactsTo(myPhone);
  });

  socket.on('create_group', async (data) => {
    const name = (data?.name || '').trim();
    const creatorPhone = users[socket.id]?.phone;
    if (!name || !creatorPhone) return;
    const id = 'group_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const isPrivate = !!data?.private;
    const newGroup = {
      id, name, createdBy: users[socket.id]?.name || 'Alguém', createdByPhone: creatorPhone, createdAt: new Date().toISOString(),
      admins: [creatorPhone], moderators: [], mutedPhones: [], bannedPhones: [],
      private: isPrivate,
      memberPhones: isPrivate ? [creatorPhone] : undefined,
      inviteToken: isPrivate ? crypto.randomBytes(12).toString('hex') : undefined
    };
    groups[id] = newGroup;

    if (isDbConnected) {
      await GroupModel.create(newGroup).catch(e => console.error('Erro Mongo (criar grupo):', e.message));
    } else {
      saveGroupsLocal();
    }

    broadcastGroupsUpdate();
  });

  function isGroupAdmin(group, phone) { return group?.admins?.includes(phone); }
  function isGroupModOrAdmin(group, phone) { return group?.admins?.includes(phone) || group?.moderators?.includes(phone); }

  socket.on('group_set_role', async (data) => {
    const { groupId, targetPhone, role } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || !isGroupAdmin(group, myPhone) || !targetPhone) return;
    group.moderators = group.moderators.filter(p => p !== targetPhone);
    group.admins = group.admins.filter(p => p !== targetPhone);
    if (role === 'admin') group.admins.push(targetPhone);
    else if (role === 'moderator') group.moderators.push(targetPhone);

    if (isDbConnected) {
      await GroupModel.updateOne({ id: groupId }, { admins: group.admins, moderators: group.moderators }).catch(e => console.error('Erro Mongo (cargo do grupo):', e.message));
    } else {
      saveGroupsLocal();
    }
    broadcastGroupsUpdate();
  });

  socket.on('group_mute', async (data) => {
    const { groupId, targetPhone, muted } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || !isGroupModOrAdmin(group, myPhone) || !targetPhone) return;
    group.mutedPhones = group.mutedPhones.filter(p => p !== targetPhone);
    if (muted) group.mutedPhones.push(targetPhone);

    if (isDbConnected) {
      await GroupModel.updateOne({ id: groupId }, { mutedPhones: group.mutedPhones }).catch(e => console.error('Erro Mongo (silenciar no grupo):', e.message));
    } else {
      saveGroupsLocal();
    }
    broadcastGroupsUpdate();
  });

  socket.on('group_kick', async (data) => {
    const { groupId, targetPhone } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || !isGroupAdmin(group, myPhone) || !targetPhone || targetPhone === group.createdByPhone) return;
    if (!group.bannedPhones.includes(targetPhone)) group.bannedPhones.push(targetPhone);
    group.admins = group.admins.filter(p => p !== targetPhone);
    group.moderators = group.moderators.filter(p => p !== targetPhone);
    if (group.memberPhones) group.memberPhones = group.memberPhones.filter(p => p !== targetPhone); // grupo privado — perde o acesso já

    if (isDbConnected) {
      await GroupModel.updateOne({ id: groupId }, { bannedPhones: group.bannedPhones, admins: group.admins, moderators: group.moderators, memberPhones: group.memberPhones }).catch(e => console.error('Erro Mongo (remover do grupo):', e.message));
    } else {
      saveGroupsLocal();
    }
    broadcastGroupsUpdate();
  });

  socket.on('group_unban', async (data) => {
    const { groupId, targetPhone } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || !isGroupAdmin(group, myPhone) || !targetPhone) return;
    group.bannedPhones = group.bannedPhones.filter(p => p !== targetPhone);

    if (isDbConnected) {
      await GroupModel.updateOne({ id: groupId }, { bannedPhones: group.bannedPhones }).catch(e => console.error('Erro Mongo (desbanir do grupo):', e.message));
    } else {
      saveGroupsLocal();
    }
    broadcastGroupsUpdate();
  });

  // Apagar o grupo por completo — só quem o criou pode fazer isto (não basta
  // ser administrador promovido, para evitar que alguém apague o grupo de outra pessoa)
  socket.on('group_delete', async (data) => {
    const { groupId } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || group.createdByPhone !== myPhone) return;
    delete groups[groupId];
    delete messagesByRoom[groupId]; // apaga também o histórico de mensagens desse grupo

    if (isDbConnected) {
      await GroupModel.deleteOne({ id: groupId }).catch(e => console.error('Erro Mongo (apagar grupo):', e.message));
      await MessageModel.deleteMany({ chatId: groupId }).catch(e => console.error('Erro Mongo (apagar mensagens do grupo):', e.message));
    } else {
      saveGroupsLocal();
      saveMessagesLocal();
    }
    broadcastGroupsUpdate();
    io.emit('group_deleted', { groupId });
    log(`🗑️ Grupo "${group.name}" apagado por ${users[socket.id]?.name || myPhone}`, 'GROUP');
  });

  socket.on('join_room', (data) => {
    const user = users[socket.id];
    const roomId = typeof data === 'string' ? data : data?.chatId;
    if (!user || !roomId) return;
    // Conversa 1-para-1: só entra quem é de facto um dos dois participantes
    // (verificado pelos contactos guardados no servidor — ver isDmRoomAllowedForPhone).
    if (!isDmRoomAllowedForPhone(user.phone, roomId)) return;
    // Grupo privado (só por convite): só entra quem já é membro — mesma ideia da
    // verificação acima, mas para grupos fechados em vez de conversas 1-para-1.
    const roomGroup = groups[roomId];
    if (roomGroup && !isGroupMember(roomGroup, user.phone)) return;
    socket.join(roomId);
    user.rooms.add(roomId);
    // Mensagens de UNO guardam a mão de cada jogador — nunca podem ir tal e
    // qual para quem está a entrar na sala, senão qualquer pessoa via as
    // cartas de toda a gente só de abrir a conversa/grupo.
    const history = (messagesByRoom[roomId] || []).map((m) => {
      if (m.game?.type === 'uno') return { ...m, game: sanitizeUnoGame(m.game, user.phone) };
      if (m.poll) return { ...m, poll: sanitizePollForViewer(m.poll, user.phone) };
      return m;
    });
    socket.emit('room_history', { chatId: roomId, messages: history });
    // Aproveita a entrada na sala para sincronizar o estado dessa conversa que
    // não vem no histórico de mensagens: mensagem fixada e mensagens temporárias.
    if (pinnedByRoom[roomId]?.length) socket.emit('message_pinned_received', { chatId: roomId, pins: pinnedByRoom[roomId] });
    if (disappearingByRoom[roomId]) socket.emit('disappearing_updated', { chatId: roomId, seconds: disappearingByRoom[roomId] });
    if (recurringExpensesByChat[roomId]?.length) socket.emit('recurring_expenses_list', { chatId: roomId, list: recurringExpensesByChat[roomId] });
    const roomScheduledCalls = scheduledCalls.filter((c) => c.chatId === roomId);
    if (roomScheduledCalls.length) socket.emit('scheduled_calls_list', { chatId: roomId, list: roomScheduledCalls });
  });

  socket.on('send_message', async (data) => {
    if (!data?.chatId) return;
    const group = groups[data.chatId];
    const myPhone = users[socket.id]?.phone;
    // Mesma proteção do 'join_room': numa conversa 1-para-1 (dm_...), só quem
    // é um dos dois participantes é que pode enviar para lá — senão daria
    // para "escrever" numa conversa privada de outras duas pessoas só por
    // adivinhar os dois números de telefone. Quem inicia a conversa já tem o
    // destinatário nos próprios contactos nesse momento (ver add_contact no
    // fluxo de "pesquisar utilizador"), por isso isto nunca bloqueia uma
    // primeira mensagem legítima.
    if (!group && !isDmRoomAllowedForPhone(myPhone, data.chatId)) return;
    if (group && myPhone) {
      if (!isGroupMember(group, myPhone)) return; // grupo privado — só quem já é membro escreve lá
      if (group.bannedPhones?.includes(myPhone)) return;
      if (group.mutedPhones?.includes(myPhone)) {
        socket.emit('message_rejected', { chatId: data.chatId, reason: 'Foste silenciado neste grupo.' });
        return;
      }
    }
    // Se a pessoa a quem estás a escrever te bloqueou, a mensagem não chega —
    // tal como no WhatsApp, sem aviso explícito de "fostes bloqueado" (para
    // não facilitar contornar o bloqueio).
    if (!group && data.toPhone && myPhone && (blockedByPhone[data.toPhone] || []).includes(myPhone)) {
      return;
    }
    // Conversa 1-para-1: quem recebe a primeira mensagem passa a ter quem
    // enviou nos seus contactos automaticamente, para poder responder sem
    // precisar de o procurar primeiro (tal como receber um SMS de um número novo).
    if (!group && data.toPhone && myPhone) {
      if (await addContact(data.toPhone, myPhone)) sendContactsTo(data.toPhone);
    }
    // Mensagens temporárias: se esta conversa tem "mensagens temporárias"
    // ativas, marca já quando esta mensagem deve desaparecer (ver o
    // intervalo de limpeza mais abaixo).
    if (disappearingByRoom[data.chatId]) {
      data.expiresAt = Date.now() + disappearingByRoom[data.chatId] * 1000;
    }
    if (!messagesByRoom[data.chatId]) messagesByRoom[data.chatId] = [];
    messagesByRoom[data.chatId].push(data);
    if (messagesByRoom[data.chatId].length > MAX_HISTORY_PER_ROOM) {
      messagesByRoom[data.chatId] = messagesByRoom[data.chatId].slice(-MAX_HISTORY_PER_ROOM);
    }

    if (isDbConnected) {
      try {
        await MessageModel.create({ ...data });
      } catch (e) {
        console.error('Erro ao guardar mensagem na base de dados:', e.message);
      }
    } else {
      saveMessagesLocal();
    }

    socket.to(data.chatId).emit('receive_message', data);

    // Notificação push (mesmo com a app fechada) — conversas 1-para-1 e grupos.
    const senderName = data.sender || 'Alguém';
    const preview = data.encrypted ? 'Enviou uma mensagem' : (data.fileType?.startsWith('image/') ? '📷 Enviou uma foto' : (data.fileType?.startsWith('video/') ? '🎥 Enviou um vídeo' : (data.fileType?.startsWith('audio/') ? '🎤 Enviou um áudio' : (data.fileData ? '📎 Enviou um ficheiro' : (data.text || '').substring(0, 100)))));
    if (!group && data.toPhone) {
      const recipientMuted = (mutedByPhone[data.toPhone] || []).includes(data.chatId);
      const recipientDnd = !!dndActiveByPhone[data.toPhone];
      if (!recipientMuted && !recipientDnd) {
        sendPushToPhone(data.toPhone, { title: senderName, body: preview, chatId: data.chatId }).catch(() => {});
      }
    } else if (group) {
      // Os grupos são visíveis/entram automaticamente a todos os utilizadores
      // cadastrados (funcionam como canais públicos — ver README), por isso a
      // notificação alcança a mesma "audiência" que já recebe a mensagem ao
      // vivo, respeitando quem silenciou este grupo ou está em "não incomodar".
      // Quem foi @mencionado (ver README) é a exceção: essa notificação passa
      // por cima do silenciar do grupo, tal como no WhatsApp — mas continua a
      // respeitar "não incomodar".
      const mentionedPhones = new Set(Array.isArray(data.mentions) ? data.mentions.filter((p) => typeof p === 'string') : []);
      Object.values(accounts).forEach((acc) => {
        if (acc.phone === myPhone) return; // não notifica quem enviou
        if (group.bannedPhones?.includes(acc.phone)) return;
        const recipientDnd = !!dndActiveByPhone[acc.phone];
        if (recipientDnd) return;
        const isMentioned = mentionedPhones.has(acc.phone);
        const recipientMuted = (mutedByPhone[acc.phone] || []).includes(data.chatId);
        if (recipientMuted && !isMentioned) return;
        const title = isMentioned ? `${senderName} mencionou-te em ${group.name}` : `${senderName} (${group.name})`;
        sendPushToPhone(acc.phone, { title, body: preview, chatId: data.chatId }).catch(() => {});
      });
    }
  });

  socket.on('typing', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('typing_received', { roomId: data.roomId, name: users[socket.id]?.name });
  });

  socket.on('delete_message', async (data) => {
    if (!data?.chatId || !data?.messageId) return;
    const msgs = messagesByRoom[data.chatId];
    if (msgs) {
      const msg = msgs.find(m => m.id === data.messageId);
      if (msg) { 
        msg.text = 'Mensagem apagada'; 
        msg.deleted = true; 
        msg.fileData = null; 
        if (isDbConnected) {
          await MessageModel.updateOne({ id: data.messageId }, { text: 'Mensagem apagada', deleted: true, fileData: null }).catch(e => console.error('Erro Mongo (apagar mensagem):', e.message));
        } else {
          saveMessagesLocal();
        }
      }
    }
    socket.to(data.chatId).emit('message_deleted_received', data);
  });

  // Foto "ver uma vez" — só quem RECEBEU pode marcar como aberta (quem enviou
  // já tem o seu próprio ficheiro, não precisa de o "abrir" para o ter), e só
  // a primeira vez conta: o ficheiro é apagado do servidor logo a seguir, para
  // não haver forma de o voltar a ver (novo dispositivo, reload, etc.).
  socket.on('view_once_opened', async (data) => {
    if (!data?.chatId || !data?.messageId) return;
    const msgs = messagesByRoom[data.chatId];
    const myPhone = users[socket.id]?.phone;
    if (!msgs || !myPhone) return;
    const msg = msgs.find(m => m.id === data.messageId);
    if (!msg || !msg.viewOnce || msg.viewOnceOpened || msg.senderPhone === myPhone) return;
    msg.viewOnceOpened = true;
    msg.fileData = null;
    if (isDbConnected) {
      await MessageModel.updateOne({ id: data.messageId }, { viewOnceOpened: true, fileData: null }).catch(e => console.error('Erro Mongo (ver uma vez):', e.message));
    } else {
      saveMessagesLocal();
    }
    socket.to(data.chatId).emit('view_once_opened_received', { chatId: data.chatId, messageId: data.messageId });
  });

  // Editar uma mensagem já enviada — só quem a enviou pode editar, e só
  // mensagens de texto normais (uma mensagem encriptada ponta-a-ponta não dá
  // para editar aqui porque o servidor nunca vê o texto para poder validar
  // o dono nem guardar a versão nova cifrada corretamente).
  socket.on('edit_message', async (data) => {
    if (!data?.chatId || !data?.messageId || typeof data.newText !== 'string' || !data.newText.trim()) return;
    const msgs = messagesByRoom[data.chatId];
    const myPhone = users[socket.id]?.phone;
    if (!msgs || !myPhone) return;
    const msg = msgs.find(m => m.id === data.messageId);
    if (!msg || msg.senderPhone !== myPhone || msg.deleted || msg.encrypted || msg.fileData) return;
    msg.text = data.newText.trim();
    msg.edited = true;
    if (isDbConnected) {
      await MessageModel.updateOne({ id: data.messageId }, { text: msg.text, edited: true }).catch(e => console.error('Erro Mongo (editar mensagem):', e.message));
    } else {
      saveMessagesLocal();
    }
    socket.to(data.chatId).emit('message_edited_received', { chatId: data.chatId, messageId: data.messageId, newText: msg.text });
  });

  socket.on('react_message', async (data) => {
    if (!data?.chatId || !data?.messageId || !data?.emoji) return;
    const msgs = messagesByRoom[data.chatId];
    if (msgs) {
      const msg = msgs.find(m => m.id === data.messageId);
      if (msg) {
        if (!msg.reactions) msg.reactions = {};
        const who = users[socket.id]?.phone || socket.id;
        if (!msg.reactions[data.emoji]) msg.reactions[data.emoji] = [];
        if (!msg.reactions[data.emoji].includes(who)) msg.reactions[data.emoji].push(who);
        
        if (isDbConnected) {
          await MessageModel.updateOne({ id: data.messageId }, { reactions: msg.reactions }).catch(e => console.error('Erro Mongo (reação):', e.message));
        } else {
          saveMessagesLocal();
        }
      }
    }
    socket.to(data.chatId).emit('reaction_received', { ...data, who: users[socket.id]?.phone || socket.id });
  });

  // Voto numa enquete — uma escolha por pessoa (votar noutra opção troca o
  // voto; votar na mesma opção outra vez retira-o). A mensagem da enquete em
  // si já chegou pelo 'send_message' normal (com um campo 'poll'), isto só
  // atualiza os votos guardados nela.
  socket.on('vote_poll', async (data) => {
    if (!data?.chatId || !data?.messageId || typeof data?.optionIndex !== 'number') return;
    const msgs = messagesByRoom[data.chatId];
    const myPhone = users[socket.id]?.phone;
    if (!msgs || !myPhone) return;
    const msg = msgs.find(m => m.id === data.messageId);
    if (!msg || !msg.poll?.options?.[data.optionIndex]) return;
    if (msg.poll.expiresAt && Date.now() > msg.poll.expiresAt) return; // enquete já encerrada — validado aqui, não só na aparência
    const alreadyVotedHere = msg.poll.options[data.optionIndex].votes.includes(myPhone);
    msg.poll.options.forEach((opt) => { opt.votes = opt.votes.filter((p) => p !== myPhone); });
    if (!alreadyVotedHere) msg.poll.options[data.optionIndex].votes.push(myPhone);
    if (isDbConnected) {
      await MessageModel.updateOne({ id: data.messageId }, { poll: msg.poll }).catch((e) => console.error('Erro Mongo (voto enquete):', e.message));
    } else {
      saveMessagesLocal();
    }
    (io.sockets.adapter.rooms.get(data.chatId) || []).forEach((sid) => {
      const viewerPhone = users[sid]?.phone;
      io.to(sid).emit('poll_updated', { chatId: data.chatId, messageId: data.messageId, poll: sanitizePollForViewer(msg.poll, viewerPhone) });
    });
  });

  // Jogo do galo dentro de uma conversa 1-para-1 — X é sempre quem começou o
  // jogo, O é sempre a outra pessoa (ver 'players' guardado na mensagem).
  // Validação de turno e deteção de vitória feitas aqui, não no cliente, para
  // não dar para fazer batota alterando o código no navegador.
  socket.on('move_game', async (data) => {
    if (!data?.chatId || !data?.messageId || typeof data?.cell !== 'number' || data.cell < 0 || data.cell > 8) return;
    const msgs = messagesByRoom[data.chatId];
    const myPhone = users[socket.id]?.phone;
    if (!msgs || !myPhone) return;
    const msg = msgs.find((m) => m.id === data.messageId);
    if (!msg?.game || msg.game.type === 'checkers' || msg.game.winner || msg.game.board[data.cell]) return;
    const myMark = msg.game.players[0] === myPhone ? 'X' : (msg.game.players[1] === myPhone ? 'O' : null);
    if (!myMark || myMark !== msg.game.turn) return;
    msg.game.board[data.cell] = myMark;
    msg.game.winner = checkGameWinner(msg.game.board);
    msg.game.turn = myMark === 'X' ? 'O' : 'X';
    if (isDbConnected) {
      await MessageModel.updateOne({ id: data.messageId }, { game: msg.game }).catch((e) => console.error('Erro Mongo (jogo do galo):', e.message));
    } else {
      saveMessagesLocal();
    }
    io.to(data.chatId).emit('game_updated', { chatId: data.chatId, messageId: data.messageId, game: msg.game });
  });

  // Damas — versão simplificada (ver comentário no cliente): captura opcional,
  // um movimento por turno mesmo que fosse possível encadear outra captura.
  // X é sempre "owner" 0 (peças 🔴), O é sempre "owner" 1 (peças ⚪).
  socket.on('move_checkers', async (data) => {
    if (!data?.chatId || !data?.messageId || typeof data?.from !== 'number' || typeof data?.to !== 'number') return;
    if (data.from < 0 || data.from > 63 || data.to < 0 || data.to > 63) return;
    const msgs = messagesByRoom[data.chatId];
    const myPhone = users[socket.id]?.phone;
    if (!msgs || !myPhone) return;
    const msg = msgs.find((m) => m.id === data.messageId);
    if (!msg?.game || msg.game.type !== 'checkers' || msg.game.winner) return;
    const myMark = msg.game.players[0] === myPhone ? 'X' : (msg.game.players[1] === myPhone ? 'O' : null);
    if (!myMark || myMark !== msg.game.turn) return;
    const myOwner = myMark === 'X' ? 0 : 1;
    const board = msg.game.board;
    const piece = board[data.from];
    if (!piece || piece.owner !== myOwner || board[data.to]) return;
    const fr = Math.floor(data.from / 8), fc = data.from % 8;
    const tr = Math.floor(data.to / 8), tc = data.to % 8;
    const dr = tr - fr, dc = tc - fc;
    if (Math.abs(dr) !== Math.abs(dc) || (Math.abs(dr) !== 1 && Math.abs(dr) !== 2)) return;
    const dist = Math.abs(dr);
    const forward = myOwner === 0 ? 1 : -1;
    if (!piece.king && dr !== forward * dist) return; // peças normais só andam/capturam para a frente
    let capturedIdx = null;
    if (dist === 2) {
      const mr = fr + dr / 2, mc = fc + dc / 2;
      capturedIdx = mr * 8 + mc;
      const midPiece = board[capturedIdx];
      if (!midPiece || midPiece.owner === myOwner) return;
    }
    board[data.to] = board[data.from];
    board[data.from] = null;
    if (capturedIdx !== null) board[capturedIdx] = null;
    if ((myOwner === 0 && tr === 7) || (myOwner === 1 && tr === 0)) board[data.to].king = true;
    const opponent = myOwner === 0 ? 1 : 0;
    const opponentHasPieces = board.some((p) => p && p.owner === opponent);
    msg.game.winner = opponentHasPieces ? null : myMark;
    msg.game.turn = myMark === 'X' ? 'O' : 'X';
    msg.game.lastMove = { from: data.from, to: data.to }; // para os dois lados verem onde foi a última jogada
    if (isDbConnected) {
      await MessageModel.updateOne({ id: data.messageId }, { game: msg.game }).catch((e) => console.error('Erro Mongo (damas):', e.message));
    } else {
      saveMessagesLocal();
    }
    io.to(data.chatId).emit('game_updated', { chatId: data.chatId, messageId: data.messageId, game: msg.game });
  });

  // Começar um jogo de UNO — dentro de uma conversa 1-para-1 os jogadores são
  // sempre as duas pessoas da conversa; num grupo, quem começa escolheu no
  // cliente entre 1 e 5 contactos para jogar (2 a 6 jogadores no total). O
  // baralho, a distribuição e a primeira carta do descarte são todos gerados
  // aqui, nunca confiando no que o cliente manda para isto.
  socket.on('start_uno', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !data?.chatId || !Array.isArray(data.players)) return;
    const isGroup = !!groups[data.chatId];
    let players = [...new Set(data.players.filter((p) => typeof p === 'string' && p))];
    if (!players.includes(myPhone)) players.unshift(myPhone);
    players = players.slice(0, 6);
    if (players.length < 2) return;
    if (!isGroup && players.length !== 2) return;

    const deck = shuffleDeck(buildUnoDeck());
    const hands = {};
    players.forEach((p) => { hands[p] = deck.splice(0, 7); });
    let firstIdx = deck.findIndex((c) => c.color !== 'wild' && !['skip', 'reverse', 'draw2'].includes(c.value));
    if (firstIdx === -1) firstIdx = 0;
    const firstCard = deck.splice(firstIdx, 1)[0];

    const game = {
      type: 'uno', players, turnIndex: 0, direction: 1, currentColor: firstCard.color, winner: null,
      lastAction: 'Jogo criado — cartas distribuídas!', hands, drawPile: deck, discardPile: [firstCard]
    };
    refreshUnoPublicFields(game);

    const msgId = 'uno_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const msg = {
      id: msgId, chatId: data.chatId, sender: users[socket.id]?.name || 'Alguém', senderPhone: myPhone,
      toPhone: isGroup ? undefined : players.find((p) => p !== myPhone), text: '', time, game
    };
    if (!messagesByRoom[data.chatId]) messagesByRoom[data.chatId] = [];
    messagesByRoom[data.chatId].push(msg);
    if (messagesByRoom[data.chatId].length > MAX_HISTORY_PER_ROOM) {
      messagesByRoom[data.chatId] = messagesByRoom[data.chatId].slice(-MAX_HISTORY_PER_ROOM);
    }
    if (isDbConnected) {
      await MessageModel.create({ ...msg }).catch((e) => console.error('Erro Mongo (criar UNO):', e.message));
    } else {
      saveMessagesLocal();
    }

    io.to(data.chatId).emit('receive_message', { ...msg, game: sanitizeUnoGame(game, null) });
    players.forEach((p) => deliverToPhone(p, 'uno_hand_update', { chatId: data.chatId, messageId: msgId, hand: hands[p] }));

    const senderName = users[socket.id]?.name || 'Alguém';
    players.forEach((p) => {
      if (p === myPhone) return;
      const recipientMuted = (mutedByPhone[p] || []).includes(data.chatId);
      const recipientDnd = !!dndActiveByPhone[p];
      if (!recipientMuted && !recipientDnd) {
        sendPushToPhone(p, { title: senderName, body: '🃏 Começou um jogo de UNO!', chatId: data.chatId }).catch(() => {});
      }
    });
  });

  // Jogar uma carta de UNO — toda a validação (é a tua vez, a carta está
  // mesmo na tua mão, bate com o topo do descarte) é feita aqui, nunca
  // confiando no cliente. Curinga/'+4' exigem 'chosenColor'.
  socket.on('play_uno_card', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !data?.chatId || !data?.messageId || typeof data?.cardIndex !== 'number') return;
    const msgs = messagesByRoom[data.chatId];
    const msg = msgs?.find((m) => m.id === data.messageId);
    const game = msg?.game;
    if (!game || game.type !== 'uno' || game.winner) return;
    if (game.players[game.turnIndex] !== myPhone) return;
    const hand = game.hands[myPhone];
    const card = hand?.[data.cardIndex];
    if (!card) return;
    const topCard = game.discardPile[game.discardPile.length - 1];
    if (!unoCardPlayable(card, topCard, game.currentColor)) return;
    if (card.color === 'wild' && !UNO_COLORS.includes(data.chosenColor)) return;

    hand.splice(data.cardIndex, 1);
    game.discardPile.push(card);
    game.lastAction = `${users[socket.id]?.name || 'Alguém'} jogou ${unoCardLabel(card)}`;

    if (hand.length === 0) {
      game.winner = myPhone;
    } else {
      game.currentColor = card.color === 'wild' ? data.chosenColor : card.color;
      const twoPlayers = game.players.length === 2;
      if (card.value === 'reverse') {
        if (twoPlayers) advanceUnoTurn(game, 2);
        else { game.direction *= -1; advanceUnoTurn(game, 1); }
      } else if (card.value === 'skip') {
        advanceUnoTurn(game, 2);
      } else if (card.value === 'draw2') {
        advanceUnoTurn(game, 1);
        drawUnoCards(game, game.players[game.turnIndex], 2);
        advanceUnoTurn(game, 1);
      } else if (card.value === 'wild4') {
        advanceUnoTurn(game, 1);
        drawUnoCards(game, game.players[game.turnIndex], 4);
        advanceUnoTurn(game, 1);
      } else {
        advanceUnoTurn(game, 1);
      }
    }
    refreshUnoPublicFields(game);
    await persistUnoGame(data.messageId, game);
    broadcastUnoUpdate(data.chatId, data.messageId, game);
  });

  // Comprar carta — sempre passa a vez logo a seguir (simplificação: não deixa
  // jogar de imediato a carta comprada, mesmo que fosse válida).
  socket.on('draw_uno_card', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !data?.chatId || !data?.messageId) return;
    const msgs = messagesByRoom[data.chatId];
    const msg = msgs?.find((m) => m.id === data.messageId);
    const game = msg?.game;
    if (!game || game.type !== 'uno' || game.winner) return;
    if (game.players[game.turnIndex] !== myPhone) return;
    drawUnoCards(game, myPhone, 1);
    game.lastAction = `${users[socket.id]?.name || 'Alguém'} comprou uma carta`;
    advanceUnoTurn(game, 1);
    refreshUnoPublicFields(game);
    await persistUnoGame(data.messageId, game);
    broadcastUnoUpdate(data.chatId, data.messageId, game);
  });

  socket.on('message_read', (data) => {
    if (!data?.chatId) return;
    const myPhone = users[socket.id]?.phone;
    if (myPhone && accounts[myPhone]?.hideReadReceipts) return;
    socket.to(data.chatId).emit('message_read_received', { chatId: data.chatId, reader: myPhone });
  });

  // Privacidade: esconder o estado online e/ou não enviar confirmação de
  // leitura (✓✓ azul) aos outros. É só de um lado (não recíproco, ao
  // contrário do WhatsApp) — mais simples, e o utilizador continua a ver o
  // estado/confirmações dos outros normalmente.
  socket.on('set_privacy', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !accounts[myPhone]) return;
    const hideOnlineStatus = !!data?.hideOnlineStatus;
    const hideReadReceipts = !!data?.hideReadReceipts;
    accounts[myPhone].hideOnlineStatus = hideOnlineStatus;
    accounts[myPhone].hideReadReceipts = hideReadReceipts;
    if (isDbConnected) {
      await AccountModel.updateOne({ phone: myPhone }, { hideOnlineStatus, hideReadReceipts }).catch(e => console.error('Erro Mongo (privacidade):', e.message));
    } else {
      saveUsers();
    }
    notifyContactsOfStatusChange(myPhone);
    socket.emit('privacy_updated', { hideOnlineStatus, hideReadReceipts });
  });

  socket.on('set_two_factor', async (data) => {
    const myPhone = users[socket.id]?.phone;
    const account = accounts[myPhone];
    if (!myPhone || !account) return;
    const enabled = !!data?.enabled;
    if (enabled && !account.email) {
      socket.emit('two_factor_updated', { twoFactorEnabled: false, error: 'Define um email no teu perfil antes de ativares isto — é para lá que o código de verificação é enviado.' });
      return;
    }
    account.twoFactorEnabled = enabled;
    if (isDbConnected) {
      await AccountModel.updateOne({ phone: myPhone }, { twoFactorEnabled: enabled }).catch(e => console.error('Erro Mongo (2FA):', e.message));
    } else {
      saveUsers();
    }
    socket.emit('two_factor_updated', { twoFactorEnabled: enabled });
  });

  // Chamadas 1-para-1: entregues diretamente ao(s) socket(s) do telefone-alvo
  // (ver phoneToSockets acima), não por sala — assim funciona mesmo que o
  // outro lado ainda não tenha (re)entrado na sala daquela conversa. Se
  // 'targetPhone' não vier (cliente antigo em cache), cai para o
  // comportamento antigo por sala.
  socket.on('call_user', (data) => {
    const myPhone = users[socket.id]?.phone;
    if (data.targetPhone && myPhone && (blockedByPhone[data.targetPhone] || []).includes(myPhone)) {
      socket.emit('call_unavailable', { targetRoomId: data.targetRoomId, reason: 'blocked' });
      return;
    }
    const delivered = data.targetPhone
      ? deliverToPhone(data.targetPhone, 'incoming_call', data, socket.id)
      : (socket.to(data.targetRoomId).emit('incoming_call', data), true);
    if (!delivered) {
      socket.emit('call_unavailable', { targetRoomId: data.targetRoomId, reason: 'offline' });
      log(`📵 Chamada para ${data.targetPhone || data.targetRoomId} não entregue — utilizador offline/sem socket ativo`, 'WEBRTC');
    }
  });
  socket.on('answer_call', (data) => {
    if (data.targetPhone) deliverToPhone(data.targetPhone, 'call_answered', data, socket.id);
    else socket.to(data.targetRoomId).emit('call_answered', data);
    notifySiblingDevicesCallTaken(socket);
  });
  socket.on('ice_candidate', (data) => {
    if (data.targetPhone) deliverToPhone(data.targetPhone, 'ice_candidate_received', data, socket.id);
    else socket.to(data.targetRoomId).emit('ice_candidate_received', data);
  });
  // Renegociação (ICE restart) de uma chamada 1-para-1 já em curso — ver o
  // comentário em "renegotiate_offer" do lado do cliente para o porquê disto
  // existir: sem isto, "pc.restartIce()" não fazia mesmo nada (só marca a
  // necessidade internamente; sem um novo offer/answer trocado por aqui,
  // nunca chega a acontecer de verdade), e uma chamada que sofresse um
  // problema de rede breve ficava presa "ligada" para sempre sem imagem/som.
  socket.on('renegotiate_offer', (data) => {
    if (data.targetPhone) deliverToPhone(data.targetPhone, 'renegotiate_offer_received', data, socket.id);
    else socket.to(data.targetRoomId).emit('renegotiate_offer_received', data);
  });
  socket.on('renegotiate_answer', (data) => {
    if (data.targetPhone) deliverToPhone(data.targetPhone, 'renegotiate_answer_received', data, socket.id);
    else socket.to(data.targetRoomId).emit('renegotiate_answer_received', data);
  });
  socket.on('end_call', (data) => {
    if (data.targetPhone) deliverToPhone(data.targetPhone, 'call_ended', data, socket.id);
    else socket.to(data.targetRoomId).emit('call_ended', data);
    notifySiblingDevicesCallTaken(socket);
  });

  // ==================== MENSAGENS FIXADAS ====================
  socket.on('pin_message', (data) => {
    const { chatId, messageId, text, sender } = data || {};
    if (!chatId || !messageId) return;
    if (!pinnedByRoom[chatId]) pinnedByRoom[chatId] = [];
    if (pinnedByRoom[chatId].some((p) => p.messageId === messageId)) return; // já está fixada
    if (pinnedByRoom[chatId].length >= MAX_PINS_PER_ROOM) {
      socket.emit('message_pin_rejected', { chatId, reason: `Já tens o máximo de ${MAX_PINS_PER_ROOM} mensagens fixadas nesta conversa. Desafixa uma primeiro.` });
      return;
    }
    pinnedByRoom[chatId].push({ messageId, text: (text || '').substring(0, 300), sender: sender || 'Alguém', pinnedAt: Date.now() });
    savePinsLocal();
    io.to(chatId).emit('message_pinned_received', { chatId, pins: pinnedByRoom[chatId] });
  });
  socket.on('unpin_message', (data) => {
    const { chatId, messageId } = data || {};
    if (!chatId) return;
    if (messageId) {
      pinnedByRoom[chatId] = (pinnedByRoom[chatId] || []).filter((p) => p.messageId !== messageId);
    } else {
      // Compatibilidade com clientes antigos (em cache) que ainda mandam só chatId, sem messageId:
      // desafixa a mais recente, tal como o comportamento original de "um pin só" fazia.
      (pinnedByRoom[chatId] || []).pop();
    }
    if (pinnedByRoom[chatId] && pinnedByRoom[chatId].length === 0) delete pinnedByRoom[chatId];
    savePinsLocal();
    io.to(chatId).emit('message_pinned_received', { chatId, pins: pinnedByRoom[chatId] || [] });
  });

  // ==================== MENSAGENS TEMPORÁRIAS ====================
  socket.on('set_disappearing', (data) => {
    const { chatId, seconds } = data || {};
    if (!chatId) return;
    if (seconds > 0) disappearingByRoom[chatId] = seconds; else delete disappearingByRoom[chatId];
    saveDisappearingLocal();
    io.to(chatId).emit('disappearing_updated', { chatId, seconds: disappearingByRoom[chatId] || 0, byName: users[socket.id]?.name || 'Alguém' });
  });

  // ==================== ESTADOS (tipo "stories") ====================
  socket.on('post_status', (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || (!data?.text && !data?.photoData)) return;
    if (!statusesByPhone[myPhone]) statusesByPhone[myPhone] = [];
    const item = {
      id: 'st' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      text: (data.text || '').substring(0, 300),
      photoData: data.photoData || null,
      postedAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      viewedBy: [] // [{phone, name, viewedAt}] — quem já viu este estado
    };
    statusesByPhone[myPhone].push(item);
    saveStatusesLocal();
    io.emit('statuses_update', buildStatusFeed());
  });
  socket.on('delete_status', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { statusId } = data || {};
    if (!myPhone || !statusId || !statusesByPhone[myPhone]) return;
    statusesByPhone[myPhone] = statusesByPhone[myPhone].filter((s) => s.id !== statusId);
    if (!statusesByPhone[myPhone].length) delete statusesByPhone[myPhone];
    saveStatusesLocal();
    io.emit('statuses_update', buildStatusFeed());
  });
  socket.on('get_statuses', () => {
    pruneExpiredStatuses();
    socket.emit('statuses_update', buildStatusFeed());
  });
  // Confirmação de visualização — regista quem viu cada estado (uma vez por
  // pessoa) e avisa quem publicou, tal como o "visto por" do WhatsApp.
  socket.on('view_status', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { ownerPhone, statusId } = data || {};
    if (!myPhone || !ownerPhone || !statusId || myPhone === ownerPhone) return;
    const items = statusesByPhone[ownerPhone];
    const item = items?.find((s) => s.id === statusId);
    if (!item) return;
    if (!item.viewedBy) item.viewedBy = [];
    if (!item.viewedBy.some((v) => v.phone === myPhone)) {
      item.viewedBy.push({ phone: myPhone, name: users[socket.id]?.name || 'Alguém', viewedAt: Date.now() });
      saveStatusesLocal();
      deliverToPhone(ownerPhone, 'statuses_update', buildStatusFeed(), null);
    }
  });

  // ==================== HISTÓRICO DE CHAMADAS ====================
  socket.on('call_log_entry', (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !data) return;
    const entry = {
      id: 'cl' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      peerPhone: data.peerPhone || null,
      peerName: data.peerName || 'Alguém',
      type: data.type === 'video' ? 'video' : 'voice',
      direction: data.direction === 'incoming' ? 'incoming' : 'outgoing',
      status: data.status || 'answered', // 'answered' | 'missed' | 'declined'
      durationSec: data.durationSec || 0,
      timestamp: Date.now()
    };
    if (!callLogByPhone[myPhone]) callLogByPhone[myPhone] = [];
    callLogByPhone[myPhone].unshift(entry);
    callLogByPhone[myPhone] = callLogByPhone[myPhone].slice(0, 200);
    saveCallLogLocal();
    deliverToPhone(myPhone, 'call_log_update', callLogByPhone[myPhone], null);
  });
  socket.on('get_call_log', () => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone) return;
    socket.emit('call_log_update', callLogByPhone[myPhone] || []);
  });
  socket.on('clear_call_log', () => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone) return;
    callLogByPhone[myPhone] = [];
    saveCallLogLocal();
    socket.emit('call_log_update', []);
  });

  // ==================== MENSAGENS AGENDADAS ====================
  const VALID_RECURRENCES = ['daily', 'weekly', 'monthly'];
  socket.on('schedule_message', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { chatId, text, sendAt, toPhone, fileData, fileName, fileType, transcript, recurrence } = data || {};
    if (!myPhone || !chatId || !sendAt || (!text && !fileData)) return;
    if (!groups[chatId] && !isDmRoomAllowedForPhone(myPhone, chatId)) return;
    const entry = {
      id: 'sc' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      chatId, senderPhone: myPhone, senderName: users[socket.id]?.name || 'Alguém',
      toPhone: toPhone || null, text: (text || '').substring(0, 2000), sendAt: Number(sendAt),
      fileData: fileData || null, fileName: fileName || null, fileType: fileType || null, transcript: transcript || null,
      recurrence: VALID_RECURRENCES.includes(recurrence) ? recurrence : null
    };
    scheduledMessages.push(entry);
    saveScheduledLocal();
    socket.emit('scheduled_message_saved', entry);
  });
  socket.on('cancel_scheduled_message', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { id } = data || {};
    if (!myPhone || !id) return;
    scheduledMessages = scheduledMessages.filter((s) => !(s.id === id && s.senderPhone === myPhone));
    saveScheduledLocal();
    socket.emit('scheduled_message_cancelled', { id });
  });
  socket.on('get_scheduled_messages', () => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone) return;
    socket.emit('scheduled_messages_list', scheduledMessages.filter((s) => s.senderPhone === myPhone));
  });

  // ==================== SILENCIAR CONVERSA ====================
  socket.on('set_muted', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { chatId, muted } = data || {};
    if (!myPhone || !chatId) return;
    if (!mutedByPhone[myPhone]) mutedByPhone[myPhone] = [];
    if (muted) { if (!mutedByPhone[myPhone].includes(chatId)) mutedByPhone[myPhone].push(chatId); }
    else { mutedByPhone[myPhone] = mutedByPhone[myPhone].filter((c) => c !== chatId); }
    saveMutedLocal();
  });
  socket.on('get_muted', () => {
    const myPhone = users[socket.id]?.phone;
    socket.emit('muted_list', mutedByPhone[myPhone] || []);
  });

  // ==================== CONVERSAS ARQUIVADAS ====================
  socket.on('set_archived', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { chatId, archived } = data || {};
    if (!myPhone || !chatId) return;
    if (!archivedByPhone[myPhone]) archivedByPhone[myPhone] = [];
    if (archived) { if (!archivedByPhone[myPhone].includes(chatId)) archivedByPhone[myPhone].push(chatId); }
    else { archivedByPhone[myPhone] = archivedByPhone[myPhone].filter((c) => c !== chatId); }
    saveArchivedLocal();
  });
  socket.on('get_archived', () => {
    const myPhone = users[socket.id]?.phone;
    socket.emit('archived_list', archivedByPhone[myPhone] || []);
  });

  // ==================== CONVERSAS FIXADAS NO TOPO ====================
  socket.on('set_pinned_chat', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { chatId, pinned } = data || {};
    if (!myPhone || !chatId) return;
    if (!pinnedChatsByPhone[myPhone]) pinnedChatsByPhone[myPhone] = [];
    if (pinned) {
      // Limite de 5 — o cliente já evita chegar aqui nesse caso (mostra o
      // aviso antes de perguntar ao servidor), isto é só a rede de segurança.
      if (!pinnedChatsByPhone[myPhone].includes(chatId) && pinnedChatsByPhone[myPhone].length < 5) {
        pinnedChatsByPhone[myPhone].push(chatId);
      }
    } else {
      pinnedChatsByPhone[myPhone] = pinnedChatsByPhone[myPhone].filter((c) => c !== chatId);
    }
    savePinnedChatsLocal();
    socket.emit('pinned_chats_list', pinnedChatsByPhone[myPhone]);
  });
  socket.on('get_pinned_chats', () => {
    const myPhone = users[socket.id]?.phone;
    socket.emit('pinned_chats_list', pinnedChatsByPhone[myPhone] || []);
  });

  // ==================== BLOQUEAR/DENUNCIAR UTILIZADOR ====================
  socket.on('block_user', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { phone: targetPhone } = data || {};
    if (!myPhone || !targetPhone || targetPhone === myPhone) return;
    if (!blockedByPhone[myPhone]) blockedByPhone[myPhone] = [];
    if (!blockedByPhone[myPhone].includes(targetPhone)) blockedByPhone[myPhone].push(targetPhone);
    saveBlockedLocal();
    socket.emit('blocked_list', blockedByPhone[myPhone]);
  });
  socket.on('unblock_user', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { phone: targetPhone } = data || {};
    if (!myPhone || !targetPhone || !blockedByPhone[myPhone]) return;
    blockedByPhone[myPhone] = blockedByPhone[myPhone].filter((p) => p !== targetPhone);
    saveBlockedLocal();
    socket.emit('blocked_list', blockedByPhone[myPhone]);
  });
  socket.on('get_blocked', () => {
    const myPhone = users[socket.id]?.phone;
    socket.emit('blocked_list', blockedByPhone[myPhone] || []);
  });
  // Denunciar é uma versão do bloqueio que também fica registada num ficheiro
  // à parte, para uma eventual moderação futura vasculhar — hoje em dia não
  // há painel para isso, mas fica guardado em vez de se perder.
  socket.on('report_user', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { phone: targetPhone, reason } = data || {};
    if (!myPhone || !targetPhone) return;
    if (!blockedByPhone[myPhone]) blockedByPhone[myPhone] = [];
    if (!blockedByPhone[myPhone].includes(targetPhone)) blockedByPhone[myPhone].push(targetPhone);
    saveBlockedLocal();
    fs.appendFile(path.join(__dirname, 'reports.log'), `${new Date().toISOString()} | ${myPhone} denunciou ${targetPhone} | motivo: ${(reason || '(sem motivo)').substring(0, 300)}\n`, () => {});
    socket.emit('blocked_list', blockedByPhone[myPhone]);
  });

  // ==================== LISTAS DE TRANSMISSÃO ====================
  socket.on('get_broadcasts', () => {
    const myPhone = users[socket.id]?.phone;
    socket.emit('broadcast_list', broadcastsByPhone[myPhone] || []);
  });
  socket.on('save_broadcast', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { id, name, members } = data || {};
    if (!myPhone || !name || !Array.isArray(members)) return;
    const cleanMembers = [...new Set(members.filter((p) => p && p !== myPhone))];
    if (!cleanMembers.length) return;
    if (!broadcastsByPhone[myPhone]) broadcastsByPhone[myPhone] = [];
    const existing = id && broadcastsByPhone[myPhone].find((b) => b.id === id);
    if (existing) {
      existing.name = name.substring(0, 60);
      existing.members = cleanMembers;
    } else {
      broadcastsByPhone[myPhone].push({ id: 'bc' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name: name.substring(0, 60), members: cleanMembers });
    }
    saveBroadcastsLocal();
    socket.emit('broadcast_list', broadcastsByPhone[myPhone]);
  });
  socket.on('delete_broadcast', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { id } = data || {};
    if (!myPhone || !id || !broadcastsByPhone[myPhone]) return;
    broadcastsByPhone[myPhone] = broadcastsByPhone[myPhone].filter((b) => b.id !== id);
    saveBroadcastsLocal();
    socket.emit('broadcast_list', broadcastsByPhone[myPhone]);
  });

  // ==================== PASTAS/ETIQUETAS PARA ORGANIZAR CONVERSAS ====================
  socket.on('get_folders', () => {
    const myPhone = users[socket.id]?.phone;
    socket.emit('folders_list', foldersByPhone[myPhone] || []);
  });
  socket.on('save_folder', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { id, name } = data || {};
    if (!myPhone || !name || !name.trim()) return;
    if (!foldersByPhone[myPhone]) foldersByPhone[myPhone] = [];
    const existing = id && foldersByPhone[myPhone].find((f) => f.id === id);
    if (existing) {
      existing.name = name.trim().substring(0, 40);
    } else {
      foldersByPhone[myPhone].push({ id: 'fd' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name: name.trim().substring(0, 40), chatIds: [] });
    }
    saveFoldersLocal();
    socket.emit('folders_list', foldersByPhone[myPhone]);
  });
  socket.on('delete_folder', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { id } = data || {};
    if (!myPhone || !id || !foldersByPhone[myPhone]) return;
    foldersByPhone[myPhone] = foldersByPhone[myPhone].filter((f) => f.id !== id);
    saveFoldersLocal();
    socket.emit('folders_list', foldersByPhone[myPhone]);
  });
  socket.on('set_chat_folder', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { folderId, chatId, inFolder } = data || {};
    if (!myPhone || !folderId || !chatId || !foldersByPhone[myPhone]) return;
    const folder = foldersByPhone[myPhone].find((f) => f.id === folderId);
    if (!folder) return;
    if (!Array.isArray(folder.chatIds)) folder.chatIds = [];
    if (inFolder) { if (!folder.chatIds.includes(chatId)) folder.chatIds.push(chatId); }
    else { folder.chatIds = folder.chatIds.filter((c) => c !== chatId); }
    saveFoldersLocal();
    socket.emit('folders_list', foldersByPhone[myPhone]);
  });

  // ==================== FAVORITOS DO TURISMO ====================
  socket.on('get_tourism_favorites', () => {
    const myPhone = users[socket.id]?.phone;
    socket.emit('tourism_favorites_list', tourismFavoritesByPhone[myPhone] || []);
  });
  socket.on('save_tourism_favorite', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { title, lat, lon, wikiTitle } = data || {};
    if (!myPhone || !title || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!tourismFavoritesByPhone[myPhone]) tourismFavoritesByPhone[myPhone] = [];
    // Evita duplicados óbvios (mesmo sítio guardado duas vezes).
    const alreadySaved = tourismFavoritesByPhone[myPhone].some((f) => f.title === title && Math.abs(f.lat - lat) < 0.0005 && Math.abs(f.lon - lon) < 0.0005);
    if (!alreadySaved) {
      tourismFavoritesByPhone[myPhone].push({ id: 'fav' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title: String(title).substring(0, 200), lat, lon, wikiTitle: wikiTitle || null });
      saveTourismFavoritesLocal();
    }
    socket.emit('tourism_favorites_list', tourismFavoritesByPhone[myPhone]);
  });
  socket.on('delete_tourism_favorite', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { id } = data || {};
    if (!myPhone || !id || !tourismFavoritesByPhone[myPhone]) return;
    tourismFavoritesByPhone[myPhone] = tourismFavoritesByPhone[myPhone].filter((f) => f.id !== id);
    saveTourismFavoritesLocal();
    socket.emit('tourism_favorites_list', tourismFavoritesByPhone[myPhone]);
  });

  // ==================== LISTA DE COMPRAS ====================
  socket.on('add_shopping_item', (data) => {
    const myPhone = users[socket.id]?.phone;
    const name = (data?.name || '').trim();
    if (!myPhone || !name) return;
    const list = getMyShoppingList(myPhone);
    if (list.items.length >= MAX_SHOPPING_ITEMS) return;
    const unit = SHOPPING_UNITS.includes(data?.unit) ? data.unit : 'un';
    const qty = parseShoppingQty(data.qty, unit);
    const category = SHOPPING_CATEGORIES.includes(data?.category) ? data.category : 'outros';
    list.items.push({ id: 'item' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name: name.substring(0, 100), qty, unit, category, prices: [], bought: false });
    saveShoppingListLocal();
    socket.emit('shopping_list_updated', list);
  });
  socket.on('edit_shopping_item', (data) => {
    const myPhone = users[socket.id]?.phone;
    const name = (data?.name || '').trim();
    if (!myPhone || !data?.itemId || !name) return;
    const list = getMyShoppingList(myPhone);
    const item = list.items.find((i) => i.id === data.itemId);
    if (!item) return;
    item.name = name.substring(0, 100);
    if (SHOPPING_UNITS.includes(data?.unit)) item.unit = data.unit;
    item.qty = parseShoppingQty(data.qty, item.unit || 'un');
    if (SHOPPING_CATEGORIES.includes(data?.category)) item.category = data.category;
    saveShoppingListLocal();
    socket.emit('shopping_list_updated', list);
  });
  socket.on('delete_shopping_item', (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !data?.itemId) return;
    const list = getMyShoppingList(myPhone);
    list.items = list.items.filter((i) => i.id !== data.itemId);
    saveShoppingListLocal();
    socket.emit('shopping_list_updated', list);
  });
  socket.on('toggle_shopping_item', (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !data?.itemId) return;
    const list = getMyShoppingList(myPhone);
    const item = list.items.find((i) => i.id === data.itemId);
    if (!item) return;
    item.bought = !item.bought;
    saveShoppingListLocal();
    socket.emit('shopping_list_updated', list);
  });
  socket.on('add_shopping_price', (data) => {
    const myPhone = users[socket.id]?.phone;
    const store = (data?.store || '').trim();
    const price = parseFloat(data?.price);
    if (!myPhone || !data?.itemId || !store || !Number.isFinite(price) || price < 0) return;
    const list = getMyShoppingList(myPhone);
    const item = list.items.find((i) => i.id === data.itemId);
    if (!item) return;
    if (item.prices.length >= 20) return; // limite razoável de lojas comparadas por artigo
    item.prices.push({ id: 'price' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), store: store.substring(0, 60), price });
    saveShoppingListLocal();
    socket.emit('shopping_list_updated', list);
  });
  socket.on('edit_shopping_price', (data) => {
    const myPhone = users[socket.id]?.phone;
    const store = (data?.store || '').trim();
    const price = parseFloat(data?.price);
    if (!myPhone || !data?.itemId || !data?.priceId || !store || !Number.isFinite(price) || price < 0) return;
    const list = getMyShoppingList(myPhone);
    const item = list.items.find((i) => i.id === data.itemId);
    const priceEntry = item?.prices.find((p) => p.id === data.priceId);
    if (!priceEntry) return;
    priceEntry.store = store.substring(0, 60);
    priceEntry.price = price;
    saveShoppingListLocal();
    socket.emit('shopping_list_updated', list);
  });
  socket.on('delete_shopping_price', (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !data?.itemId || !data?.priceId) return;
    const list = getMyShoppingList(myPhone);
    const item = list.items.find((i) => i.id === data.itemId);
    if (!item) return;
    item.prices = item.prices.filter((p) => p.id !== data.priceId);
    saveShoppingListLocal();
    socket.emit('shopping_list_updated', list);
  });
  function computeShoppingTotalServer(items) {
    return items.reduce((sum, item) => {
      const cheapest = item.prices.length ? Math.min(...item.prices.map((p) => p.price)) : 0;
      return sum + cheapest * item.qty;
    }, 0);
  }
  // "Finalizar" arquiva a lista atual no histórico (com data e total, usando o
  // preço mais barato registado de cada artigo) e limpa-a para uma lista nova
  // — dá o mesmo efeito de "fechar o mês" sem depender de nenhuma data fixa.
  socket.on('finalize_shopping_list', () => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone) return;
    const list = getMyShoppingList(myPhone);
    if (!list.items.length) return;
    const total = computeShoppingTotalServer(list.items);
    list.history.unshift({ id: 'hist' + Date.now(), finalizedAt: new Date().toISOString(), items: list.items, total });
    list.history = list.history.slice(0, MAX_SHOPPING_HISTORY);
    list.items = [];
    saveShoppingListLocal();
    socket.emit('shopping_list_updated', list);
  });
  // Corrige um preço numa lista JÁ finalizada (ex.: o valor real do recibo
  // saiu diferente do estimado) — recalcula o total dessa lista arquivada,
  // sem afetar a lista ativa nem outras entradas do histórico.
  socket.on('edit_shopping_history_price', (data) => {
    const myPhone = users[socket.id]?.phone;
    const store = (data?.store || '').trim();
    const price = parseFloat(data?.price);
    if (!myPhone || !data?.historyId || !data?.itemId || !data?.priceId || !store || !Number.isFinite(price) || price < 0) return;
    const list = getMyShoppingList(myPhone);
    const entry = list.history.find((h) => h.id === data.historyId);
    const item = entry?.items.find((i) => i.id === data.itemId);
    const priceEntry = item?.prices.find((p) => p.id === data.priceId);
    if (!priceEntry) return;
    priceEntry.store = store.substring(0, 60);
    priceEntry.price = price;
    entry.total = computeShoppingTotalServer(entry.items);
    saveShoppingListLocal();
    socket.emit('shopping_list_updated', list);
  });

  // ==================== LEMBRETES PESSOAIS ====================
  socket.on('add_reminder', (data) => {
    const myPhone = users[socket.id]?.phone;
    const text = (data?.text || '').trim();
    const remindAt = parseInt(data?.remindAt);
    if (!myPhone || !text || !Number.isFinite(remindAt)) return;
    if (!remindersByPhone[myPhone]) remindersByPhone[myPhone] = [];
    if (remindersByPhone[myPhone].length >= 100) return; // limite razoável
    remindersByPhone[myPhone].push({ id: 'rem' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), text: text.substring(0, 200), remindAt, notified: false });
    saveRemindersLocal();
    socket.emit('reminders_list', remindersByPhone[myPhone]);
  });
  socket.on('delete_reminder', (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !data?.id || !remindersByPhone[myPhone]) return;
    remindersByPhone[myPhone] = remindersByPhone[myPhone].filter((r) => r.id !== data.id);
    saveRemindersLocal();
    socket.emit('reminders_list', remindersByPhone[myPhone]);
  });

  // ==================== DESPESAS FIXAS MENSAIS (RECORRENTES) ====================
  socket.on('add_recurring_expense', (data) => {
    const myPhone = users[socket.id]?.phone;
    const chatId = data?.chatId;
    const description = (data?.description || '').trim();
    const amount = parseFloat(data?.amount);
    const currency = (data?.currency || '').trim();
    const paidBy = (data?.paidBy || '').trim();
    const participants = Array.isArray(data?.participants) ? data.participants.filter((p) => typeof p === 'string' && p.trim()).slice(0, 50) : [];
    const dayOfMonth = parseInt(data?.dayOfMonth);
    if (!myPhone || !chatId || !description || !amount || amount <= 0 || !currency || !paidBy || !participants.length) return;
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return;
    if (!isDmRoomAllowedForPhone(myPhone, chatId)) return;
    if (!recurringExpensesByChat[chatId]) recurringExpensesByChat[chatId] = [];
    if (recurringExpensesByChat[chatId].length >= 30) return; // limite razoável
    recurringExpensesByChat[chatId].push({
      id: 'rec' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      description: description.substring(0, 100), amount, currency, paidBy, participants, dayOfMonth,
      createdBy: myPhone, lastPostedKey: null
    });
    saveRecurringExpensesLocal();
    io.to(chatId).emit('recurring_expenses_list', { chatId, list: recurringExpensesByChat[chatId] });
  });
  socket.on('delete_recurring_expense', (data) => {
    const myPhone = users[socket.id]?.phone;
    const chatId = data?.chatId;
    if (!myPhone || !chatId || !data?.id || !recurringExpensesByChat[chatId]) return;
    if (!isDmRoomAllowedForPhone(myPhone, chatId)) return;
    recurringExpensesByChat[chatId] = recurringExpensesByChat[chatId].filter((r) => r.id !== data.id);
    saveRecurringExpensesLocal();
    io.to(chatId).emit('recurring_expenses_list', { chatId, list: recurringExpensesByChat[chatId] });
  });

  // ==================== CHAMADA AGENDADA ====================
  socket.on('schedule_call', (data) => {
    const myPhone = users[socket.id]?.phone;
    const chatId = data?.chatId;
    const callType = data?.callType === 'voice' ? 'voice' : 'video';
    const scheduledAt = parseInt(data?.scheduledAt);
    const toPhone = typeof data?.toPhone === 'string' && data.toPhone ? data.toPhone : null;
    if (!myPhone || !chatId || !Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) return;
    if (!isDmRoomAllowedForPhone(myPhone, chatId)) return;
    if (scheduledCalls.filter((c) => c.chatId === chatId).length >= 20) return; // limite razoável
    scheduledCalls.push({
      id: 'sc' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      chatId, callType, scheduledAt, toPhone,
      createdByPhone: myPhone, createdByName: users[socket.id]?.name || 'Alguém', notified: false
    });
    saveScheduledCallsLocal();
    io.to(chatId).emit('scheduled_calls_list', { chatId, list: scheduledCalls.filter((c) => c.chatId === chatId) });
  });
  socket.on('cancel_scheduled_call', (data) => {
    const myPhone = users[socket.id]?.phone;
    const chatId = data?.chatId;
    if (!myPhone || !chatId || !data?.id) return;
    if (!isDmRoomAllowedForPhone(myPhone, chatId)) return;
    scheduledCalls = scheduledCalls.filter((c) => !(c.id === data.id && c.chatId === chatId));
    saveScheduledCallsLocal();
    io.to(chatId).emit('scheduled_calls_list', { chatId, list: scheduledCalls.filter((c) => c.chatId === chatId) });
  });

  // ==================== "NÃO INCOMODAR" AGENDADO ====================
  socket.on('set_dnd_active', (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone) return;
    dndActiveByPhone[myPhone] = !!data?.active;
  });

  // ==================== ALERTAS DE ESTRADA (comunitários, tipo Waze) ====================
  const ALERT_TYPES = new Set(['police', 'accident', 'roadwork', 'traffic', 'hazard', 'camera']);
  socket.on('report_alert', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { type, lat, lng } = data || {};
    if (!myPhone || !ALERT_TYPES.has(type) || typeof lat !== 'number' || typeof lng !== 'number') return;
    const now = Date.now();
    const alert = {
      id: 'al' + now + '_' + Math.random().toString(36).slice(2, 7),
      type, lat, lng,
      reportedBy: users[socket.id]?.name || 'Alguém',
      reportedAt: now,
      expiresAt: now + (ALERT_TYPE_TTL_MS[type] || 60 * 60 * 1000),
      confirms: 1, denies: 0
    };
    roadAlerts.push(alert);
    saveAlertsLocal();
    io.emit('road_alerts_update', roadAlerts);
  });
  socket.on('confirm_alert', (data) => {
    const alert = roadAlerts.find((a) => a.id === data?.id);
    if (!alert) return;
    alert.confirms++;
    alert.expiresAt = Math.max(alert.expiresAt, Date.now() + 15 * 60 * 1000); // "ainda lá" renova pelo menos 15min
    saveAlertsLocal();
    io.emit('road_alerts_update', roadAlerts);
  });
  socket.on('dismiss_alert', (data) => {
    const alert = roadAlerts.find((a) => a.id === data?.id);
    if (!alert) return;
    alert.denies++;
    if (alert.denies >= 3) roadAlerts = roadAlerts.filter((a) => a.id !== alert.id); // "já não está" de 3 pessoas remove
    saveAlertsLocal();
    io.emit('road_alerts_update', roadAlerts);
  });
  socket.on('get_road_alerts', () => {
    pruneExpiredAlerts();
    socket.emit('road_alerts_update', roadAlerts);
  });

  // ==================== CONFERÊNCIAS EM GRUPO (Até 20+ participantes em simultâneo) ====================
  socket.on('join_call', (data) => {
    const { roomId, callType } = data || {};
    if (!roomId) return;
    // Garante que este socket está mesmo na sala da conversa/grupo antes de
    // avisar quem lá está — cobre o caso de o cliente ainda não ter reenviado
    // 'join_room' depois de uma reconexão (mesmo problema de fundo das
    // chamadas individuais, ver phoneToSockets acima).
    socket.join(roomId);
    if (!roomCallParticipants[roomId]) roomCallParticipants[roomId] = new Set();
    const isFirst = roomCallParticipants[roomId].size === 0;
    const existing = [...roomCallParticipants[roomId]].map(id => ({ socketId: id, name: users[id]?.name || 'Alguém' }));
    roomCallParticipants[roomId].add(socket.id);
    if (isFirst) {
      socket.to(roomId).emit('group_call_started', { roomId, callType, starterName: users[socket.id]?.name || 'Alguém' });
    }
    socket.to(roomId).emit('peer_joined_call', { socketId: socket.id, name: users[socket.id]?.name || 'Alguém', callType });
    socket.emit('existing_call_participants', { roomId, participants: existing });
    log(`🎥 ${users[socket.id]?.name || socket.id} entrou na conferência (${roomId}) — Total: ${roomCallParticipants[roomId].size}`, 'WEBRTC');
  });

  socket.on('call_offer', (data) => {
    if (!data?.toSocketId) return;
    io.to(data.toSocketId).emit('call_offer_received', { fromSocketId: socket.id, fromName: users[socket.id]?.name, offer: data.offer, roomId: data.roomId });
  });
  socket.on('call_answer', (data) => {
    if (!data?.toSocketId) return;
    io.to(data.toSocketId).emit('call_answer_received', { fromSocketId: socket.id, answer: data.answer });
  });
  socket.on('call_ice', (data) => {
    if (!data?.toSocketId) return;
    io.to(data.toSocketId).emit('call_ice_received', { fromSocketId: socket.id, candidate: data.candidate });
  });

  function leaveCall(roomId) {
    if (roomCallParticipants[roomId]) {
      roomCallParticipants[roomId].delete(socket.id);
      if (roomCallParticipants[roomId].size === 0) delete roomCallParticipants[roomId];
    }
    socket.to(roomId).emit('peer_left_call', { socketId: socket.id });
  }
  socket.on('leave_call', (data) => { if (data?.roomId) leaveCall(data.roomId); });

  // ==================== SALA DE REALIDADE VIRTUAL (avatares em 3D) ====================
  // roomId -> Map(socket.id -> { socketId, phone, name })
  socket.on('join_vr_room', (data) => {
    const roomId = data?.roomId;
    if (!roomId) return;
    if (!vrRoomParticipants[roomId]) vrRoomParticipants[roomId] = new Map();
    const me = { socketId: socket.id, phone: users[socket.id]?.phone || null, name: users[socket.id]?.name || 'Alguém' };
    const existing = [...vrRoomParticipants[roomId].values()];
    vrRoomParticipants[roomId].set(socket.id, me);
    socket.emit('vr_existing_peers', { peers: existing });
    socket.to(roomId).emit('vr_peer_joined', me);
    log(`🕶️ ${me.name} entrou na sala virtual (${roomId})`, 'VR');
  });

  socket.on('vr_position', (data) => {
    const roomId = data?.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('vr_position_received', { socketId: socket.id, x: data.x, y: data.y, z: data.z, rotY: data.rotY });
  });

  function leaveVrRoom(roomId) {
    if (vrRoomParticipants[roomId]) {
      vrRoomParticipants[roomId].delete(socket.id);
      if (vrRoomParticipants[roomId].size === 0) delete vrRoomParticipants[roomId];
    }
    socket.to(roomId).emit('vr_peer_left', { socketId: socket.id });
  }
  socket.on('leave_vr_room', (data) => { if (data?.roomId) leaveVrRoom(data.roomId); });

  // Guarda o histórico de traços por sala (em memória — é um "rascunho" ao
  // vivo, não precisa de sobreviver a um reinício do servidor) para quem
  // abre o quadro branco a meio de uma chamada (sobretudo em grupo, com
  // várias pessoas) ver logo o que já foi desenhado, não um quadro vazio.
  socket.on('whiteboard_draw', (data) => {
    if (!data?.roomId) return;
    const room = whiteboardState[data.roomId] || (whiteboardState[data.roomId] = { segments: [], lastActivity: Date.now() });
    room.segments.push(data);
    if (room.segments.length > WHITEBOARD_MAX_SEGMENTS) room.segments.shift();
    room.lastActivity = Date.now();
    socket.to(data.roomId).emit('whiteboard_draw_received', data);
  });
  socket.on('whiteboard_clear', (data) => {
    if (!data?.roomId) return;
    delete whiteboardState[data.roomId];
    socket.to(data.roomId).emit('whiteboard_clear_received', data);
  });
  socket.on('whiteboard_get_state', (data) => {
    if (!data?.roomId) return;
    socket.emit('whiteboard_state', { roomId: data.roomId, segments: whiteboardState[data.roomId]?.segments || [] });
  });

  socket.on('music_state', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('music_state_received', data);
  });

  socket.on('location_update', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('location_update_received', data);
  });
  socket.on('location_stop', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('location_stop_received', { phone: users[socket.id]?.phone });
  });

  // ==================== ATIVIDADES (estilo Strava) ====================
  socket.on('activity_save', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !data || !data.type || !data.distanceMeters) return;
    const activity = {
      id: 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      phone: myPhone,
      name: users[socket.id]?.name || accounts[myPhone]?.name || 'Alguém',
      type: data.type,
      startTime: data.startTime || new Date().toISOString(),
      distanceMeters: data.distanceMeters,
      durationSeconds: data.durationSeconds || 0,
      avgSpeedKmh: data.avgSpeedKmh || 0,
      elevationGain: data.elevationGain || 0,
      route: Array.isArray(data.route) ? data.route.filter((_, i) => i % 3 === 0) : [], // amostra 1 em cada 3 pontos, chega para desenhar a rota sem pesar demasiado
      kudos: []
    };
    activities.unshift(activity);
    if (activities.length > 500) activities = activities.slice(0, 500);
    if (isDbConnected) {
      await ActivityModel.create(activity).catch(e => console.error('Erro Mongo (atividade):', e.message));
    } else {
      saveActivitiesLocal();
    }
    socket.emit('activity_saved', activity);
  });

  socket.on('activities_feed_request', () => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone) return;
    const visiblePhones = new Set([myPhone, ...(accounts[myPhone]?.contacts || [])]);
    const feed = activities.filter(a => visiblePhones.has(a.phone)).slice(0, 60);
    socket.emit('activities_feed', feed);
  });

  socket.on('activity_kudos', async (data) => {
    const myPhone = users[socket.id]?.phone;
    const activity = activities.find(a => a.id === data?.activityId);
    if (!myPhone || !activity) return;
    if (!activity.kudos) activity.kudos = [];
    const i = activity.kudos.indexOf(myPhone);
    if (i === -1) activity.kudos.push(myPhone); else activity.kudos.splice(i, 1); // toca outra vez para tirar o kudos
    if (isDbConnected) {
      await ActivityModel.updateOne({ id: activity.id }, { kudos: activity.kudos }).catch(e => console.error('Erro Mongo (kudos):', e.message));
    } else {
      saveActivitiesLocal();
    }
    // avisa quem partilha atividades com esta pessoa (donos + quem a tem como contacto) para atualizarem o feed
    io.emit('activity_kudos_updated', { activityId: activity.id, kudos: activity.kudos });
  });

  // ==================== TAREFAS (lista partilhada por conversa, ou pessoal) ====================
  socket.on('todo_get', (data) => {
    const roomId = data?.roomId;
    if (!roomId) return;
    socket.emit('todo_list', { roomId, items: todosByRoom[roomId] || [] });
  });

  socket.on('todo_add', async (data) => {
    const roomId = data?.roomId;
    const text = (data?.text || '').trim();
    if (!roomId || !text) return;
    if (!todosByRoom[roomId]) todosByRoom[roomId] = [];
    const item = { id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), text, done: false, addedBy: users[socket.id]?.name || 'Alguém' };
    todosByRoom[roomId].push(item);
    await persistTodoRoom(roomId);
    io.to(roomId).emit('todo_updated', { roomId, items: todosByRoom[roomId] });
    socket.emit('todo_updated', { roomId, items: todosByRoom[roomId] }); // garante que quem enviou também recebe (mesmo que não esteja "na sala" para listas pessoais)
  });

  socket.on('todo_toggle', async (data) => {
    const roomId = data?.roomId;
    const item = todosByRoom[roomId]?.find(i => i.id === data?.itemId);
    if (!item) return;
    item.done = !item.done;
    await persistTodoRoom(roomId);
    io.to(roomId).emit('todo_updated', { roomId, items: todosByRoom[roomId] });
    socket.emit('todo_updated', { roomId, items: todosByRoom[roomId] });
  });

  socket.on('todo_delete', async (data) => {
    const roomId = data?.roomId;
    if (!todosByRoom[roomId]) return;
    todosByRoom[roomId] = todosByRoom[roomId].filter(i => i.id !== data?.itemId);
    await persistTodoRoom(roomId);
    io.to(roomId).emit('todo_updated', { roomId, items: todosByRoom[roomId] });
    socket.emit('todo_updated', { roomId, items: todosByRoom[roomId] });
  });

  // ==================== NOTAS PESSOAIS ====================
  socket.on('notes_get', () => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone) return;
    socket.emit('notes_list', notesByPhone[myPhone] || []);
  });

  socket.on('notes_save', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || (!data?.text?.trim() && !data?.title?.trim())) return;
    if (!notesByPhone[myPhone]) notesByPhone[myPhone] = [];
    let note;
    if (data.id) {
      note = notesByPhone[myPhone].find(n => n.id === data.id);
    }
    if (note) {
      note.title = data.title || '';
      note.text = data.text || '';
      note.updatedAt = new Date().toISOString();
    } else {
      note = { id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), title: data.title || '', text: data.text || '', updatedAt: new Date().toISOString() };
      notesByPhone[myPhone].unshift(note);
    }
    if (isDbConnected) {
      await NoteModel.updateOne({ id: note.id }, { ...note, phone: myPhone }, { upsert: true }).catch(e => console.error('Erro Mongo (notas):', e.message));
    } else {
      saveNotesLocal();
    }
    socket.emit('notes_list', notesByPhone[myPhone]);
  });

  socket.on('notes_delete', async (data) => {
    const myPhone = users[socket.id]?.phone;
    if (!myPhone || !notesByPhone[myPhone]) return;
    notesByPhone[myPhone] = notesByPhone[myPhone].filter(n => n.id !== data?.id);
    if (isDbConnected) {
      await NoteModel.deleteOne({ id: data?.id, phone: myPhone }).catch(e => console.error('Erro Mongo (apagar nota):', e.message));
    } else {
      saveNotesLocal();
    }
    socket.emit('notes_list', notesByPhone[myPhone]);
  });

  socket.on('call_caption', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('call_caption_received', { text: data.text, name: users[socket.id]?.name || 'Alguém' });
  });

  socket.on('user_logout', () => {
    const user = users[socket.id];
    if (user?.phone) {
      const stillConnected = Object.entries(users).some(([id, u]) => id !== socket.id && u.phone === user.phone);
      if (!stillConnected) { onlinePhones.delete(user.phone); notifyContactsOfStatusChange(user.phone); }
      user.phone = null;
      user.name = 'Anônimo';
    }
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      user.rooms.forEach((room) => socket.to(room).emit('user_left', user.name));
      delete users[socket.id];
      if (user.phone) {
        unregisterPhoneSocket(user.phone, socket.id);
        const stillConnected = Object.values(users).some(u => u.phone === user.phone);
        if (!stillConnected) { onlinePhones.delete(user.phone); notifyContactsOfStatusChange(user.phone); }
      }
    }
    Object.keys(roomCallParticipants).forEach((roomId) => {
      if (roomCallParticipants[roomId].has(socket.id)) {
        roomCallParticipants[roomId].delete(socket.id);
        if (roomCallParticipants[roomId].size === 0) delete roomCallParticipants[roomId];
        socket.to(roomId).emit('peer_left_call', { socketId: socket.id });
      }
    });
    Object.keys(vrRoomParticipants).forEach((roomId) => {
      if (vrRoomParticipants[roomId].has(socket.id)) {
        vrRoomParticipants[roomId].delete(socket.id);
        if (vrRoomParticipants[roomId].size === 0) delete vrRoomParticipants[roomId];
        socket.to(roomId).emit('vr_peer_left', { socketId: socket.id });
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
connectDatabase().then(async () => {
  await initPush();

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    console.log(`☁️ Cloudinary ligado (cloud "${CLOUDINARY_CLOUD_NAME}") — fotos/áudios/documentos passam a ser guardados lá, não em base64.`);
  } else {
    console.log('⚠️ Cloudinary não configurado — fotos/áudios/documentos continuam em base64 (ver secção "Ficheiros em armazenamento externo" no README).');
  }

  // Notícias: primeira busca já no arranque (não bloqueia o servidor — corre
  // em segundo plano) e depois de 10 em 10 minutos.
  refreshNews().catch(e => console.error('Erro ao carregar notícias:', e.message));
  setInterval(() => refreshNews().catch(e => console.error('Erro ao atualizar notícias:', e.message)), 10 * 60 * 1000);

  // Mensagens temporárias: remove periodicamente as que já expiraram e avisa
  // quem está na conversa para as tirar do ecrã.
  setInterval(() => {
    const now = Date.now();
    Object.keys(messagesByRoom).forEach((roomId) => {
      const msgs = messagesByRoom[roomId];
      if (!msgs || !msgs.length) return;
      const remaining = [];
      const removedIds = [];
      msgs.forEach((m) => {
        if (m.expiresAt && m.expiresAt <= now) removedIds.push(m.id);
        else remaining.push(m);
      });
      if (removedIds.length) {
        messagesByRoom[roomId] = remaining;
        if (!isDbConnected) saveMessagesLocal();
        removedIds.forEach((id) => io.to(roomId).emit('message_expired', { chatId: roomId, messageId: id }));
      }
    });
  }, 30 * 1000);

  // Estados: limpa os que passaram das 24h e avisa toda a gente do mural novo.
  setInterval(() => {
    if (pruneExpiredStatuses()) io.emit('statuses_update', buildStatusFeed());
  }, 5 * 60 * 1000);

  // Alertas de estrada: limpa os que expiraram (ou foram muito negados) e
  // avisa quem está a navegar para tirar o marcador do mapa.
  setInterval(() => {
    if (pruneExpiredAlerts()) io.emit('road_alerts_update', roadAlerts);
  }, 2 * 60 * 1000);

  // Quadro branco: apaga o histórico de salas sem nenhum traço novo há
  // várias horas, para não acumular memória com quadros de chamadas antigas.
  setInterval(() => {
    const now = Date.now();
    Object.keys(whiteboardState).forEach((roomId) => {
      if (now - whiteboardState[roomId].lastActivity > 6 * 60 * 60 * 1000) delete whiteboardState[roomId];
    });
  }, 30 * 60 * 1000);

  // Mensagens agendadas: dispara as que já chegaram à hora marcada. As recorrentes
  // não são removidas depois de disparar — ficam com o próximo horário calculado
  // (ver nextRecurrenceTime), continuando na lista para a próxima ocorrência.
  setInterval(async () => {
    const now = Date.now();
    const due = scheduledMessages.filter((s) => s.sendAt <= now);
    if (!due.length) return;
    scheduledMessages = scheduledMessages.filter((s) => s.sendAt > now);
    due.forEach((s) => {
      if (s.recurrence) {
        s.sendAt = nextRecurrenceTime(s.sendAt, s.recurrence, now);
        scheduledMessages.push(s);
      }
    });
    saveScheduledLocal();
    for (const s of due) {
      const msgData = {
        id: 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        chatId: s.chatId, sender: s.senderName, senderPhone: s.senderPhone, toPhone: s.toPhone,
        text: s.text, time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        fileData: s.fileData || null, fileName: s.fileName || null, fileType: s.fileType || null, transcript: s.transcript || null
      };
      if (!messagesByRoom[s.chatId]) messagesByRoom[s.chatId] = [];
      messagesByRoom[s.chatId].push(msgData);
      if (messagesByRoom[s.chatId].length > MAX_HISTORY_PER_ROOM) messagesByRoom[s.chatId] = messagesByRoom[s.chatId].slice(-MAX_HISTORY_PER_ROOM);
      if (isDbConnected) {
        try { await MessageModel.create({ ...msgData }); } catch (e) { console.error('Erro ao guardar mensagem agendada:', e.message); }
      } else {
        saveMessagesLocal();
      }
      // Ao destinatário chega como mensagem normal; ao remetente chega por um
      // evento à parte para não ser confundida com uma mensagem "recebida" no
      // seu próprio ecrã.
      const senderSockets = [...(phoneToSockets[s.senderPhone] || [])];
      io.to(s.chatId).except(senderSockets).emit('receive_message', msgData);
      deliverToPhone(s.senderPhone, 'scheduled_message_sent', msgData, null);
      if (s.toPhone) {
        const recipientMuted = (mutedByPhone[s.toPhone] || []).includes(s.chatId);
        if (!recipientMuted) {
          const preview = s.fileType?.startsWith('image/') ? '📷 Enviou uma foto' : (s.fileType?.startsWith('video/') ? '🎥 Enviou um vídeo' : (s.fileType?.startsWith('audio/') ? '🎤 Enviou um áudio' : (s.fileData ? '📎 Enviou um ficheiro' : (s.text || '').substring(0, 100))));
          sendPushToPhone(s.toPhone, { title: s.senderName, body: preview, chatId: s.chatId }).catch(() => {});
        }
      }
    }
  }, 20 * 1000);

  // Lembretes pessoais: dispara os que já chegaram à hora marcada — avisa por
  // notificação push (funciona mesmo com a app fechada/em segundo plano) e,
  // se a pessoa estiver ligada nesse momento, também por um evento em tempo
  // real, para o ecrã de lembretes atualizar sozinho sem precisar de recarregar.
  setInterval(() => {
    const now = Date.now();
    let anyDue = false;
    Object.entries(remindersByPhone).forEach(([phone, reminders]) => {
      const due = reminders.filter((r) => !r.notified && r.remindAt <= now);
      if (!due.length) return;
      anyDue = true;
      due.forEach((r) => {
        r.notified = true;
        sendPushToPhone(phone, { title: '🔔 Lembrete', body: r.text }).catch(() => {});
      });
      deliverToPhone(phone, 'reminders_list', reminders, null);
    });
    if (anyDue) saveRemindersLocal();
  }, 20 * 1000);

  // Despesas fixas: uma vez por hora chega perfeitamente (granularidade de
  // "dia do mês", ao contrário dos lembretes que precisam de precisão ao
  // minuto) — lança as que caem hoje e ainda não foram lançadas este mês.
  setInterval(async () => {
    const now = new Date();
    const yearMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const todayDay = now.getDate();
    let anyChanged = false;
    for (const [chatId, templates] of Object.entries(recurringExpensesByChat)) {
      for (const tpl of templates) {
        const effectiveDay = Math.min(tpl.dayOfMonth, daysInMonth);
        if (todayDay !== effectiveDay || tpl.lastPostedKey === yearMonthKey) continue;
        tpl.lastPostedKey = yearMonthKey;
        anyChanged = true;
        let rate = null;
        try {
          const rateData = await cachedFetch('currency_EUR', 'https://open.er-api.com/v6/latest/EUR', 6 * 60 * 60 * 1000);
          if (rateData?.result === 'success') rate = rateData.rates?.[tpl.currency];
        } catch (e) { console.error('Erro ao obter câmbio para despesa fixa:', e.message); }
        const amountEUR = rate ? tpl.amount / rate : tpl.amount;
        const msgData = {
          id: 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          chatId, sender: '🔁 Despesa fixa', senderPhone: null, text: '',
          time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          expense: { description: tpl.description, amount: tpl.amount, currency: tpl.currency, amountEUR, paidBy: tpl.paidBy, participants: tpl.participants, createdAt: Date.now() }
        };
        if (!messagesByRoom[chatId]) messagesByRoom[chatId] = [];
        messagesByRoom[chatId].push(msgData);
        if (messagesByRoom[chatId].length > MAX_HISTORY_PER_ROOM) messagesByRoom[chatId] = messagesByRoom[chatId].slice(-MAX_HISTORY_PER_ROOM);
        if (isDbConnected) {
          try { await MessageModel.create({ ...msgData }); } catch (e) { console.error('Erro ao guardar despesa fixa:', e.message); }
        } else {
          saveMessagesLocal();
        }
        io.to(chatId).emit('receive_message', msgData);
        getRoomParticipantPhones(chatId).forEach((phone) => {
          const muted = (mutedByPhone[phone] || []).includes(chatId);
          const dnd = !!dndActiveByPhone[phone];
          if (muted || dnd) return;
          sendPushToPhone(phone, { title: '🔁 Despesa fixa', body: `${tpl.description} — ${tpl.amount.toLocaleString('pt-PT')} ${tpl.currency}`, chatId }).catch(() => {});
        });
      }
    }
    if (anyChanged) saveRecurringExpensesLocal();
  }, 60 * 60 * 1000);

  // Alertas de preço de voos: a cada 12h chega (a cota gratuita da Ignav não
  // aguenta verificações mais frequentes com vários alertas ativos).
  setInterval(() => checkPriceAlerts().catch((e) => console.error('Erro nos alertas de preço:', e.message)), 12 * 60 * 60 * 1000);

  // Chamada agendada: avisa as duas partes na hora marcada (push + evento em
  // tempo real) — nunca liga sozinha (ver comentário mais acima).
  setInterval(() => {
    const now = Date.now();
    const due = scheduledCalls.filter((c) => !c.notified && c.scheduledAt <= now);
    if (!due.length) return;
    due.forEach((c) => {
      c.notified = true;
      const chatLabel = groups[c.chatId]?.name || null;
      const phones = c.toPhone ? [c.createdByPhone, c.toPhone] : getRoomParticipantPhones(c.chatId);
      const body = c.callType === 'video' ? '🎥 Chamada de vídeo agendada agora' : '📞 Chamada de voz agendada agora';
      phones.forEach((phone) => {
        deliverToPhone(phone, 'scheduled_call_due', { chatId: c.chatId, callType: c.callType, chatName: chatLabel }, null);
        sendPushToPhone(phone, { title: '📅 Hora da chamada agendada', body, chatId: c.chatId }).catch(() => {});
      });
    });
    saveScheduledCallsLocal();
  }, 20 * 1000);

  server.listen(PORT, '0.0.0.0', () => {
    let ipAddress = 'localhost';
    const nets = os.networkInterfaces();
    Object.keys(nets).forEach((ifname) =>
      nets[ifname].forEach((iface) => {
        if (iface.family === 'IPv4' && !iface.internal) ipAddress = iface.address;
      })
    );
    console.log(`\n🚀 SERVIDOR INICIADO COM SUCESSO!`);
    console.log(`📡 Acesse pelo navegador: http://${ipAddress}:${PORT}`);
    console.log(`👥 Aguardando conexões...\n`);
  });
});