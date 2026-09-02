// Minimal fake SMTP server (no AUTH, no TLS) so we can test the real 2FA
// email-sending code path end-to-end without touching a real mail provider.
// Keeps a bounded history of messages (not just the very last one) so an
// inspector query can filter by recipient — needed because several test
// files (2FA login, password reset) can send emails through this same
// server concurrently, and a single global "last message" slot would let
// one test's email overwrite another's before it gets read.
const net = require('net');

const MAX_HISTORY = 50;

function startFakeSmtp(port) {
  const messages = []; // { to, body }, oldest first
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let dataLines = [];
    let rcptTo = null;
    socket.write('220 localhost ESMTP fake\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            const body = dataLines.join('\n');
            messages.push({ to: rcptTo || '', body });
            if (messages.length > MAX_HISTORY) messages.shift();
            dataLines = [];
            socket.write('250 OK: queued\r\n');
          } else {
            dataLines.push(line);
          }
          continue;
        }
        const cmd = line.split(' ')[0].toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-localhost\r\n250 SIZE 10485760\r\n');
        else if (cmd === 'MAIL') socket.write('250 OK\r\n');
        else if (cmd === 'RCPT') {
          const m = line.match(/<([^>]+)>/);
          if (m) rcptTo = m[1];
          socket.write('250 OK\r\n');
        }
        else if (cmd === 'DATA') { inData = true; socket.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
        else if (cmd === 'QUIT') { socket.write('221 Bye\r\n'); socket.end(); }
        else socket.write('250 OK\r\n');
      }
    });
  });
  function getLastMessage(to) {
    if (to) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].to.toLowerCase() === String(to).toLowerCase()) return messages[i].body;
      }
      return null;
    }
    return messages.length ? messages[messages.length - 1].body : null;
  }
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, getLastMessage }));
  });
}

module.exports = { startFakeSmtp };

if (require.main === module) {
  const http = require('http');
  const { URL } = require('url');
  const smtpPort = parseInt(process.argv[2] || '2525');
  const httpPort = parseInt(process.argv[3] || '2526');
  startFakeSmtp(smtpPort).then(({ getLastMessage }) => {
    console.log('Fake SMTP listening on', smtpPort);
    http.createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ lastMessage: getLastMessage(u.searchParams.get('to')) }));
    }).listen(httpPort, '127.0.0.1', () => console.log('Fake SMTP inspector on', httpPort));
  });
}
