// backend/src/tests/biometric.integration.test.js
/**
 * Test de Integración para el Hub Biométrico Refactorizado (Sprint 2.4 ADR-001)
 */
const request = require('supertest');
const express = require('express');
const biometricRoutes = require('../routes/biometricRoutes');
const biometricConsentRoutes = require('../routes/biometricConsentRoutes');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Mock simple de autenticación JWT para tests
app.use((req, res, next) => {
  if (req.headers.authorization === 'Bearer valid-jwt-token') {
    req.user = { id: '7', role: 'user' };
  }
  next();
});

app.use('/api/biometric', biometricRoutes);
app.use('/api/consent', biometricConsentRoutes);

describe('Biometric Hub - ADR-001 Verification Suite', () => {
  test('1. Debe rechazar /api/biometric/analyze sin JWT autenticado (401)', async () => {
    const res = await request(app)
      .post('/api/biometric/analyze')
      .set('Idempotency-Key', 'test-uuid-1234')
      .send({ faceImage: 'base64string' });

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  test('2. Debe rechazar /api/biometric/analyze sin Header Idempotency-Key (400)', async () => {
    const res = await request(app)
      .post('/api/biometric/analyze')
      .set('Authorization', 'Bearer valid-jwt-token')
      .send({ faceImage: 'base64string' });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  test('3. Debe rechazar /api/biometric/analyze con errores de validación Zod (400)', async () => {
    const res = await request(app)
      .post('/api/biometric/analyze')
      .set('Authorization', 'Bearer valid-jwt-token')
      .set('Idempotency-Key', 'test-uuid-5678')
      .send({}); // Body vacío

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
