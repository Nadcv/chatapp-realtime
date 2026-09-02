// Minimal HTTP server on a different port, serving an image with NO CORS headers at all —
// simulates a remote host (like Cloudinary without permissive CORS configured) so we can
// reproduce the "black canvas, stuck editor" bug for real in a test, without needing real
// external network access.
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.argv[2] || 3001;
const imgPath = path.join(__dirname, 'test_photo_large.png');
const imgData = fs.readFileSync(imgPath);

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/png' }); // de propósito, SEM Access-Control-Allow-Origin
  res.end(imgData);
}).listen(port, () => console.log('tainted image server on', port));
