// admin-dashboard/tests/bff-csrf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server.js';

const src = join(import.meta.dirname, '..', 'src');
const routePath = join(src, 'app', 'api', '[...path]', 'route.ts');
const securityPath = join(src, 'lib', 'security.ts');

const routeModule = await import('../src/app/api/[...path]/route.ts');

test('BFF Behavioral: POST/PUT/PATCH/DELETE sin X-Requested-With ni X-CSRF-Token retorna 403', async () => {
  const req = new NextRequest('http://localhost:3001/api/services/update', {
    method: 'POST',
    headers: {
      'origin': 'http://localhost:3001',
      'host': 'localhost:3001',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ name: 'Nuevo Servicio' })
  });

  const res = await routeModule.POST(req, { params: Promise.resolve({ path: ['services', 'update'] }) });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /CSRF/i);
});

test('BFF Behavioral: Origin ausente o diferente en mutaciones retorna 403', async () => {
  // Origin no coincide con host
  const reqMismatch = new NextRequest('http://localhost:3001/api/services/update', {
    method: 'POST',
    headers: {
      'origin': 'http://malicious-site.com',
      'host': 'localhost:3001',
      'x-requested-with': 'XMLHttpRequest',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ name: 'Ataque' })
  });

  const resMismatch = await routeModule.POST(reqMismatch, { params: Promise.resolve({ path: ['services', 'update'] }) });
  assert.equal(resMismatch.status, 403);
  const dataMismatch = await resMismatch.json();
  assert.match(dataMismatch.error, /CSRF/i);

  // Origin ausente
  const reqMissing = new NextRequest('http://localhost:3001/api/services/update', {
    method: 'POST',
    headers: {
      'host': 'localhost:3001',
      'x-requested-with': 'XMLHttpRequest'
    },
    body: JSON.stringify({ name: 'Prueba' })
  });

  const resMissing = await routeModule.POST(reqMissing, { params: Promise.resolve({ path: ['services', 'update'] }) });
  assert.equal(resMissing.status, 403);
  const dataMissing = await resMissing.json();
  assert.match(dataMissing.error, /CSRF/i);
});

test('BFF Behavioral: Rutas fuera de la lista blanca o con path traversal son rechazadas (404/403)', async () => {
  // Path traversal attempt
  const reqTraversal = new NextRequest('http://localhost:3001/api/admin/../secret', {
    method: 'GET'
  });
  const resTraversal = await routeModule.GET(reqTraversal, { params: Promise.resolve({ path: ['admin', '..', 'secret'] }) });
  assert.equal(resTraversal.status, 403);
  const dataTraversal = await resTraversal.json();
  assert.match(dataTraversal.error, /traversa|inválida/i);

  // Ruta fuera de la lista blanca
  const reqForbidden = new NextRequest('http://localhost:3001/api/internal/system-keys', {
    method: 'GET'
  });
  const resForbidden = await routeModule.GET(reqForbidden, { params: Promise.resolve({ path: ['internal', 'system-keys'] }) });
  assert.equal(resForbidden.status, 404);
  const dataForbidden = await resForbidden.json();
  assert.match(dataForbidden.error, /no autorizada/i);
});

test('BFF Behavioral: 401 del backend intenta refresh; si el refresh falla borra cookies y devuelve 401', async () => {
  const origFetch = global.fetch;
  try {
    global.fetch = async (url, opts) => {
      if (url.includes('/refresh')) {
        return new Response(JSON.stringify({ error: 'Refresh token revocado' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ error: 'Token expirado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const req = new NextRequest('http://localhost:3001/api/metrics/rag/summary', {
      method: 'GET',
      headers: {
        'cookie': 'glow_access_token=expired_token; glow_refresh_token=invalid_refresh_token'
      }
    });

    const res = await routeModule.GET(req, { params: Promise.resolve({ path: ['metrics', 'rag', 'summary'] }) });
    assert.equal(res.status, 401);

    // Verificar que las cookies de sesión se eliminan (maxAge=0 o valor vacío)
    const setCookieHeader = res.headers.get('set-cookie');
    assert.ok(setCookieHeader);
    assert.match(setCookieHeader, /glow_access_token=;/);
    assert.match(setCookieHeader, /glow_refresh_token=;/);
  } finally {
    global.fetch = origFetch;
  }
});

test('BFF Behavioral: Encabezados Authorization y Cookies del cliente son removidos en la solicitud al backend', async () => {
  const origFetch = global.fetch;
  let capturedHeaders = null;

  try {
    global.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const req = new NextRequest('http://localhost:3001/api/metrics/summary', {
      method: 'GET',
      headers: {
        'authorization': 'Bearer fake_client_token',
        'cookie': 'glow_access_token=valid_http_only_cookie'
      }
    });

    const res = await routeModule.GET(req, { params: Promise.resolve({ path: ['metrics', 'summary'] }) });
    assert.equal(res.status, 200);
    assert.ok(capturedHeaders);
    // Debe usar el token de la cookie HttpOnly, ignorando el Authorization falsificado del cliente
    assert.equal(capturedHeaders['authorization'], 'Bearer valid_http_only_cookie');
  } finally {
    global.fetch = origFetch;
  }
});

test('BFF Behavioral: Multipart / file / CSV body pasa íntegro al backend', async () => {
  const origFetch = global.fetch;
  let capturedBody = null;

  try {
    global.fetch = async (url, opts) => {
      capturedBody = opts.body;
      return new Response(JSON.stringify({ success: true, count: 5 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const csvContent = 'id,nombre,precio\n1,Corte de Cabello,25000\n2,Manicura,15000';
    const req = new NextRequest('http://localhost:3001/api/precios/upload-csv', {
      method: 'POST',
      headers: {
        'origin': 'http://localhost:3001',
        'host': 'localhost:3001',
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'text/csv'
      },
      body: csvContent
    });

    const res = await routeModule.POST(req, { params: Promise.resolve({ path: ['precios', 'upload-csv'] }) });
    assert.equal(res.status, 200);
    assert.ok(capturedBody);
    assert.ok(capturedBody instanceof ArrayBuffer);
    const textDecoder = new TextDecoder();
    assert.equal(textDecoder.decode(capturedBody), csvContent);
  } finally {
    global.fetch = origFetch;
  }
});

test('E2 CSP: la política CSP restringe connect-src strictly a \'self\'', () => {
  const securityCode = readFileSync(securityPath, 'utf8').replace(/\r\n/g, '\n');
  assert.match(securityCode, /connect-src 'self'/);
  assert.doesNotMatch(securityCode, /connect-src 'self' https:/);
});
