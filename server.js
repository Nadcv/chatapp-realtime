const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose'); // Importado para gerir a base de dados em nuvem

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
  pushSubscriptions: { type: [Object], default: [] } // inscrições de notificações push (um dispositivo pode ter mais do que uma)
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
  edited: Boolean,
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
  loadPinsLocal(); loadDisappearingLocal(); loadStatusesLocal(); loadCallLogLocal(); loadScheduledLocal(); loadMutedLocal(); loadAlertsLocal(); loadArchivedLocal(); loadBlockedLocal();
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

function isAdminPhone(phone) {
  if (process.env.ADMIN_PHONE) return phone === process.env.ADMIN_PHONE;
  return phone === firstRegisteredPhone;
}

const sessions = {};
function makeToken() { return crypto.randomBytes(24).toString('hex'); }

function publicUser(u) {
  return { id: u.id, name: u.name, phone: u.phone, username: u.username || null, country: u.country, email: u.email, isAdmin: isAdminPhone(u.phone), createdAt: u.createdAt, publicKey: u.publicKey || null, avatarUrl: u.avatarUrl || null, preferredLang: u.preferredLang || null, accentColor: u.accentColor || null, chatWallpaper: u.chatWallpaper || null };
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
  { id: 'bbc', name: 'BBC World', flag: '🌍', category: 'mundo', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' }
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

// ==================== SERVIDOR TURN ====================
let turnCache = null;
let turnCacheAt = 0;
// ==================== TEMPO/METEOROLOGIA ====================
// Open-Meteo — gratuita, sem chave, sem limite de pedidos para uso normal.
app.get('/api/weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'Localização em falta.' });
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error('Erro meteorologia:', err.message);
    res.status(502).json({ error: 'Não foi possível obter o tempo agora.' });
  }
});

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
  // O GitHub Models é uma infraestrutura partilhada gratuita e às vezes fica
  // sobrecarregada ou com o limite de pedidos atingido (erros 429/503) — nesses
  // casos, muitas vezes uma segunda tentativa alguns segundos depois já resolve,
  // por isso tentamos até 3 vezes antes de desistir e avisar o usuário.
  const MAX_ATTEMPTS = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
      if (r.status === 429 || r.status === 503) {
        lastError = { status: r.status, transient: true };
        if (attempt < MAX_ATTEMPTS) { await new Promise(res => setTimeout(res, attempt * 1200)); continue; }
        break;
      }
      const data = await r.json();
      if (!r.ok) {
        return res.status(502).json({ error: data?.error?.message || 'A IA não respondeu.' });
      }
      const reply = data.choices?.[0]?.message?.content || 'Desculpe, não consegui gerar resposta.';
      return res.json({ reply });
    } catch (err) {
      lastError = { message: err.message, transient: false };
      if (attempt < MAX_ATTEMPTS) { await new Promise(res => setTimeout(res, attempt * 1000)); continue; }
    }
  }
  console.error('IA indisponível após', MAX_ATTEMPTS, 'tentativas:', lastError);
  const msg = lastError?.transient
    ? 'O GitHub Models (a IA gratuita) está temporariamente sobrecarregado ou atingiu o limite de pedidos. É uma instabilidade do próprio serviço gratuito, não da nossa app — tenta novamente daqui a um ou dois minutos.'
    : 'Falha ao contactar o serviço de IA. Tenta novamente em instantes.';
  res.status(503).json({ error: msg });
});

// ==================== ASSISTENTE GEMINI (Google) ====================
// Segundo assistente de IA, à parte do GitHub Models — usa a API gratuita do
// Google AI Studio (Gemini), que aceita nativamente texto, imagens, vídeo e
// documentos na mesma conversa. Precisa da variável de ambiente GEMINI_API_KEY
// (gratuita em https://aistudio.google.com/apikey).
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
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: 'Você é o assistente Gemini, integrado num app de chat. Consegue analisar fotos, vídeos e documentos que lhe enviarem. Responda em português, de forma clara e útil.' }] }
      })
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = data?.error?.message || 'O Gemini não respondeu.';
      const status = r.status === 429 ? 429 : 502;
      return res.status(status).json({ error: status === 429 ? 'O Gemini atingiu o limite gratuito de pedidos por agora — tenta novamente daqui a um bocado.' : msg });
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

