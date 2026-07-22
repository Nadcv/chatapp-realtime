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
  return { id: u.id, name: u.name, phone: u.phone, country: u.country, email: u.email, isAdmin: isAdminPhone(u.phone), createdAt: u.createdAt, publicKey: u.publicKey || null };
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

// Publica a chave pública do usuário (encriptação ponta-a-ponta das conversas
// 1-para-1) — o servidor só guarda a chave PÚBLICA, nunca a privada; esta
// nunca sai do dispositivo do usuário.
app.post('/api/publish-key', (req, res) => {
  const token = req.headers['x-auth-token'] || req.body?.token;
  const phone = sessions[token];
  if (!phone || !accounts[phone]) return res.status(403).json({ error: 'Sessão inválida.' });
  accounts[phone].publicKey = req.body?.publicKeyJwk || null;
  saveUsers();
  broadcastContacts();
  res.json({ success: true });
});

// ==================== TRANSPORTES (autocarros, aviões, metro/comboio) ====================
// Cache simples em memória para não martelar as APIs externas gratuitas a
// cada pedido de cada usuário — todos os clientes partilham a mesma cache.
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

// Autocarros da Carris Metropolitana (Área Metropolitana de Lisboa) — API oficial,
// gratuita, sem chave: https://api.carrismetropolitana.pt
app.get('/api/transport/buses', async (req, res) => {
  try {
    const data = await cachedFetch('buses', 'https://api.carrismetropolitana.pt/v2/vehicles', 10000);
    res.json(data);
  } catch (err) {
    console.error('Erro autocarros:', err.message);
    res.status(502).json({ error: 'Não foi possível obter os autocarros agora.' });
  }
});

// Estações de Metro e Comboio (localização estática) — vêm do mesmo dataset aberto
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

// Aviões em tempo real sobre Portugal e Espanha — OpenSky Network, gratuita,
// sem chave (uso anónimo tem limite de pedidos, por isso a cache é maior).
app.get('/api/transport/flights', async (req, res) => {
  try {
    // Caixa delimitadora aproximada da Península Ibérica
    const bbox = 'lamin=35.8&lomin=-9.7&lamax=43.9&lomax=4.4';
    const data = await cachedFetch('flights', `https://opensky-network.org/api/states/all?${bbox}`, 15000);
    res.json(data);
  } catch (err) {
    console.error('Erro voos:', err.message);
    res.status(502).json({ error: 'Não foi possível obter os voos agora (o serviço gratuito às vezes tem limite de pedidos).' });
  }
});

