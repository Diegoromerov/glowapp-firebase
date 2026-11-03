/**
 * FIX-FLUTTER-10 — Guarda de trazabilidad de acciones admin (P2).
 *
 * Hallazgo: admin-dashboard/src/app/business/page.tsx:99-128 dispara acciones
 * sensibles de administración (aprobar/rechazar evidencia, generar documentos)
 * SIN que quede ningún registro persistente de quién hizo qué, cuándo, desde
 * qué IP/user-agent. Ver `handleReview` (líneas 99-128) y
 * `handleGenerateDocument` (líneas 131-165) -> backend
 * PUT /api/v1/business/admin/evidence/:id y POST /api/v1/business/documents/generate.
 *
 * Este test es una guarda EJECUTABLE CON NODE (sin node_modules, sin babel):
 *   node src/tests/adminAuditLog.test.mjs
 * y setea exitCode != 0 si el registro de trazabilidad no existe.
 * (jest.config.js solo matchea *.test.js, así que este archivo no lo levanta jest.)
 *
 * Comprueba:
 *   A. Migración append-only `admin_audit_logs` con las columnas del contrato.
 *   B. Repositorio que inserta en esa tabla.
 *   C. Middleware `adminAuditLog` que captura user_id, action, resource,
 *      resource_id, ip, user_agent, timestamp (comportamiento real, con sink inyectado).
 *   D. Rutas de negocio de administración cableadas con el middleware.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '../..');
const rel = (p) => path.relative(BACKEND, p).replace(/\\/g, '/');

// Los archivos del repo usan CRLF (core.autocrlf=true): normalizar siempre.
const read = (p) => fs.readFileSync(path.join(BACKEND, p), 'utf8').replace(/\r\n/g, '\n');
const exists = (p) => fs.existsSync(path.join(BACKEND, p));

const REQUIRED_FIELDS = ['user_id', 'action', 'resource', 'resource_id', 'ip', 'user_agent', 'timestamp'];

// ── mini runner (funciona con node directo y tolera un harness describe/it) ──
const results = [];
let chain = Promise.resolve();
const describe = globalThis.describe || ((name, fn) => fn());
function test(name, fn) {
  chain = chain.then(async () => {
    const t0 = Date.now();
    try {
      await fn();
      results.push({ name, ok: true, ms: Date.now() - t0 });
    } catch (err) {
      results.push({ name, ok: false, ms: Date.now() - t0, err });
    }
  });
}

// ── helper: extrae el bloque `router.<method>(...)` cuyo path coincide ──────
function routeBlock(src, method, pathFragment) {
  const marker = `router.${method}(`;
  let idx = src.indexOf(marker);
  while (idx !== -1) {
    // fin del bloque = siguiente `router.` o `);\nwrapRouterAsync` (cierre balanceado simple)
    const rest = src.slice(idx);
    const end = rest.search(/\n\s*router\.|wrapRouterAsync/);
    const block = end === -1 ? rest : rest.slice(0, end);
    if (block.includes(pathFragment)) return block;
    idx = src.indexOf(marker, idx + marker.length);
  }
  return null;
}

const MIGRATION = (() => {
  const dir = path.join(BACKEND, 'migrations');
  if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir).filter((f) => /admin_audit_logs/i.test(f) && f.endsWith('.sql'));
  return hits.length ? `migrations/${hits[0]}` : null;
})();

// ═════════════════════════════════════════════════════════════════════════
describe('FIX-FLUTTER-10 · A. tabla admin_audit_logs append-only', () => {
  test('existe la migración que crea admin_audit_logs', () => {
    assert.ok(MIGRATION, 'no hay migración *admin_audit_logs*.sql en backend/migrations');
  });

  test('la tabla declara todas las columnas del contrato', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS\s+admin_audit_logs/i, 'falta CREATE TABLE admin_audit_logs');
    for (const col of ['user_id', 'action', 'resource', 'resource_id', 'ip', 'user_agent', 'created_at']) {
      assert.match(sql, new RegExp(`\\b${col}\\b`, 'i'), `falta la columna ${col}`);
    }
  });

  test('es inmutable/append-only (bloquea UPDATE y DELETE)', () => {
    const sql = read(MIGRATION).toLowerCase();
    const trigger = /before\s+update\s+or\s+delete\s+on\s+admin_audit_logs/.test(sql)
      && /raise\s+exception/.test(sql);
    const revoked = /revoke\s+(update,\s*delete|update|delete)/.test(sql);
    assert.ok(trigger || revoked, 'la tabla no bloquea UPDATE/DELETE (ni trigger que RAIse ni REVOKE)');
  });
});

describe('FIX-FLUTTER-10 · B. repositorio de auditoría', () => {
  test('existe src/repositories/adminAuditRepository.js', () => {
    assert.ok(exists('src/repositories/adminAuditRepository.js'), 'no existe el repositorio de auditoría admin');
  });

  test('inserta en admin_audit_logs con todas las columnas', () => {
    const src = read('src/repositories/adminAuditRepository.js');
    assert.match(src, /INSERT INTO\s+admin_audit_logs/i, 'no inserta en admin_audit_logs');
    for (const col of ['user_id', 'action', 'resource', 'resource_id', 'ip', 'user_agent', 'created_at']) {
      assert.match(src, new RegExp(`\\b${col}\\b`), `el INSERT no incluye ${col}`);
    }
  });
});

describe('FIX-FLUTTER-10 · C. middleware captura el contrato completo', () => {
  test('existe src/middleware/adminAuditLog.js con la API esperada', () => {
    assert.ok(exists('src/middleware/adminAuditLog.js'), 'no existe el middleware adminAuditLog');
    const mod = require(path.join(BACKEND, 'src/middleware/adminAuditLog.js'));
    for (const exp of ['createAdminAuditMiddleware', 'buildAuditRecord', 'REQUIRED_FIELDS']) {
      assert.ok(mod[exp], `el middleware no exporta ${exp}`);
    }
    assert.deepEqual([...mod.REQUIRED_FIELDS].sort(), [...REQUIRED_FIELDS].sort());
  });

  test('construye el registro con user_id/action/resource/ip/user_agent/timestamp', () => {
    const { buildAuditRecord } = require(path.join(BACKEND, 'src/middleware/adminAuditLog.js'));
    const req = {
      user: { id: 'adm-77' },
      method: 'PUT',
      originalUrl: '/api/v1/business/admin/evidence/ev-9',
      params: { id: 'ev-9' },
      body: { action: 'APPROVED' },
      headers: { 'user-agent': 'GlowAdmin/1.0' },
      ip: '10.0.0.5',
    };
    const rec = buildAuditRecord(req, { statusCode: 200 }, { action: 'evidence.approved', resource: 'evidence' });
    assert.equal(rec.user_id, 'adm-77', 'user_id ausente');
    assert.equal(rec.action, 'evidence.approved');
    assert.equal(rec.resource, 'evidence');
    assert.equal(rec.resource_id, 'ev-9', 'resource_id no derivado de req.params.id');
    assert.equal(rec.ip, '10.0.0.5');
    assert.equal(rec.user_agent, 'GlowAdmin/1.0');
    assert.ok(!Number.isNaN(Date.parse(rec.timestamp)), 'timestamp inválido');
    for (const f of REQUIRED_FIELDS) assert.ok(f in rec, `falta el campo ${f}`);
  });

  test('respeta x-forwarded-for cuando no hay req.ip', () => {
    const { buildAuditRecord } = require(path.join(BACKEND, 'src/middleware/adminAuditLog.js'));
    const req = {
      user: { id: 'adm-1' }, method: 'POST', originalUrl: '/x', params: {},
      headers: { 'x-forwarded-for': '203.0.113.7, 10.1.1.1', 'user-agent': 'UA' },
    };
    const rec = buildAuditRecord(req, { statusCode: 200 }, { action: 'a', resource: 'r' });
    assert.equal(rec.ip, '203.0.113.7', 'no toma la primera IP de x-forwarded-for');
  });

  test('persiste el registro al terminar la respuesta (sink inyectado)', async () => {
    const { createAdminAuditMiddleware } = require(path.join(BACKEND, 'src/middleware/adminAuditLog.js'));
    const captured = [];
    const mw = createAdminAuditMiddleware({ sink: async (rec) => { captured.push(rec); } });
    const handler = mw('evidence.rejected', 'evidence');

    const listeners = {};
    const res = {
      statusCode: 200,
      on(evt, cb) { listeners[evt] = cb; return this; },
      emit(evt) { if (listeners[evt]) listeners[evt](); },
    };
    const req = {
      user: { id: 'adm-42' }, method: 'PUT', originalUrl: '/api/v1/business/admin/evidence/ev-1',
      params: { id: 'ev-1' }, headers: { 'user-agent': 'UA' }, ip: '127.0.0.1',
    };
    let nextCalled = false;
    await handler(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled, 'el middleware no llamó next() (bloquea la petición)');
    res.emit('finish');
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(captured.length, 1, 'no se persistió exactamente un registro de auditoría');
    const rec = captured[0];
    assert.equal(rec.action, 'evidence.rejected');
    assert.equal(rec.resource_id, 'ev-1');
    for (const f of REQUIRED_FIELDS) assert.ok(f in rec, `falta el campo ${f}`);
  });

  test('action puede derivarse del cuerpo (APPROVED/REJECTED)', () => {
    const { createAdminAuditMiddleware } = require(path.join(BACKEND, 'src/middleware/adminAuditLog.js'));
    const mw = createAdminAuditMiddleware({ sink: async () => {} });
    const handler = mw((req) => `evidence.${String(req.body.action).toLowerCase()}`, 'evidence');
    const listeners = {};
    const res = { statusCode: 200, on(e, cb) { listeners[e] = cb; return this; }, emit(e) { if (listeners[e]) listeners[e](); } };
    const req = { user: { id: 'a' }, method: 'PUT', originalUrl: '/', params: { id: 'x' }, body: { action: 'APPROVED' }, headers: {} };
    let nextCalled = false;
    handler(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    // El sink se invoca tras 'finish'; no debe lanzar con action función.
    assert.doesNotThrow(() => res.emit('finish'));
  });
});

describe('FIX-FLUTTER-10 · D. rutas admin cableadas', () => {
  test('PUT /admin/evidence/:id pasa por el middleware de auditoría', () => {
    const src = read('src/routes/businessRoutes.js');
    assert.match(src, /adminAuditLog/, 'businessRoutes no importa/usa adminAuditLog');
    const block = routeBlock(src, 'put', "'/admin/evidence/:id'");
    assert.ok(block, 'no se encontró la ruta PUT /admin/evidence/:id');
    assert.match(block, /adminAuditLog/, 'la ruta de aprobación/rechazo no registra auditoría');
  });

  test('POST /documents/generate (generar docs) registra auditoría', () => {
    const src = read('src/routes/businessRoutes.js');
    const block = routeBlock(src, 'post', "'/documents/generate'");
    assert.ok(block, 'no se encontró la ruta POST /documents/generate');
    assert.match(block, /adminAuditLog/, 'la generación de documentos no registra auditoría');
  });
});

// ── reporte ────────────────────────────────────────────────────────────────
await chain;
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${r.name} (${r.ms}ms)`);
  if (!r.ok) console.log(`       -> ${r.err.message}`);
}
console.log(`\nFIX-FLUTTER-10 audit log guard: ${results.length - failed.length}/${results.length} OK`);
if (failed.length) {
  console.error(`RED: ${failed.length} comprobación(es) sin satisfacer`);
  process.exitCode = 1;
} else {
  console.log('GREEN: trazabilidad de acciones admin verificada');
}
