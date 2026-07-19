const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.static(__dirname)); // serve o index.html e demais arquivos estáticos

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
