import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';

const routeModule = await import('../src/app/api/[...path]/route.ts');

function headerValue(headers, name) {
  if (headers instanceof Headers) return headers.get(name);
  return headers?.[name.toLowerCase()] ?? headers?.[name];
}

function assertAdminAudience(calls) {
  assert.ok(calls.length > 0, 'backendFetch debe invocar al backend');
  for (const call of calls) {
    assert.equal(headerValue(call.options.headers, 'x-app-audience'), 'admin');
  }
}

test('todas las rutas del BFF fuerzan X-App-Audience: admin en servidor', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  try {
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/auth/login')) {
        return new Response(JSON.stringify({ success: false, error: 'Credenciales inválidas' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const loginReq = new NextRequest('http://localhost:3001/api/admin/auth/login', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3001',
        host: 'localhost:3001',
        'x-app-audience': 'provider',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'admin@example.test', password: 'not-a-real-password' }),
    });
    const loginRes = await routeModule.POST(loginReq, { params: Promise.resolve({ path: ['admin', 'auth', 'login'] }) });
    assert.equal(loginRes.status, 401);
    assertAdminAudience(calls.splice(0));

    const logoutReq = new NextRequest('http://localhost:3001/api/admin/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3001',
        host: 'localhost:3001',
        'x-requested-with': 'XMLHttpRequest',
        cookie: 'glow_access_token=access; glow_refresh_token=refresh',
        'x-app-audience': 'salon',
      },
    });
    const logoutRes = await routeModule.POST(logoutReq, { params: Promise.resolve({ path: ['admin', 'auth', 'logout'] }) });
    assert.equal(logoutRes.status, 200);
    assertAdminAudience(calls.splice(0));

    const generalReq = new NextRequest('http://localhost:3001/api/metrics/summary', {
      headers: {
        host: 'attacker.example',
        cookie: 'glow_access_token=cookie-access',
        authorization: 'Bearer browser-token',
        'x-app-audience': 'client',
      },
    });
    const generalRes = await routeModule.GET(generalReq, { params: Promise.resolve({ path: ['metrics', 'summary'] }) });
    assert.equal(generalRes.status, 200);
    const generalCalls = calls.splice(0);
    assertAdminAudience(generalCalls);
    const forwarded = generalCalls[0].options.headers;
    assert.equal(headerValue(forwarded, 'host'), undefined);
    assert.equal(headerValue(forwarded, 'cookie'), undefined);
    assert.equal(headerValue(forwarded, 'authorization'), 'Bearer cookie-access');

    let generalCount = 0;
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ success: true, accessToken: 'refreshed-access', refreshToken: 'refreshed-refresh' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      generalCount += 1;
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: generalCount === 1 ? 401 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const retryReq = new NextRequest('http://localhost:3001/api/metrics/summary', {
      headers: {
        host: 'localhost:3001',
        cookie: 'glow_access_token=expired; glow_refresh_token=refresh-cookie',
        authorization: 'Bearer browser-token',
        'x-app-audience': 'client',
      },
    });
    const retryRes = await routeModule.GET(retryReq, { params: Promise.resolve({ path: ['metrics', 'summary'] }) });
    assert.equal(retryRes.status, 200);
    const retryCalls = calls.splice(0);
    assert.equal(retryCalls.length, 3, 'debe cubrir proxy inicial, refresh y reintento');
    assertAdminAudience(retryCalls);
    assert.equal(headerValue(retryCalls[0].options.headers, 'host'), undefined);
    assert.equal(headerValue(retryCalls[0].options.headers, 'cookie'), undefined);
    assert.equal(headerValue(retryCalls[0].options.headers, 'authorization'), 'Bearer expired');
    assert.equal(headerValue(retryCalls[1].options.headers, 'authorization'), undefined);
    assert.equal(headerValue(retryCalls[2].options.headers, 'authorization'), 'Bearer refreshed-access');
  } finally {
    global.fetch = originalFetch;
  }
});
