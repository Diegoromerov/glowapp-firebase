/**
 * backend/src/tests/contract/critical-endpoints.contract.test.js
 *
 * FIX-FLUTTER-09 (P1) — Segunda mitad del contract testing.
 *
 * openapi.contract.test.js comprueba que el contrato CUBRA las rutas montadas.
 * Este test comprueba lo contrario: que el comportamiento real de las rutas
 * críticas (auth, booking, payment, admin) COINCIDA con lo declarado en el
 * contrato OpenAPI versionado.
 *
 * Se montan los routers críticos directamente sobre una app Express limpia:
 * el app completo (index.js) responde 503 a todo /api en modo degradado sin BD,
 * lo que impediría observar el contrato real de autenticación/validación.
 *
 * Cada probe fija (a) el código de estado esperado — si el comportamiento cambia,
 * el test se pone rojo — y (b) que ese estado esté declarado en el contrato.
 */

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const { CRITICAL_PROBES, CRITICAL_MOUNTS } = require('../../openapi/criticalContract');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..');
const SPEC_PATH = path.join(BACKEND_ROOT, 'openapi', 'openapi.json');

function buildContractApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const mounts = new Set();
  Object.values(CRITICAL_MOUNTS).forEach((list) => {
    list.forEach(([prefix, modulePath]) => mounts.add(`${prefix}|${modulePath}`));
  });

  mounts.forEach((entry) => {
    const [prefix, modulePath] = entry.split('|');
    // eslint-disable-next-line global-require, import/no-dynamic-require
    app.use(prefix, require(modulePath));
  });

  return app;
}

function loadSpec() {
  return JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
}

describe('FIX-FLUTTER-09 — Comportamiento real ↔ contrato OpenAPI (auth/booking/payment/admin)', () => {
  let app;
  let spec;

  beforeAll(() => {
    app = buildContractApp();
    spec = loadSpec();
  });

  test('el contrato versionado existe antes de validar comportamiento', () => {
    expect(spec.openapi).toBe('3.0.0');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  test('los probes cubren las cuatro áreas críticas del hallazgo', () => {
    const areas = new Set(
      CRITICAL_PROBES.map((p) => p.key.split(' ')[1].split('/')[2]).map((s) => s)
    );
    ['auth', 'bookings', 'payments', 'admin'].forEach((area) => {
      expect([...areas]).toContain(area);
    });
  });

  test('toda operación crítica probada existe en el contrato', () => {
    const missingKeys = CRITICAL_PROBES.map((p) => p.key).filter((key) => {
      const [method, openapiPath] = key.split(' ');
      const item = spec.paths[openapiPath];
      return !item || !item[method.toLowerCase()];
    });
    expect(missingKeys).toEqual([]);
  });

  CRITICAL_PROBES.forEach((probe) => {
    const [method, openapiPath] = probe.key.split(' ');
    const label = `${method} ${openapiPath}${
      probe.request.body && Object.keys(probe.request.body).length === 0 ? ' (cuerpo vacío)' : ''
    }`;

    test(`contrato: ${label} ⇒ ${probe.expectStatus}`, async () => {
      let req = request(app)[probe.request.method](probe.request.path);
      if (probe.request.body !== undefined) req = req.send(probe.request.body);
      const res = await req;

      // (a) comportamiento real
      expect(res.status).toBe(probe.expectStatus);
      probe.expectBodyKeys.forEach((key) => {
        expect(Object.keys(res.body)).toContain(key);
      });

      // (b) el contrato declarado incluye ese código de estado
      const operation = spec.paths[openapiPath][method.toLowerCase()];
      expect(Object.keys(operation.responses)).toContain(String(res.status));

      // (c) coherencia de seguridad: si la operación es autenticada, el 401 debe
      //     estar declarado con el esquema bearerAuth.
      if (Array.isArray(operation.security) && operation.security.length > 0) {
        expect(Object.keys(operation.responses)).toContain('401');
        expect(operation.security[0]).toHaveProperty('bearerAuth');
      }

      // (d) ninguna operación crítica puede ser un stub autodescubierto
      expect(operation['x-glowapp-documented']).toBe(true);
      expect(operation['x-glowapp-critical']).toBe(true);
    });
  });

  test('el webhook de Wompi es público por diseño y no exige bearer', () => {
    const webhook = spec.paths['/api/payments/wompi-webhook'].post;
    expect(webhook.security).toEqual([]);
    expect(webhook['x-glowapp-area']).toBe('payment');
  });

  test('las operaciones de admin declaran el 403 (rol insuficiente)', () => {
    ['/api/admin/dashboard', '/api/admin/disputes', '/api/admin/disputes/{id}/resolve'].forEach(
      (p) => {
        const operation = p === '/api/admin/disputes/{id}/resolve' ? spec.paths[p].put : spec.paths[p].get;
        expect(Object.keys(operation.responses)).toContain('403');
      }
    );
  });
});
