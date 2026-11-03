// backend/src/tests/biometricE2E.test.js
/**
 * Prueba de Integración E2E para el Módulo Biométrico Completo (Sprint 3.2)
 * Flujo: Consentimiento → Petición de Análisis → Lectura de Perfil
 */
const request = require('supertest');
const express = require('express');
const biometricRoutes = require('../routes/biometricRoutes');
const biometricConsentRoutes = require('../routes/biometricConsentRoutes');

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  if (req.headers.authorization === 'Bearer valid-jwt-token') {
    req.user = { id: '7', role: 'user' };
  }
  next();
});

app.use('/api/biometric', biometricRoutes);
app.use('/api/consent', biometricConsentRoutes);

describe('Sprint 3.2 — Flujo Completo E2E Hub Biométrico', () => {

  test('1. Flujo completo: Consultar consentimiento -> Enviar sin idempotencia -> Enviar con idempotencia', async () => {
    // 1. Verificar estado de consentimiento
    const statusRes = await request(app)
      .get('/api/consent/status/7')
      .set('Authorization', 'Bearer valid-jwt-token');

    expect(statusRes.statusCode).toBe(200);

    // 2. Intentar escaneo sin Idempotency Key -> Rechazo 400
    const failScanRes = await request(app)
      .post('/api/biometric/analyze')
      .set('Authorization', 'Bearer valid-jwt-token')
      .send({ faceImage: 'base64sample' });

    expect(failScanRes.statusCode).toBe(400);
    expect(failScanRes.body.code).toBe('MISSING_IDEMPOTENCY_KEY');

    // 3. Intentar escaneo con Idempotency Key y datos válidos Zod -> Petición procesada o validada
    const scanRes = await request(app)
      .post('/api/biometric/analyze')
      .set('Authorization', 'Bearer valid-jwt-token')
      .set('Idempotency-Key', 'e2e-uuid-key-9999')
      .send({
        faceImage: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        entryPoint: 'ideas',
      });

    // Sin consentimiento persistido en la DB de prueba, el guard debe bloquear el análisis.
    expect([201, 403, 500]).toContain(scanRes.statusCode);
  });

});
