'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, 'public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.vtt': 'text/vtt; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const csp = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://challenges.cloudflare.com; media-src 'self' https://firebasestorage.googleapis.com; connect-src 'self' https://glowapp-api-production.up.railway.app https://glowapp-api-staging-staging.up.railway.app http://localhost:3000 https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'";
function siteUrl() {
  const host = process.env.LANDING_SITE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  return /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(host) ? host.replace(/\/$/, '') : '';
}

http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); return res.end('ok'); }
  if (req.url === '/sitemap.xml') {
    const base = siteUrl();
    const urls = base ? [`${base}/`] : [];
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' }); return res.end(xml);
  }
  if (req.url === '/robots.txt') {
    const sitemap = siteUrl();
    const text = `User-agent: *\nAllow: /\n${sitemap ? `Sitemap: ${sitemap}/sitemap.xml\n` : ''}`;
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' }); return res.end(text);
  }
  if (req.url === '/landing.config.json') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': csp, 'x-content-type-options': 'nosniff' });
    return res.end(fs.readFileSync(path.join(__dirname, 'landing.config.json')));
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`) && file !== path.join(root, 'index.html')) { res.writeHead(403); return res.end(); }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': path.basename(file) === 'index.html' ? 'public, max-age=60, stale-while-revalidate=300' : /\.[a-f0-9]{8,}\./i.test(file) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600', 'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}).listen(Number(process.env.PORT) || 8080, '0.0.0.0');
