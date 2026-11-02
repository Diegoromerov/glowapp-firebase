// backend/src/tests/rateLimiting.test.js
const express = require('express');
const request = require('supertest');
const rateLimit = require('express-rate-limit');

describe('FASE 5 — Rate Limiting en autenticación y pagos', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    // Limitador de prueba con límite bajo (3 peticiones) para test rápido
    const testAuthLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 3,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Demasiados intentos de autenticación.' }
    });

    app.post('/api/test-auth/login', testAuthLimiter, (req, res) => {
      res.json({ ok: true });
    });
  });

  test('al superar el límite de solicitudes responde 429 con cabecera Retry-After', async () => {
    // 3 peticiones permitidas
    await request(app).post('/api/test-auth/login').send({});
    await request(app).post('/api/test-auth/login').send({});
    await request(app).post('/api/test-auth/login').send({});

    // 4ta petición debe ser bloqueada con 429
    const res = await request(app).post('/api/test-auth/login').send({});

    expect(res.status).toBe(429);
    expect(res.headers).toHaveProperty('retry-after');
    expect(res.body.error).toContain('Demasiados intentos');
  });
});