// ==================== MENSAGENS FIXADAS (uma por conversa) ====================
const PINS_FILE = path.join(__dirname, 'pins.json');
let pinnedByRoom = {}; // roomId -> { messageId, text, sender }
function loadPinsLocal() {
  try { if (fs.existsSync(PINS_FILE)) pinnedByRoom = JSON.parse(fs.readFileSync(PINS_FILE, 'utf-8')); }
  catch (err) { console.error('Erro ao carregar mensagens fixadas:', err.message); }
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
const roomCallParticipants = {}; // roomId -> Set de socket.ids (Suporta até 20+ pessoas em simultâneo)
const vrRoomParticipants = {}; // roomId -> Map(socket.id -> {socketId, phone, name}) — sala de realidade virtual

function contactPublicInfo(u) {
  return { name: u.name, phone: u.phone, username: u.username || null, country: u.country, online: onlinePhones.has(u.phone), publicKey: u.publicKey || null, avatarUrl: u.avatarUrl || null, preferredLang: u.preferredLang || null };
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
    const newGroup = {
      id, name, createdBy: users[socket.id]?.name || 'Alguém', createdByPhone: creatorPhone, createdAt: new Date().toISOString(),
      admins: [creatorPhone], moderators: [], mutedPhones: [], bannedPhones: []
    };
    groups[id] = newGroup;

    if (isDbConnected) {
      await GroupModel.create(newGroup).catch(e => console.error('Erro Mongo (criar grupo):', e.message));
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
      await GroupModel.updateOne({ id: groupId }, { admins: group.admins, moderators: group.moderators }).catch(e => console.error('Erro Mongo (cargo do grupo):', e.message));
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
      await GroupModel.updateOne({ id: groupId }, { mutedPhones: group.mutedPhones }).catch(e => console.error('Erro Mongo (silenciar no grupo):', e.message));
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
      await GroupModel.updateOne({ id: groupId }, { bannedPhones: group.bannedPhones, admins: group.admins, moderators: group.moderators }).catch(e => console.error('Erro Mongo (remover do grupo):', e.message));
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
      await GroupModel.updateOne({ id: groupId }, { bannedPhones: group.bannedPhones }).catch(e => console.error('Erro Mongo (desbanir do grupo):', e.message));
    } else {
      saveGroupsLocal();
    }
    io.emit('groups_update', Object.values(groups));
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
    io.emit('groups_update', Object.values(groups));
    io.emit('group_deleted', { groupId });
    log(`🗑️ Grupo "${group.name}" apagado por ${users[socket.id]?.name || myPhone}`, 'GROUP');
  });

  socket.on('join_room', (roomId) => {
    const user = users[socket.id];
    if (!user || !roomId) return;
    socket.join(roomId);
    user.rooms.add(roomId);
    socket.emit('room_history', { chatId: roomId, messages: messagesByRoom[roomId] || [] });
    // Aproveita a entrada na sala para sincronizar o estado dessa conversa que
    // não vem no histórico de mensagens: mensagem fixada e mensagens temporárias.
    if (pinnedByRoom[roomId]) socket.emit('message_pinned_received', { chatId: roomId, pin: pinnedByRoom[roomId] });
    if (disappearingByRoom[roomId]) socket.emit('disappearing_updated', { chatId: roomId, seconds: disappearingByRoom[roomId] });
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

    // Notificação push (mesmo com a app fechada) — só para conversas 1-para-1 por agora
    if (!group && data.toPhone) {
      const recipientMuted = (mutedByPhone[data.toPhone] || []).includes(data.chatId);
      const recipientDnd = !!dndActiveByPhone[data.toPhone];
      if (!recipientMuted && !recipientDnd) {
        const senderName = data.sender || 'Alguém';
        const preview = data.encrypted ? 'Enviou uma mensagem' : (data.fileType?.startsWith('image/') ? '📷 Enviou uma foto' : (data.fileType?.startsWith('video/') ? '🎥 Enviou um vídeo' : (data.fileType?.startsWith('audio/') ? '🎤 Enviou um áudio' : (data.fileData ? '📎 Enviou um ficheiro' : (data.text || '').substring(0, 100)))));
        sendPushToPhone(data.toPhone, { title: senderName, body: preview, chatId: data.chatId }).catch(() => {});
      }
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

  socket.on('message_read', (data) => {
    if (!data?.chatId) return;
    socket.to(data.chatId).emit('message_read_received', { chatId: data.chatId, reader: users[socket.id]?.phone });
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
  });
  socket.on('ice_candidate', (data) => {
    if (data.targetPhone) deliverToPhone(data.targetPhone, 'ice_candidate_received', data, socket.id);
    else socket.to(data.targetRoomId).emit('ice_candidate_received', data);
  });
  socket.on('end_call', (data) => {
    if (data.targetPhone) deliverToPhone(data.targetPhone, 'call_ended', data, socket.id);
    else socket.to(data.targetRoomId).emit('call_ended', data);
  });

  // ==================== MENSAGENS FIXADAS ====================
  socket.on('pin_message', (data) => {
    const { chatId, messageId, text, sender } = data || {};
    if (!chatId || !messageId) return;
    pinnedByRoom[chatId] = { messageId, text: (text || '').substring(0, 300), sender: sender || 'Alguém' };
    savePinsLocal();
    io.to(chatId).emit('message_pinned_received', { chatId, pin: pinnedByRoom[chatId] });
  });
  socket.on('unpin_message', (data) => {
    const { chatId } = data || {};
    if (!chatId) return;
    delete pinnedByRoom[chatId];
    savePinsLocal();
    io.to(chatId).emit('message_pinned_received', { chatId, pin: null });
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
  socket.on('schedule_message', (data) => {
    const myPhone = users[socket.id]?.phone;
    const { chatId, text, sendAt, toPhone, fileData, fileName, fileType, transcript } = data || {};
    if (!myPhone || !chatId || !sendAt || (!text && !fileData)) return;
    const entry = {
      id: 'sc' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      chatId, senderPhone: myPhone, senderName: users[socket.id]?.name || 'Alguém',
      toPhone: toPhone || null, text: (text || '').substring(0, 2000), sendAt: Number(sendAt),
      fileData: fileData || null, fileName: fileName || null, fileType: fileType || null, transcript: transcript || null
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

  // Mensagens agendadas: dispara as que já chegaram à hora marcada.
  setInterval(async () => {
    const now = Date.now();
    const due = scheduledMessages.filter((s) => s.sendAt <= now);
    if (!due.length) return;
    scheduledMessages = scheduledMessages.filter((s) => s.sendAt > now);
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