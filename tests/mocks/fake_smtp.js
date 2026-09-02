// Minimal fake SMTP server (no AUTH, no TLS) so we can test the real 2FA
// email-sending code path end-to-end without touching a real mail provider.
// Captures the full DATA body of the last message so a test can extract the
// verification code nodemailer actually sent.
const net = require('net');

function startFakeSmtp(port) {
  let lastMessage = null;
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let dataLines = [];
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
            lastMessage = dataLines.join('\n');
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
        else if (cmd === 'RCPT') socket.write('250 OK\r\n');
        else if (cmd === 'DATA') { inData = true; socket.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
        else if (cmd === 'QUIT') { socket.write('221 Bye\r\n'); socket.end(); }
        else socket.write('250 OK\r\n');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, getLastMessage: () => lastMessage }));
  });
}

module.exports = { startFakeSmtp };

if (require.main === module) {
  const http = require('http');
  const smtpPort = parseInt(process.argv[2] || '2525');
  const httpPort = parseInt(process.argv[3] || '2526');
  startFakeSmtp(smtpPort).then(({ getLastMessage }) => {
    console.log('Fake SMTP listening on', smtpPort);
    http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ lastMessage: getLastMessage() }));
    }).listen(httpPort, '127.0.0.1', () => console.log('Fake SMTP inspector on', httpPort));
  });
}
