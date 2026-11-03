// backend/tests/biometricConsent.unified.test.js
/**
 * TEST de la tarjeta t_fix_secapp_01 — P0 «DOS middlewares de consentimiento
 * biométrico divergentes (granted vs active)» (FASE C · AUD-SECAPP-01 P0 #1,
 * backend/src/middleware/biometricConsent.js:46).
 *
 * Reproduce la fuga: biometricConsentGuard autorizaba con la columna legado
 * `active` (migración 026), mientras verifyConsent()/consentService autorizan
 * con `granted = TRUE AND revoked_at IS NULL`. Como `active` no cambia al
 * revocar, un consentimiento REVOCADO seguía pasando el guard.
 *
 * El mock de `pool.query` modela el filtrado SQL de cada query, de modo que el
 * caso "revocado" es ROJO antes del fix (el guard lo autorizaba) y VERDE después
 * (el criterio único lo deniega). No requiere red ni base de datos.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn() },
}));

const { pool } = require('../src/config/db');
const biometricConsentGuard = require('../src/middleware/biometricConsentGuard');
const { hasAnyValidConsent, VALID_CONSENT_SQL_PREDICATE } = require('../src/middleware/biometricConsent');

const GUARD_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'middleware', 'biometricConsentGuard.js'),
  'utf8'
);
const MC_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'middleware', 'biometricConsent.js'),
  'utf8'
);

// Fixture mutable: filas de biometric_consents del usuario de prueba.
let consentRows = [];

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockReq(user = { id: 1 }) {
  return { user, ip: '127.0.0.1', originalUrl: '/api/biometric/analyze' };
}

beforeEach(() => {
  jest.clearAllMocks();
  consentRows = [];
  // Modela el filtrado SQL de cada variante de query.
  pool.query.mockImplementation((query) => {
    const q = String(query);
    if (/active\s*=\s*true/i.test(q)) {
      // Criterio divergente (columna legado): no mira revoked_at.
      return Promise.resolve({ rows: consentRows.filter((r) => r.active === true) });
    }
    if (/revoked_at\s+IS\s+NULL/i.test(q) || /\bgranted\b/i.test(q)) {
      // Criterio canónico.
      return Promise.resolve({ rows: consentRows.filter((r) => r.granted === true && !r.revoked_at) });
    }
    return Promise.resolve({ rows: [] });
  });
});

describe('t_fix_secapp_01 — criterio único de consentimiento biométrico', () => {
  test('ROJO/VERDE: consentimiento REVOCADO no pasa el guard (403)', async () => {
    consentRows = [
      { id: 1, consent_type: 'all_biometric', granted: false, revoked_at: '2026-09-30T18:00:00Z', active: true },
    ];
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await biometricConsentGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('consentimiento VÁLIDO (granted y no revocado) autoriza (next)', async () => {
    consentRows = [
      { id: 2, consent_type: 'all_biometric', granted: true, granted_at: '2026-09-01T00:00:00Z', revoked_at: null, active: true },
    ];
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await biometricConsentGuard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.biometricConsent).toMatchObject({ id: 2, granted: true });
  });

  test('consentimiento DENEGADO (granted=false) no autoriza (403)', async () => {
    consentRows = [
      { id: 3, consent_type: 'all_biometric', granted: false, revoked_at: null, active: true },
    ];
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await biometricConsentGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('sin consentimiento → 403 MISSING_VALID_CONSENT', async () => {
    consentRows = [];
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await biometricConsentGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MISSING_VALID_CONSENT' })
    );
  });

  test('usuario no autenticado → 401', async () => {
    const req = mockReq(null);
    const res = mockRes();
    const next = jest.fn();

    await biometricConsentGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('hasAnyValidConsent consulta con el criterio canónico (granted + revoked_at)', async () => {
    consentRows = [];
    await hasAnyValidConsent(1);
    const query = String(pool.query.mock.calls[0][0]);
    expect(query).toMatch(/\bgranted\b/);
    expect(query).toMatch(/revoked_at\s+IS\s+NULL/i);
    expect(query).not.toMatch(/\bactive\b/i);
    expect(VALID_CONSENT_SQL_PREDICATE).toBe('granted = TRUE AND revoked_at IS NULL');
  });

  test('el guard ya NO autoriza con la columna legado `active`', () => {
    expect(GUARD_SRC).not.toMatch(/\bactive\b/i);
    expect(GUARD_SRC).toMatch(/require\(\s*['"]\.\/biometricConsent['"]\s*\)/);
    expect(GUARD_SRC).toMatch(/hasAnyValidConsent/);
    expect(GUARD_SRC).not.toMatch(/MISSING_ACTIVE_CONSENT/);
    // El criterio canónico está documentado/centralizado en biometricConsent.js
    expect(MC_SRC).toMatch(/VALID_CONSENT_SQL_PREDICATE/);
    expect(MC_SRC).toMatch(/hasAnyValidConsent/);
  });
});
