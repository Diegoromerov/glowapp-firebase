'use strict';
process.env.NODE_ENV = 'test';
const previousTestRateLimit = process.env.TEST_RATE_LIMIT;
process.env.TEST_RATE_LIMIT = 'true';
jest.mock('../config/publicPool', () => ({ connect: jest.fn() }));
jest.mock('../config/tenantRouting', () => ({ runAsSystem: jest.fn().mockResolvedValue({}) }));

const express = require('express');
const request = require('supertest');
const router = require('../routes/public/leads');

afterAll(() => {
  if (previousTestRateLimit === undefined) delete process.env.TEST_RATE_LIMIT;
  else process.env.TEST_RATE_LIMIT = previousTestRateLimit;
});

describe('límites de POST /api/public/leads', () => {
  test('responde 429 al superar 5 solicitudes por minuto desde la misma IP', async () => {
    process.env.TURNSTILE_SECRET = 'test-secret';
    process.env.LANDING_IP_HASH_SALT = 'test-salt';
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ success: true }) });
    const app = express();
    app.use('/api/public', express.json({ limit: '4kb' }));
    app.use('/api/public', router);
    const body = { role: 'client', name: 'Ana', contactType: 'email', contact: 'ana@example.com', city: 'Bogotá', neighborhood: 'Chapinero', consent: true, consentTextVersion: 'v1', turnstileToken: 'token', website: '' };
    const statuses = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push((await request(app).post('/api/public/leads').send(body)).status);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });
});
