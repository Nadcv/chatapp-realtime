const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

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
  });

  socket.on('send_message', (data) => {
    if (!data?.chatId) return;
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
