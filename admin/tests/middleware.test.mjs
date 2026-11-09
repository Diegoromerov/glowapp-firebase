/**
 * Contratos estáticos del portero del panel (guardia de sesión del panel admin T-A1).
 *
 * Desde el arreglo del atajo por extensión, la DECISIÓN vive en src/lib/portero.ts (sin
 * dependencias, para poder ejercerla de verdad en middleware-behavior.test.mjs) y
 * src/middleware.ts es el adaptador que la usa. Estos contratos comprueban las dos piezas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = join(import.meta.dirname, '..', 'src');
const mwPath = join(src, 'middleware.ts');
const mw = readFileSync(mwPath, 'utf8').replace(/\r\n/g, '\n');
const porPath = join(src, 'lib', 'portero.ts');
const por = readFileSync(porPath, 'utf8').replace(/\r\n/g, '\n');

test('existe src/middleware.ts y exporta middleware + config', () => {
  assert.ok(existsSync(mwPath));
  assert.match(mw, /export async function middleware\(request: NextRequest\)/);
  assert.match(mw, /export const config = \{/);
});

test('el middleware usa la decisión de portero.ts (no la reimplementa)', () => {
  assert.match(mw, /import \{ clasificarCamino \} from '\.\/lib\/portero'/);
  assert.match(mw, /clasificarCamino\(pathname\) !== 'protegido'/);
});

test('/login y /register son rutas públicas', () => {
  assert.match(por, /export const CAMINOS_PUBLICOS = \['\/login', '\/register'\]/);
});

test('las cookies de sesión reconocidas incluyen glow_access_token', () => {
  assert.match(mw, /glow_access_token/);
});

test('obtiene token de cookies HttpOnly', () => {
  assert.match(mw, /request\.cookies\.get\('glow_access_token'\)\?\.value/);
});

test('la firma JWT se verifica con jose jwtVerify', () => {
  assert.match(mw, /const secretKey = getJwtSecretKey\(\)/);
  assert.match(mw, /if \(!secretKey\) \{/);
  assert.match(mw, /jwtVerify\(token, secretKey\)/);
});

test('el panel es exclusivo de ADMIN: cualquier otro rol o token inválido se rechaza', () => {
  assert.match(mw, /role !== 'ADMIN'/);
  assert.match(mw, /return withSecurityHeaders\(redirectToLogin\(request, pathname\)\)/);
});

test('sin sesión en ruta protegida redirige a /login', () => {
  assert.match(mw, /if \(!token\) \{\s*\n\s*return withSecurityHeaders\(redirectToLogin\(request, pathname\)\)/);
});

test('redirectToLogin conserva la ruta original en el parámetro redirect', () => {
  assert.match(mw, /new URL\('\/login', request\.url\)/);
  assert.match(mw, /loginUrl\.searchParams\.set\('redirect', pathname\)/);
});

test('las rutas /api son gestionadas por sus controladores / BFF proxy', () => {
  assert.match(por, /pathname\.startsWith\('\/api'\)/);
});

test('el atajo por extensión NO existe: lo público es una lista explícita', () => {
  // Este caso antes afirmaba el atajo (`/\.[a-zA-Z0-9]+$/.test(pathname)`) como si fuera una
  // propiedad deseada, con lo que el defecto estaba blindado por una prueba. Ahora afirma lo
  // contrario. Se quitan los comentarios antes de mirar, porque la documentación de portero.ts
  // cita el atajo a propósito; y se busca un token sin barras invertidas, porque la versión
  // anterior quedó sobre-escapeada y no podía coincidir con nada: pasaba siempre, incluso con
  // el defecto dentro.
  const sinComentarios = por
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  assert.ok(
    !sinComentarios.includes('.test('),
    'hay una expresión regular decidiendo quién pasa por el portero: volvió el atajo por extensión'
  );
  assert.match(por, /export const ASSETS_PUBLICOS = new Set\(\[/);
  assert.match(por, /if \(ASSETS_PUBLICOS\.has\(pathname\)\)/);
});

test('el matcher excluye _next/static, _next/image, favicon.ico', () => {
  assert.match(mw, /_next\/static/);
  assert.match(mw, /_next\/image/);
  assert.match(mw, /favicon\.ico/);
});
