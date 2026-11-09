/**
 * Contratos estáticos de src/lib/api-client.ts para T-A1 (BFF Proxy + CSRF).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = join(import.meta.dirname, '..', 'src');
const apiPath = join(src, 'lib', 'api-client.ts');
const api = readFileSync(apiPath, 'utf8').replace(/\r\n/g, '\n');

test('existe src/lib/api-client.ts', () => {
  assert.ok(existsSync(apiPath));
});

test('el baseURL es relativo para canalizar llamadas a través del BFF proxy', () => {
  assert.match(api, /baseURL:\s*''/);
});

test('getBookings enruta a /api/bookings/provider solo para prestador', () => {
  assert.match(
    api,
    /rol\s*===\s*'prestador'\s*\?\s*'\/api\/bookings\/provider'\s*:\s*'\/api\/bookings\/client'/,
    'la ruta de citas debe depender del rol (provider vs client)'
  );
});

test('getBookings NO llama al endpoint inexistente GET /api/bookings', () => {
  assert.doesNotMatch(
    api,
    /\.get\(\s*['"`]\/api\/bookings['"`]\s*\)/,
    'el backend no expone GET /api/bookings (solo /provider y /client)'
  );
});

test('getBookings normaliza respuestas { data: [] }, arrays y nulos a array', () => {
  assert.match(api, /Array\.isArray\(payload\)/);
  assert.match(api, /payload\.data/);
  assert.match(api, /return \[\]/);
});

test('cancelBooking usa PATCH /api/bookings/:id/cancel', () => {
  assert.match(api, /this\.client\.patch\(`\/api\/bookings\/\$\{id\}\/cancel`/);
});

test('updateProfile usa PATCH /api/users/profile (no PUT)', () => {
  assert.match(
    api,
    /this\.client\.patch\('\/api\/users\/profile',\s*data\)/,
    'el backend expone PATCH /api/users/profile'
  );
  assert.doesNotMatch(api, /this\.client\.put\(\s*['"`]\/api\/users\/profile/);
});

test('el interceptor de request adjunta el encabezado CSRF X-Requested-With', () => {
  assert.match(api, /config\.headers\['X-Requested-With'\]\s*=\s*'XMLHttpRequest'/);
});

test('el interceptor de respuesta limpia sesión y redirige a /login ante 401', () => {
  assert.match(api, /error\.response\?\.status\s*===\s*401/);
  assert.match(api, /clearClientSession\(\)/);
  assert.match(api, /window\.location\.href\s*=\s*'\/login'/);
});

test('clearClientSession invoca logout en BFF y no usa localStorage para credenciales', () => {
  assert.match(api, /\/api\/admin\/auth\/logout/);
  assert.doesNotMatch(api, /localStorage\.setItem/);
});

test('clearClientSession es no-op fuera del navegador', () => {
  assert.match(api, /typeof window === 'undefined'\s*\)?\s*return/);
});

test('exporta una instancia singleton apiClient', () => {
  assert.match(api, /export const apiClient = new ApiClient\(\)/);
});
