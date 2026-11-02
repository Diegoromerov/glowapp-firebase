// backend/src/tests/contract/biometric-scan.contract.test.js
/**
 * Test Contractual para /api/biometric/analyze y /api/consent (Sprint 3.1)
 * Valida Envelope de respuesta unificado, tiempos de respuesta (<300ms p95) y manejo de errores.
 */
const request = require('supertest');
const express = require('express');
const biometricRoutes = require('../../routes/biometricRoutes');
const biometricConsentRoutes = require('../../routes/biometricConsentRoutes');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Middleware Mock de Autenticación
app.use((req, res, next) => {
  if (req.headers.authorization === 'Bearer valid-jwt-token') {
    req.user = { id: '7', role: 'user' };
  }
  next();
});

app.use('/api/biometric', biometricRoutes);
app.use('/api/consent', biometricConsentRoutes);

describe('Sprint 3.1 — Contractual API & UX Alignment Tests', () => {

  test('1. Validar SLA de tiempo de respuesta (<300ms) en comprobación de estado de consentimiento', async () => {
    const startTime = Date.now();

    const res = await request(app)
      .get('/api/consent/status/7')
      .set('Authorization', 'Bearer valid-jwt-token');

    const duration = Date.now() - startTime;

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('hasActiveConsent');
    expect(duration).toBeLessThan(300); // SLA UX Premium < 300ms
  });

  test('2. Validar rechazo con Envelope de error estandarizado en falta de Idempotency-Key', async () => {
    const res = await request(app)
      .post('/api/biometric/analyze')
      .set('Authorization', 'Bearer valid-jwt-token')
      .send({ faceImage: 'dummyBase64' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: 'VALIDATION_ERROR',
      code: 'MISSING_IDEMPOTENCY_KEY',
    });
  });

  test('3. Validar rechazo con Envelope de error en peticiones sin autenticar (401)', async () => {
    const res = await request(app)
      .post('/api/biometric/analyze')
      .set('Idempotency-Key', 'test-uuid-contract-123')
      .send({ faceImage: 'dummyBase64' });

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      error: 'UNAUTHORIZED',
      message: expect.any(String),
    });
  });

});
