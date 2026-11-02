#!/usr/bin/env node
/**
 * backend/scripts/qaSaasE2E.js
 * FASE 5 — arnés E2E del ciclo SaaS completo:
 *   registro → onboarding (salón) → bootstrap del tenant → invitar equipo →
 *   cambio de plan → API key → uso → consola SuperAdmin.
 *
 * Se ejecuta contra un entorno de STAGING. Crea datos reales: por eso se niega a
 * correr contra producción salvo que se pase --force de forma explícita.
 *
 *   node scripts/qaSaasE2E.js --base=https://staging.example.com \
 *     --email=qa+<timestamp>@glowapp.test --password=... [--admin-email=... --admin-password=...]
 *
 * Salida: una línea PASS/FAIL por paso y código de salida 1 si algo falla.
 */

require('dotenv').config();

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

const BASE = (arg('base') || process.env.QA_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const FORCE = process.argv.includes('--force');
const EMAIL = arg('email') || `qa+${Date.now()}@glowapp.test`;
const PASSWORD = arg('password') || 'QaTemporal123!';
const ADMIN_EMAIL = arg('admin-email');
const ADMIN_PASSWORD = arg('admin-password');

const results = [];
let token = null;

function record(step, ok, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  ::  ${detail}` : ''}`);
}

async function call(method, path, body, auth = token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

(async () => {
  console.log(`QA SaaS E2E · ${BASE}`);
  if (BASE.includes('belleza-app-production') && !FORCE) {
    console.error('ABORTADO: este entorno es producción y el arnés crea cuentas. Usa staging o --force.');
    process.exit(2);
  }

  // 1. Registro
  const reg = await call('POST', '/api/auth/register', {
    email: EMAIL,
    password: PASSWORD,
    nombre: 'QA Automático',
    telefono: '+573000000000',
    rol: 'SALON',
  }, null);
  record('1. registro', [200, 201].includes(reg.status), `HTTP ${reg.status}`);
  token = reg.json?.token || reg.json?.accessToken || null;
  if (!token && reg.status === 409) {
    const login = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD }, null);
    token = login.json?.token || login.json?.accessToken || null;
    record('1b. login (cuenta ya existente)', Boolean(token), `HTTP ${login.status}`);
  }
  if (!token) {
    record('1c. token de sesión', false, 'sin token no se puede continuar');
    return finish();
  }

  // 2. Onboarding: crear salón
  const salon = await call('POST', '/api/salones', {
    nombre: `QA Salón ${Date.now()}`,
    ciudad: 'Bogotá',
    telefono: '+573000000000',
  });
  record('2. onboarding (salón)', [200, 201].includes(salon.status), `HTTP ${salon.status}`);

  // 3. Bootstrap del tenant — idempotente por diseño
  const boot1 = await call('POST', '/api/saas/bootstrap', { plan: 'FREE_TRIAL' });
  const boot2 = await call('POST', '/api/saas/bootstrap', { plan: 'FREE_TRIAL' });
  const idempotente = boot1.status < 300 && boot2.status < 300 &&
    boot1.json?.profile?.id === boot2.json?.profile?.id;
  record('3. bootstrap de tenant (idempotente)', idempotente,
    `HTTP ${boot1.status}/${boot2.status} · profile ${boot1.json?.profile?.id || 'n/a'}`);

  const profileId = boot1.json?.profile?.id;

  // 4. Invitar miembro
  const invite = await call('POST', `/api/saas/team/${profileId}/invite`, {
    email: `invitado+${Date.now()}@glowapp.test`,
    role: 'MEMBER',
  });
  record('4. invitar equipo', [200, 201, 409].includes(invite.status), `HTTP ${invite.status}`);
  const team = await call('GET', `/api/saas/team/${profileId}`);
  const members = team.json?.members || team.json?.memberships || [];
  record('4b. listar equipo', team.status === 200 && Array.isArray(members),
    `HTTP ${team.status} · ${members.length} miembros`);

  // 5. Cambio de plan (sin pagar: solo se exige que la API responda con un contrato válido)
  const plan = await call('POST', '/api/saas/billing/checkout', { plan: 'BASIC', successUrl: `${BASE}/ok`, cancelUrl: `${BASE}/no` });
  record('5. checkout de plan', [200, 201, 400, 402, 503].includes(plan.status),
    `HTTP ${plan.status}${plan.json?.url ? ' · url de pago presente' : ''}`);
  const summary = await call('GET', '/api/saas/billing/summary');
  record('5b. resumen de facturación', summary.status === 200, `HTTP ${summary.status}`);

  // 6. API key
  const key = await call('POST', '/api/saas/api-keys', { name: 'QA', scopes: ['read'], expiresInDays: 7 });
  const rawKey = key.json?.key || key.json?.apiKey || null;
  record('6. crear API key', [200, 201].includes(key.status) && Boolean(rawKey),
    `HTTP ${key.status}${rawKey ? ' · key devuelta una sola vez' : ''}`);
  const keys = await call('GET', '/api/saas/api-keys');
  const list = keys.json?.keys || keys.json?.apiKeys || [];
  record('6b. listar API keys', keys.status === 200 && Array.isArray(list), `HTTP ${keys.status} · ${list.length}`);

  // 7. Uso
  const usage = await call('GET', '/api/saas/usage');
  record('7. uso del tenant', usage.status === 200, `HTTP ${usage.status}`);

  // 8. Consola SuperAdmin (requiere credenciales de plataforma)
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    record('8. consola SuperAdmin', false,
      'OMITIDO: faltan --admin-email/--admin-password (y SUPER_ADMIN_EMAILS configurada)');
  } else {
    const adminLogin = await call('POST', '/api/auth/login',
      { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, null);
    const adminToken = adminLogin.json?.token || adminLogin.json?.accessToken || null;
    const dash = await call('GET', '/api/superadmin/dashboard', null, adminToken);
    record('8. consola SuperAdmin', dash.status === 200,
      `HTTP ${dash.status}${dash.status === 403 ? ' · el guard rechaza: revisar SUPER_ADMIN_EMAILS' : ''}`);
  }

  finish();
})().catch((error) => {
  record('error inesperado', false, error.message);
  finish();
});

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} pasos OK`);
  if (failed.length) {
    console.log('Fallos:');
    for (const f of failed) console.log(`  - ${f.step}: ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}
