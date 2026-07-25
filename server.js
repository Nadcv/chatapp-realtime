const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose'); // Importado para gerir a base de dados em nuvem

const app = express();
app.use(express.json());
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
  contacts: { type: [String], default: [] } // telefones de quem esta pessoa já procurou/falou
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
  bannedPhones: [String]
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
  encrypted: Boolean, // mensagens 1-para-1 cifradas ponta-a-ponta guardam o texto aqui em vez de "text"
  iv: String,
  data: String,
  createdAt: { type: Date, default: Date.now }
}, { strict: false }); // rede de segurança: qualquer campo futuro que se esqueça de listar acima ainda assim é gravado
const MessageModel = mongoose.model('Message', messageSchema);

async function loadDataFromMongo() {
  const [dbAccounts, dbGroups, dbMsgs] = await Promise.all([
    AccountModel.find({}),
    GroupModel.find({}),
    MessageModel.find({}).sort({ createdAt: 1 })
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
  console.log(`🔄 Base de dados carregada: ${dbAccounts.length} conta(s), ${dbGroups.length} grupo(s), ${dbMsgs.length} mensagem(ns).`);
}

// Liga à base de dados ANTES do servidor começar a aceitar pedidos — sem isto,
// os primeiros registos/mensagens logo a seguir a um reinício podiam ir parar
// aos ficheiros locais em vez de à base de dados (e depois pareciam ter
// desaparecido), por causa do tempo que a ligação ao Mongo demora a estabelecer.
async function connectDatabase() {
  if (!MONGO_URI) {
    console.log('⚠️ AVISO: MONGO_URI não definida. A usar ficheiros locais — os dados apagam a cada novo deploy.');
    loadUsersLocal(); loadMessagesLocal(); loadGroupsLocal();
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
    loadUsersLocal(); loadMessagesLocal(); loadGroupsLocal();
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

function isAdminPhone(phone) {
  if (process.env.ADMIN_PHONE) return phone === process.env.ADMIN_PHONE;
  return phone === firstRegisteredPhone;
}

const sessions = {};
function makeToken() { return crypto.randomBytes(24).toString('hex'); }

function publicUser(u) {
  return { id: u.id, name: u.name, phone: u.phone, username: u.username || null, country: u.country, email: u.email, isAdmin: isAdminPhone(u.phone), createdAt: u.createdAt, publicKey: u.publicKey || null };
}

app.post('/api/register', async (req, res) => {
  const { name, phone, country, email, password } = req.body || {};
  let { username } = req.body || {};
  if (!name || !phone || !country || !password || !username) {
    return res.status(400).json({ error: 'Nome, nome de utilizador, telefone, país e senha são obrigatórios.' });
  }
  username = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (username.length < 3) return res.status(400).json({ error: 'O nome de utilizador deve ter pelo menos 3 caracteres (letras, números ou _).' });
  if (accounts[phone]) return res.status(409).json({ error: 'Já existe uma conta com esse número de telefone.' });
  if (usernameIndex[username]) return res.status(409).json({ error: 'Esse nome de utilizador já está a ser usado. Escolhe outro.' });
  if (String(password).length < 4) return res.status(400).json({ error: 'A senha deve ter pelo menos 4 caracteres.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const user = { id: 'u_' + Date.now(), name, phone, username, country, email: email || '', salt, passwordHash, createdAt: new Date().toISOString(), contacts: [] };
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

app.post('/api/login', (req, res) => {
  const { phone, password } = req.body || {};
  const user = accounts[phone];
  if (!user || hashPassword(password || '', user.salt) !== user.passwordHash) {
    return res.status(401).json({ error: 'Telefone ou senha incorretos.' });
  }
  const token = makeToken();
  sessions[token] = phone;
  log(`✅ Login: ${user.name} (${phone})`, 'AUTH');
  res.json({ success: true, user: publicUser(user), token });
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

// ==================== SALA "CONDUZIR E OUVIR" (Drive & Listen) ====================
// Inspirado no driveandlisten.app: vídeo de condução pela cidade (YouTube) +
// rádio local a tocar ao mesmo tempo. A lista de cidades é curada à mão (com
// vídeos verificados); o link do YouTube só toca imagem (sem som do vídeo),
// e o som vem de uma rádio real do país, obtida através da Radio Browser
// (radio-browser.info) — uma base de dados aberta e mundial de rádios, que
// verifica periodicamente se os links ainda funcionam, para não depender de
// um link fixo que pode "morrer" com o tempo.
const DRIVE_LISTEN_CITIES = [
  { id: 'lisbon', name: 'Lisboa', country: 'Portugal', flag: '🇵🇹', videoId: 's0zi01sRxNs' },
  { id: 'paris', name: 'Paris', country: 'France', flag: '🇫🇷', videoId: 'lN43inpI2lk' },
  { id: 'london', name: 'Londres', country: 'United Kingdom', flag: '🇬🇧', videoId: '7lqBxVD9lI0' },
  { id: 'newyork', name: 'Nova Iorque', country: 'United States', flag: '🇺🇸', videoId: 'usyrgSEbx_A' },
  { id: 'tokyo', name: 'Tóquio', country: 'Japan', flag: '🇯🇵', videoId: 'qPgWV8Rxemo' }
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

// ==================== SERVIDOR TURN ====================
let turnCache = null;
let turnCacheAt = 0;
app.get('/api/turn-credentials', async (req, res) => {
  const FALLBACK = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:openrelay.metered.ca:80' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  };
  if (!process.env.CF_TURN_KEY_ID || !process.env.CF_TURN_API_TOKEN) {
    return res.json(FALLBACK);
  }
  try {
    const now = Date.now();
    if (turnCache && (now - turnCacheAt) < 20 * 60 * 1000) return res.json(turnCache);
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.CF_TURN_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 3600 })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const combined = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...(data.iceServers || [])] };
    turnCache = combined;
    turnCacheAt = now;
    res.json(combined);
  } catch (err) {
    console.error('Erro ao gerar credenciais TURN:', err.message);
    res.json(FALLBACK);
  }
});

// ==================== ASSISTENTE DE IA ====================
app.post('/api/ai-chat', async (req, res) => {
  const { messages } = req.body || {};
  if (!process.env.GITHUB_TOKEN) {
    return res.status(500).json({ error: 'Assistente de IA não configurado: falta GITHUB_TOKEN.' });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Mensagem vazia.' });
  }
  try {
    const r = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.GITHUB_TOKEN
      },
      body: JSON.stringify({
        model: process.env.GITHUB_MODEL || 'openai/gpt-4o-mini',
        messages,
        temperature: 1
      })
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: data?.error?.message || 'A IA não respondeu.' });
    }
    const reply = data.choices?.[0]?.message?.content || 'Desculpe, não consegui gerar resposta.';
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao contactar o serviço de IA.' });
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
    res.json({ translated });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao traduzir.' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  // Aumentado para 40MB para permitir áudios estendidos longos e ficheiros pesados sem cortes
  maxHttpBufferSize: 40 * 1024 * 1024
});

const users = {};

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

// ==================== CONTATOS (por pesquisa, não automáticos) ====================
// Antes, todo usuário cadastrado aparecia na lista de todo mundo. Agora só
// aparece quem procuraste pelo nome de utilizador (@username) e escolheste
// "Iniciar conversa", ou quem já te mandou uma mensagem — tal como no
// WhatsApp/Telegram, é preciso saber quem procurar; ninguém aparece sozinho.
const onlinePhones = new Set();
const roomCallParticipants = {}; // roomId -> Set de socket.ids (Suporta até 20+ pessoas em simultâneo)

function contactPublicInfo(u) {
  return { name: u.name, phone: u.phone, username: u.username || null, country: u.country, online: onlinePhones.has(u.phone), publicKey: u.publicKey || null };
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
  // Os grupos continuam visíveis a todos assim que conectas; os contactos só chegam depois do login
  socket.emit('groups_update', Object.values(groups));

  socket.on('user_login', (userData) => {
    users[socket.id].name = userData?.name || 'Anônimo';
    users[socket.id].phone = userData?.phone || null;
    if (users[socket.id].phone) {
      onlinePhones.add(users[socket.id].phone);
      sendContactsTo(users[socket.id].phone);
      notifyContactsOfStatusChange(users[socket.id].phone);
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
    const newGroup = {
      id, name, createdBy: users[socket.id]?.name || 'Alguém', createdByPhone: creatorPhone, createdAt: new Date().toISOString(),
      admins: [creatorPhone], moderators: [], mutedPhones: [], bannedPhones: []
    };
    groups[id] = newGroup;

    if (isDbConnected) {
      await GroupModel.create(newGroup);
    } else {
      saveGroupsLocal();
    }

    io.emit('groups_update', Object.values(groups));
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
      await GroupModel.updateOne({ id: groupId }, { admins: group.admins, moderators: group.moderators });
    } else {
      saveGroupsLocal();
    }
    io.emit('groups_update', Object.values(groups));
  });

  socket.on('group_mute', async (data) => {
    const { groupId, targetPhone, muted } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || !isGroupModOrAdmin(group, myPhone) || !targetPhone) return;
    group.mutedPhones = group.mutedPhones.filter(p => p !== targetPhone);
    if (muted) group.mutedPhones.push(targetPhone);

    if (isDbConnected) {
      await GroupModel.updateOne({ id: groupId }, { mutedPhones: group.mutedPhones });
    } else {
      saveGroupsLocal();
    }
    io.emit('groups_update', Object.values(groups));
  });

  socket.on('group_kick', async (data) => {
    const { groupId, targetPhone } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || !isGroupAdmin(group, myPhone) || !targetPhone || targetPhone === group.createdByPhone) return;
    if (!group.bannedPhones.includes(targetPhone)) group.bannedPhones.push(targetPhone);
    group.admins = group.admins.filter(p => p !== targetPhone);
    group.moderators = group.moderators.filter(p => p !== targetPhone);

    if (isDbConnected) {
      await GroupModel.updateOne({ id: groupId }, { bannedPhones: group.bannedPhones, admins: group.admins, moderators: group.moderators });
    } else {
      saveGroupsLocal();
    }
    io.emit('groups_update', Object.values(groups));
  });

  socket.on('group_unban', async (data) => {
    const { groupId, targetPhone } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || !isGroupAdmin(group, myPhone) || !targetPhone) return;
    group.bannedPhones = group.bannedPhones.filter(p => p !== targetPhone);

    if (isDbConnected) {
      await GroupModel.updateOne({ id: groupId }, { bannedPhones: group.bannedPhones });
    } else {
      saveGroupsLocal();
    }
    io.emit('groups_update', Object.values(groups));
  });

  socket.on('join_room', (roomId) => {
    const user = users[socket.id];
    if (!user || !roomId) return;
    socket.join(roomId);
    user.rooms.add(roomId);
    socket.emit('room_history', { chatId: roomId, messages: messagesByRoom[roomId] || [] });
  });

  socket.on('send_message', async (data) => {
    if (!data?.chatId) return;
    const group = groups[data.chatId];
    const myPhone = users[socket.id]?.phone;
    if (group && myPhone) {
      if (group.bannedPhones?.includes(myPhone)) return;
      if (group.mutedPhones?.includes(myPhone)) {
        socket.emit('message_rejected', { chatId: data.chatId, reason: 'Foste silenciado neste grupo.' });
        return;
      }
    }
    // Conversa 1-para-1: quem recebe a primeira mensagem passa a ter quem
    // enviou nos seus contactos automaticamente, para poder responder sem
    // precisar de o procurar primeiro (tal como receber um SMS de um número novo).
    if (!group && data.toPhone && myPhone) {
      if (await addContact(data.toPhone, myPhone)) sendContactsTo(data.toPhone);
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
          await MessageModel.updateOne({ id: data.messageId }, { text: 'Mensagem apagada', deleted: true, fileData: null });
        } else {
          saveMessagesLocal();
        }
      }
    }
    socket.to(data.chatId).emit('message_deleted_received', data);
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
          await MessageModel.updateOne({ id: data.messageId }, { reactions: msg.reactions });
        } else {
          saveMessagesLocal();
        }
      }
    }
    socket.to(data.chatId).emit('reaction_received', { ...data, who: users[socket.id]?.phone || socket.id });
  });

  socket.on('message_read', (data) => {
    if (!data?.chatId) return;
    socket.to(data.chatId).emit('message_read_received', { chatId: data.chatId, reader: users[socket.id]?.phone });
  });

  socket.on('call_user', (data) => {
    socket.to(data.targetRoomId).emit('incoming_call', data);
  });
  socket.on('answer_call', (data) => socket.to(data.targetRoomId).emit('call_answered', data));
  socket.on('ice_candidate', (data) => socket.to(data.targetRoomId).emit('ice_candidate_received', data));
  socket.on('end_call', (data) => socket.to(data.targetRoomId).emit('call_ended', data));

  // ==================== CONFERÊNCIAS EM GRUPO (Até 20+ participantes em simultâneo) ====================
  socket.on('join_call', (data) => {
    const { roomId, callType } = data || {};
    if (!roomId) return;
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

  socket.on('whiteboard_draw', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('whiteboard_draw_received', data);
  });
  socket.on('whiteboard_clear', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('whiteboard_clear_received', data);
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
  });
});

const PORT = process.env.PORT || 3000;
connectDatabase().then(() => {
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