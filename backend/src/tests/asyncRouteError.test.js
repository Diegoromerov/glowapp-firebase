// backend/src/tests/asyncRouteError.test.js
const express = require('express');
const request = require('supertest');
const { wrapRouterAsync } = require('../utils/expressAsync');

describe('FASE 1 — Robustez de excepciones async en rutas Express', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    const router = express.Router();
    router.get('/test-async-throw', async (req, res) => {
      // Handler async que falla deliberadamente
      throw new Error('Error deliberado en handler async de prueba');
    });

    // Envolver router con wrapRouterAsync
    wrapRouterAsync(router);
    app.use('/api/test-async', router);

    // Express 4 error middleware
    app.use((err, req, res, next) => {
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    });
  });

  test('un handler async envuelto que lanza devuelve 500 y no tumba el proceso', async () => {
    const res = await request(app).get('/api/test-async/test-async-throw');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error');
    expect(res.body.message).toBe('Error deliberado en handler async de prueba');
  });
});
