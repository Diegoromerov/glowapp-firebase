// Servidor estático con el mismo rewrite que Firebase Hosting (`**` → index.html).
//
// `python -m http.server` responde 404 en las rutas limpias, así que probar un
// enlace compartido (`/provider-detail/3`) contra él mide el servidor de
// desarrollo, no la app. Este servidor reproduce hosting.
//
//   node tools/servir_web_local.js <carpeta> [puerto]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(process.argv[2] || 'build/web');
const PUERTO = Number(process.argv[3] || 8099);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

const indice = path.join(RAIZ, 'index.html');

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let archivo = path.join(RAIZ, url);

  // Nada fuera de la raíz.
  if (!archivo.startsWith(RAIZ)) {
    res.writeHead(403).end('403');
    return;
  }

  if (!fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    archivo = indice;
  }

  fs.readFile(archivo, (error, datos) => {
    if (error) {
      res.writeHead(404).end('404');
      return;
    }
    const tipo = TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-cache' });
    res.end(datos);
  });
}).listen(PUERTO, () => {
  console.log(`sirviendo ${RAIZ} en http://localhost:${PUERTO} (rewrite a index.html)`);
});
