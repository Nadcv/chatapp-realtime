const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // serve o index.html e demais arquivos estáticos

// ==================== AUTENTICAÇÃO DE USUÁRIOS ====================
// Cadastro com nome, telefone, país, email e senha. Senhas nunca são
// guardadas em texto puro: usamos scrypt (módulo nativo do Node, sem
// dependência extra) com um "salt" aleatório por usuário.
// Persistência em arquivo local (mesmo padrão do histórico de mensagens) —
// em Railway/Render sobrevive a reinícios, mas é apagado a cada novo deploy.
// Para persistência permanente entre deploys, o próximo passo seria trocar
// por um banco de dados real (ex: Postgres).
const USERS_FILE = path.join(__dirname, 'users.json');
let accounts = {}; // phone -> { id, name, phone, country, email, salt, passwordHash, createdAt }
let firstRegisteredPhone = null;

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
      accounts = data.accounts || {};
      firstRegisteredPhone = data.firstRegisteredPhone || null;
    }
  } catch (err) {
    console.error('Erro ao carregar usuários:', err.message);
  }
}
function saveUsers() {
  fs.writeFile(USERS_FILE, JSON.stringify({ accounts, firstRegisteredPhone }), (err) => {
    if (err) console.error('Erro ao salvar usuários:', err.message);
  });
}
loadUsers();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Quem é administrador (vê a lista completa de usuários cadastrados):
// 1) Se a variável de ambiente ADMIN_PHONE estiver definida, esse telefone é o admin.
// 2) Caso contrário, o PRIMEIRO usuário já cadastrado no servidor vira admin automaticamente.
function isAdminPhone(phone) {
  if (process.env.ADMIN_PHONE) return phone === process.env.ADMIN_PHONE;
  return phone === firstRegisteredPhone;
}

// tokens de sessão simples em memória: token -> phone
const sessions = {};
function makeToken() { return crypto.randomBytes(24).toString('hex'); }

function publicUser(u) {
  return { id: u.id, name: u.name, phone: u.phone, country: u.country, email: u.email, isAdmin: isAdminPhone(u.phone), createdAt: u.createdAt };
}

