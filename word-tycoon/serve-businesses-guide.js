// serve-businesses-guide.js — Serves the businesses guide PNG on port 3021
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3021;
const imagePath = path.join(__dirname, 'businesses-guide.png');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/businesses-guide.png') {
    fs.readFile(imagePath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error reading image file');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': data.length,
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found — visit / or /businesses-guide.png');
  }
});

server.listen(PORT, () => {
  console.log(`Businesses guide server running at http://localhost:${PORT}`);
  console.log(`View the guide at http://localhost:${PORT}/businesses-guide.png`);
});