// ==================== ASSISTENTE DE IA (GitHub Models) ====================
// Usa a API gratuita de "GitHub Models" (a mesma infraestrutura por trás do
// Copilot Chat). Precisa de um Personal Access Token do GitHub, definido na
// variável de ambiente GITHUB_TOKEN (Settings → Variables no Railway/Render).
// Como gerar o token: https://github.com/settings/tokens → "Generate new token"
// → não precisa marcar nenhum scope especial para uso básico dos modelos.
app.post('/api/ai-chat', async (req, res) => {
  const { messages } = req.body || {};
  if (!process.env.GITHUB_TOKEN) {
    return res.status(500).json({ error: 'Assistente de IA não configurado: falta a variável de ambiente GITHUB_TOKEN no servidor.' });
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
      console.error('Erro GitHub Models:', JSON.stringify(data).substring(0, 300));
      return res.status(502).json({ error: data?.error?.message || 'A IA não respondeu (verifique o GITHUB_TOKEN).' });
    }
    const reply = data.choices?.[0]?.message?.content || 'Desculpe, não consegui gerar uma resposta agora.';
    res.json({ reply });
  } catch (err) {
    console.error('Erro ao consultar IA:', err.message);
    res.status(500).json({ error: 'Falha ao contactar o serviço de IA. Tente novamente.' });
  }
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
  pingInterval: 25000,
  // Fotos/documentos vão embutidos na mensagem como base64 (até 10MB no original,
  // o que em base64 fica ~33% maior) — por isso o limite do socket.io precisa de
  // ser bem maior que o padrão (1MB).
  maxHttpBufferSize: 18 * 1024 * 1024
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

// ==================== GRUPOS (visíveis a TODOS os utilizadores) ====================
// Neste app, um grupo funciona como um canal público: qualquer usuário
// cadastrado vê e participa de todos os grupos automaticamente (sem convite).
const GROUPS_FILE = path.join(__dirname, 'groups.json');
let groups = {}; // id -> { id, name, createdBy, createdAt }

function loadGroups() {
  try {
    if (fs.existsSync(GROUPS_FILE)) groups = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8'));
  } catch (err) {
    console.error('Erro ao carregar grupos:', err.message);
  }
}
function saveGroups() {
  fs.writeFile(GROUPS_FILE, JSON.stringify(groups), (err) => {
    if (err) console.error('Erro ao salvar grupos:', err.message);
  });
}
loadGroups();

// ==================== CONTATOS ONLINE/OFFLINE ====================
// Todo usuário CADASTRADO (não só quem está online agora) aparece na lista de
// conversas de todo mundo, para se poder falar com ele mesmo offline — com uma
// bolinha indicando se está online ou desligado neste momento.
const onlinePhones = new Set();
// roomId -> Set de socket.id atualmente na chamada de grupo dessa sala (partilhado por todas as ligações)
const roomCallParticipants = {};
function broadcastContacts() {
  const list = Object.values(accounts).map(u => ({
    name: u.name, phone: u.phone, country: u.country, online: onlinePhones.has(u.phone), publicKey: u.publicKey || null
  }));
  io.emit('contacts_update', list);
}

const log = (msg, type = 'INFO') =>
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] [${type}] ${msg}`);

io.on('connection', (socket) => {
  log(`Novo utilizador conectado: ${socket.id}`, 'SOCKET');
  users[socket.id] = { name: 'Anônimo', phone: null, rooms: new Set() };
  // Assim que conecta, já recebe a lista atual de grupos e contatos (mesmo antes do login)
  socket.emit('groups_update', Object.values(groups));
  broadcastContacts();

  socket.on('user_login', (userData) => {
    users[socket.id].name = userData?.name || 'Anônimo';
    users[socket.id].phone = userData?.phone || null;
    if (users[socket.id].phone) onlinePhones.add(users[socket.id].phone);
    socket.broadcast.emit('user_online', { id: socket.id, name: users[socket.id].name });
    broadcastContacts();
    log(`✅ ${users[socket.id].name} está online.`, 'USER');
  });

  socket.on('create_group', (data) => {
    const name = (data?.name || '').trim();
    const creatorPhone = users[socket.id]?.phone;
    if (!name || !creatorPhone) return;
    const id = 'group_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    groups[id] = {
      id, name, createdBy: users[socket.id]?.name || 'Alguém', createdByPhone: creatorPhone, createdAt: new Date().toISOString(),
      admins: [creatorPhone], moderators: [], mutedPhones: [], bannedPhones: []
    };
    saveGroups();
    io.emit('groups_update', Object.values(groups));
    log(`👥 Grupo criado: "${name}" por ${groups[id].createdBy}`, 'GROUP');
  });

  // ==================== MODERAÇÃO DE GRUPOS (cargos, silenciar, remover) ====================
  function isGroupAdmin(group, phone) { return group?.admins?.includes(phone); }
  function isGroupModOrAdmin(group, phone) { return group?.admins?.includes(phone) || group?.moderators?.includes(phone); }

  socket.on('group_set_role', (data) => {
    const { groupId, targetPhone, role } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || !isGroupAdmin(group, myPhone) || !targetPhone) return;
    group.moderators = group.moderators.filter(p => p !== targetPhone);
    group.admins = group.admins.filter(p => p !== targetPhone);
    if (role === 'admin') group.admins.push(targetPhone);
    else if (role === 'moderator') group.moderators.push(targetPhone);
    saveGroups();
    io.emit('groups_update', Object.values(groups));
    log(`👑 ${targetPhone} passou a ${role} em "${group.name}"`, 'GROUP');
  });

  socket.on('group_mute', (data) => {
    const { groupId, targetPhone, muted } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || !isGroupModOrAdmin(group, myPhone) || !targetPhone) return;
    group.mutedPhones = group.mutedPhones.filter(p => p !== targetPhone);
    if (muted) group.mutedPhones.push(targetPhone);
    saveGroups();
    io.emit('groups_update', Object.values(groups));
  });

  socket.on('group_kick', (data) => {
    const { groupId, targetPhone } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || !isGroupAdmin(group, myPhone) || !targetPhone || targetPhone === group.createdByPhone) return;
    if (!group.bannedPhones.includes(targetPhone)) group.bannedPhones.push(targetPhone);
    group.admins = group.admins.filter(p => p !== targetPhone);
    group.moderators = group.moderators.filter(p => p !== targetPhone);
    saveGroups();
    io.emit('groups_update', Object.values(groups));
    log(`🚫 ${targetPhone} removido de "${group.name}"`, 'GROUP');
  });

  socket.on('group_unban', (data) => {
    const { groupId, targetPhone } = data || {};
    const group = groups[groupId];
    const myPhone = users[socket.id]?.phone;
    if (!group || !myPhone || !isGroupAdmin(group, myPhone) || !targetPhone) return;
    group.bannedPhones = group.bannedPhones.filter(p => p !== targetPhone);
    saveGroups();
    io.emit('groups_update', Object.values(groups));
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
    const group = groups[data.chatId];
    const myPhone = users[socket.id]?.phone;
    if (group && myPhone) {
      if (group.bannedPhones?.includes(myPhone)) return; // removido do grupo
      if (group.mutedPhones?.includes(myPhone)) {
        socket.emit('message_rejected', { chatId: data.chatId, reason: 'Foste silenciado neste grupo por um administrador.' });
        return;
      }
    }
    if (!messagesByRoom[data.chatId]) messagesByRoom[data.chatId] = [];
    messagesByRoom[data.chatId].push(data);
    if (messagesByRoom[data.chatId].length > MAX_HISTORY_PER_ROOM) {
      messagesByRoom[data.chatId] = messagesByRoom[data.chatId].slice(-MAX_HISTORY_PER_ROOM);
    }
    saveMessages();
    socket.to(data.chatId).emit('receive_message', data);
    log(`📩 ${data.sender} (${data.chatId}): ${(data.text || '').substring(0, 30)}`, 'MSG');
  });

  // "a escrever..." — não é guardado, é só um aviso momentâneo para a sala
  socket.on('typing', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('typing_received', { roomId: data.roomId, name: users[socket.id]?.name });
  });

  // Apagar mensagem para todos — atualiza o histórico guardado e avisa a sala
  socket.on('delete_message', (data) => {
    if (!data?.chatId || !data?.messageId) return;
    const msgs = messagesByRoom[data.chatId];
    if (msgs) {
      const msg = msgs.find(m => m.id === data.messageId);
      if (msg) { msg.text = 'Mensagem apagada'; msg.deleted = true; msg.fileData = null; saveMessages(); }
    }
    socket.to(data.chatId).emit('message_deleted_received', data);
  });

  // Reagir a uma mensagem com emoji (👍❤️😂 etc.)
  socket.on('react_message', (data) => {
    if (!data?.chatId || !data?.messageId || !data?.emoji) return;
    const msgs = messagesByRoom[data.chatId];
    if (msgs) {
      const msg = msgs.find(m => m.id === data.messageId);
      if (msg) {
        if (!msg.reactions) msg.reactions = {};
        const who = users[socket.id]?.phone || socket.id;
        if (!msg.reactions[data.emoji]) msg.reactions[data.emoji] = [];
        if (!msg.reactions[data.emoji].includes(who)) msg.reactions[data.emoji].push(who);
        saveMessages();
      }
    }
    socket.to(data.chatId).emit('reaction_received', { ...data, who: users[socket.id]?.phone || socket.id });
  });

  // Confirmação de leitura (✓✓)
  socket.on('message_read', (data) => {
    if (!data?.chatId) return;
    socket.to(data.chatId).emit('message_read_received', { chatId: data.chatId, reader: users[socket.id]?.phone });
  });

  // Sinalização WebRTC (chamadas de voz/vídeo 1-para-1)
  socket.on('call_user', (data) => {
    log(`📞 Chamada de ${data.callerName} para a sala ${data.targetRoomId}`, 'WEBRTC');
    socket.to(data.targetRoomId).emit('incoming_call', data);
  });
  socket.on('answer_call', (data) => socket.to(data.targetRoomId).emit('call_answered', data));
  socket.on('ice_candidate', (data) => socket.to(data.targetRoomId).emit('ice_candidate_received', data));
  socket.on('end_call', (data) => socket.to(data.targetRoomId).emit('call_ended', data));

  // ==================== CHAMADAS EM GRUPO (malha: cada participante liga a todos os outros) ====================

  socket.on('join_call', (data) => {
    const { roomId, callType } = data || {};
    if (!roomId) return;
    if (!roomCallParticipants[roomId]) roomCallParticipants[roomId] = new Set();
    const isFirst = roomCallParticipants[roomId].size === 0;
    const existing = [...roomCallParticipants[roomId]].map(id => ({ socketId: id, name: users[id]?.name || 'Alguém' }));
    roomCallParticipants[roomId].add(socket.id);
    if (isFirst) {
      // Avisa o resto do grupo (que não está na chamada) que uma chamada começou, para poderem entrar
      socket.to(roomId).emit('group_call_started', { roomId, callType, starterName: users[socket.id]?.name || 'Alguém' });
    }
    // Avisa quem já está na chamada de que uma pessoa nova entrou (para atualizar a UI, ex: nome)
    socket.to(roomId).emit('peer_joined_call', { socketId: socket.id, name: users[socket.id]?.name || 'Alguém', callType });
    // Devolve a quem entrou a lista de quem já está na chamada, para ele iniciar a ligação com cada um
    socket.emit('existing_call_participants', { roomId, participants: existing });
    log(`🎥 ${users[socket.id]?.name || socket.id} entrou na chamada em grupo (${roomId}) — ${roomCallParticipants[roomId].size} participante(s)`, 'WEBRTC');
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

  // Localização em tempo real (GPS): apenas retransmite para a sala — não fica
  // guardado em disco, é só "ao vivo" (como a localização em tempo real do WhatsApp).
  socket.on('location_update', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('location_update_received', data);
  });
  socket.on('location_stop', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('location_stop_received', { phone: users[socket.id]?.phone });
  });

  // Legendas ao vivo nas chamadas: só retransmite o texto reconhecido pelo navegador
  // de quem está a falar — cada lado traduz para o seu próprio idioma localmente.
  socket.on('call_caption', (data) => {
    if (!data?.roomId) return;
    socket.to(data.roomId).emit('call_caption_received', { text: data.text, name: users[socket.id]?.name || 'Alguém' });
  });

  socket.on('user_logout', () => {
    const user = users[socket.id];
    if (user?.phone) {
      const stillConnected = Object.entries(users).some(([id, u]) => id !== socket.id && u.phone === user.phone);
      if (!stillConnected) { onlinePhones.delete(user.phone); broadcastContacts(); }
      user.phone = null;
      user.name = 'Anônimo';
    }
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      log(`🔌 ${user.name} desconectou.`, 'SOCKET');
      user.rooms.forEach((room) => socket.to(room).emit('user_left', user.name));
      delete users[socket.id];
      if (user.phone) {
        // só marca offline se não houver OUTRA aba/dispositivo ainda ligado com o mesmo telefone
        const stillConnected = Object.values(users).some(u => u.phone === user.phone);
        if (!stillConnected) { onlinePhones.delete(user.phone); broadcastContacts(); }
      }
    }
    // Se estava numa chamada em grupo, tira-o de todas as salas de chamada e avisa os outros
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