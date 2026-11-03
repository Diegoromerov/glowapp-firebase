const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8088;
const HTML_PATH = path.join(__dirname, 'public', 'index.html');

const server = http.createServer((req, res) => {
  console.log(`[${new Date().toLocaleTimeString()}] HTTP ${req.method} ${req.url}`);

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Clear-Site-Data', '"cache", "storage"');

  if (req.url === '/' || req.url === '/index.html' || !req.url.includes('.')) {
    fs.readFile(HTML_PATH, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Error al cargar la Mock Demo: ' + err.message);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    const filePath = path.join(__dirname, 'public', req.url.replace(/^\//, ''));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error');
        } else {
          res.writeHead(200);
          res.end(data);
        }
      });
    } else {
      fs.readFile(HTML_PATH, 'utf8', (err, data) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(` GLOWAPP SAAS PRO - SERVIDOR DEDICADO DE MOCK DEMO`);
  console.log(` Puerto Activo: http://localhost:${PORT}`);
  console.log(` Modo: Anti-Caché Estricto & Purga de Service Worker`);
  console.log(`=======================================================`);
});