app.post('/api/register', (req, res) => {
  const { name, phone, country, email, password } = req.body || {};
  if (!name || !phone || !country || !password) {
    return res.status(400).json({ error: 'Nome, telefone, país e senha são obrigatórios.' });
  }
  if (accounts[phone]) return res.status(409).json({ error: 'Já existe uma conta com esse número de telefone.' });
  if (String(password).length < 4) return res.status(400).json({ error: 'A senha deve ter pelo menos 4 caracteres.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const user = { id: 'u_' + Date.now(), name, phone, country, email: email || '', salt, passwordHash, createdAt: new Date().toISOString() };
  accounts[phone] = user;
  if (!firstRegisteredPhone) firstRegisteredPhone = phone;
  saveUsers();
  const token = makeToken();
  sessions[token] = phone;
  log(`🆕 Novo cadastro: ${name} (${phone})`, 'AUTH');
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

// ==================== TRADUTOR (proxy server-side) ====================
// Usa o endpoint público do Google Translate (o mesmo usado pela extensão
// "Google Tradutor" no navegador). Rodar isso no servidor evita problemas de
// CORS e não expõe nenhuma chave — não requer conta nem chave de API.
// Não é uma API oficial suportada, então em produção séria o ideal seria
// trocar por uma conta oficial do Google Cloud Translation ou pelo LibreTranslate.
app.get('/api/translate', async (req, res) => {
  const { text, target } = req.query;
  if (!text || !target) return res.status(400).json({ error: 'Parâmetros "text" e "target" são obrigatórios.' });
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Resposta não OK do serviço de tradução: ' + r.status);
    const data = await r.json();
    // data[0] é um array de pedaços [ [traduzido, original, ...], ... ]
    const translated = (data[0] || []).map(chunk => chunk[0]).join('');
    res.json({ translated });
  } catch (err) {
    console.error('Erro ao traduzir:', err.message);
    res.status(500).json({ error: 'Falha ao traduzir. Tente novamente.' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

// socket.id -> { name, rooms: Set<roomId> }
const users = {};

// ==================== PERSISTÊNCIA DE MENSAGENS ====================
// Guarda o histórico de cada sala (roomId -> array de mensagens) em disco,
// assim as conversas sobrevivem a reinícios do servidor (não apenas ficam
// na memória do navegador). Em caso de REDEPLOY no Railway, o disco é
// recriado do zero — para persistência garantida entre deploys, o ideal é
// trocar isto por um banco de dados (ex: Postgres/SQLite com volume).
const DATA_FILE = path.join(__dirname, 'messages.json');
let messagesByRoom = {};

function loadMessages() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      messagesByRoom = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Erro ao carregar histórico:', err.message);
    messagesByRoom = {};
  }
}

let saveTimeout = null;
function saveMessages() {
  // debounce simples para não escrever no disco a cada mensagem individual
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(messagesByRoom), (err) => {
      if (err) console.error('Erro ao salvar histórico:', err.message);
    });
  }, 500);
}

loadMessages();

const MAX_HISTORY_PER_ROOM = 200; // evita crescer sem limite

const log = (msg, type = 'INFO') =>
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] [${type}] ${msg}`);

io.on('connection', (socket) => {
  log(`Novo utilizador conectado: ${socket.id}`, 'SOCKET');
  users[socket.id] = { name: 'Anônimo', rooms: new Set() };

  socket.on('user_login', (userData) => {
    users[socket.id].name = userData?.name || 'Anônimo';
    socket.broadcast.emit('user_online', { id: socket.id, name: users[socket.id].name });
    log(`✅ ${users[socket.id].name} está online.`, 'USER');
  });

  // Um usuário pode participar de VÁRIAS salas ao mesmo tempo (uma por conversa/grupo)
  socket.on('join_room', (roomId) => {
    const user = users[socket.id];
    if (!user || !roomId) return;
    socket.join(roomId);
    user.rooms.add(roomId);
    log(`👥 ${user.name} entrou na sala ${roomId}`, 'ROOM');
    // Envia o histórico salvo da sala só para quem acabou de entrar
    socket.emit('room_history', { chatId: roomId, messages: messagesByRoom[roomId] || [] });
  });

  socket.on('send_message', (data) => {
    if (!data?.chatId) return;
    if (!messagesByRoom[data.chatId]) messagesByRoom[data.chatId] = [];
    messagesByRoom[data.chatId].push(data);
    if (messagesByRoom[data.chatId].length > MAX_HISTORY_PER_ROOM) {
      messagesByRoom[data.chatId] = messagesByRoom[data.chatId].slice(-MAX_HISTORY_PER_ROOM);
    }
    saveMessages();
    socket.to(data.chatId).emit('receive_message', data);
    log(`📩 ${data.sender} (${data.chatId}): ${(data.text || '').substring(0, 30)}`, 'MSG');
  });

  // Sinalização WebRTC (chamadas de voz/vídeo/conferência)
  socket.on('call_user', (data) => {
    log(`📞 Chamada de ${data.callerName} para a sala ${data.targetRoomId}`, 'WEBRTC');
    socket.to(data.targetRoomId).emit('incoming_call', data);
  });
  socket.on('answer_call', (data) => socket.to(data.targetRoomId).emit('call_answered', data));
  socket.on('ice_candidate', (data) => socket.to(data.targetRoomId).emit('ice_candidate_received', data));
  socket.on('end_call', (data) => socket.to(data.targetRoomId).emit('call_ended', data));

  // Quadro branco: retransmite cada traço e o "limpar" para o resto da sala
  socket.on('whiteboard_draw', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('whiteboard_draw_received', data);
  });
  socket.on('whiteboard_clear', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('whiteboard_clear_received', data);
  });

  // Música compartilhada na chamada: avisa o outro lado sobre trocar/parar/fechar
  // (o áudio em si viaja pela própria chamada WebRTC, isto só sincroniza a interface)
  socket.on('music_state', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('music_state_received', data);
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      log(`🔌 ${user.name} desconectou.`, 'SOCKET');
      user.rooms.forEach((room) => socket.to(room).emit('user_left', user.name));
      delete users[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
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
  console.log(`   (ou http://localhost:${PORT} no mesmo computador)`);
  console.log(`👥 Aguardando conexões...\n`);
});