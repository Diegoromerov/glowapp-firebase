/**
 * backend/src/tests/biometricConsentGuard.test.js
 * TEST ROJO: Reproduce el hallazgo VETO - UUID/INTEGER mismatch en biometricConsentGuard
 * 
 * Hallazgo: biometricConsentGuard.js usa parseInt(userId,10) esperando INTEGER
 * pero migración 037 y consentService usan UUID. JWT trae id INTEGER desde usuarios.id SERIAL.
 * Resultado: todos usuarios legítimos reciben 403 CONSENT_DENIED.
 * 
 * D-001/D-002 decidieron: tenant_id INTEGER; biometric_consents debe usar INTEGER consistente con usuarios.id
 */
const request = require('supertest');
const express = require('express');
const pg = require('pg');
const biometricConsentGuard = require('../middleware/biometricConsentGuard');

jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockPool = require('../config/db').pool;

describe('biometricConsentGuard - VETO UUID/INTEGER mismatch', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    
    app = express();
    app.use(express.json());
    
    // Mock autenticación - JWT trae id INTEGER desde usuarios.id SERIAL
    app.use((req, res, next) => {
      req.user = { id: 123 }; // INTEGER como viene del JWT
      next();
    });
    
    app.get('/api/biometric/scan', biometricConsentGuard, (req, res) => {
      res.json({ success: true, message: 'Biometric scan authorized' });
    });
  });

  test('ROJO: Usuario con id INTEGER legítimo debe ser AUTORIZADO (no 403)', async () => {
    // Simular que existe consentimiento activo para user_id = 123 (INTEGER)
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        version: '1.0',
        accepted_at: new Date().toISOString(),
      }],
    });

    const response = await request(app)
      .get('/api/biometric/scan')
      .set('Authorization', 'Bearer valid-jwt-token');

    // Este test DEBE FALLAR inicialmente porque biometricConsentGuard usa parseInt(userId, 10)
    // pero la query SQL pasa el INTEGER parseado a una columna UUID
    // Lo que causa que no encuentre el consentimiento y retorne 403
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('ROJO: parseInt no debe corromper userId INTEGER válido', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        version: '1.0',
        accepted_at: new Date().toISOString(),
      }],
    });

    const response = await request(app)
      .get('/api/biometric/scan')
      .set('Authorization', 'Bearer valid-jwt-token');

    // Verificar que la query SQL recibió el userId correcto (INTEGER, no string parseado)
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('user_id = $1'),
      expect.arrayContaining([123]) // Debe ser INTEGER 123, no "123" string
    );
  });

  test('Debe rechazar usuario SIN consentimiento activo (403)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get('/api/biometric/scan')
      .set('Authorization', 'Bearer valid-jwt-token');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('CONSENT_DENIED');
    // El middleware emite MISSING_VALID_CONSENT (biometricConsentGuard.js:36) y
    // tests/biometricConsent.unified.test.js:151 PROHIBE el string viejo. Asertar
    // MISSING_ACTIVE_CONSENT contradecia al propio repo.
    expect(response.body.code).toBe('MISSING_VALID_CONSENT');
  });

  test('Debe rechazar usuario NO autenticado (401)', async () => {
    const appNoAuth = express();
    appNoAuth.use(express.json());
    appNoAuth.use((req, res, next) => {
      req.user = null; // Sin usuario
      next();
    });
    appNoAuth.get('/api/biometric/scan', biometricConsentGuard, (req, res) => {
      res.json({ success: true });
    });

    const response = await request(appNoAuth)
      .get('/api/biometric/scan');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHORIZED');
  });
});