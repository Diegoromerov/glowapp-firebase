const express = require('express');
const request = require('supertest');

const mockPool = { query: jest.fn() };

jest.mock('../src/config/db', () => ({ pool: mockPool, systemPool: mockPool }));
jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { id: 73 };
    next();
  },
}));
jest.mock('../src/middleware/saasContext', () => (req, _res, next) => {
  req.saas = { tenantId: 'usage-alert-test-tenant', plan: 'PRO', role: 'OWNER' };
  next();
});

const router = require('../src/routes/saasUsageRoutes');

describe('POST /api/saas/usage/alerts', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/saas/usage', router);
  });

  test('no acepta ni guarda avisos externos mientras email/webhook no se entreguen', async () => {
    const response = await request(app)
      .post('/api/saas/usage/alerts')
      .send({ feature: 'DIRECT_BOOKINGS', thresholdPercent: 80, channel: 'email' });

    expect(response.status).toBe(501);
    expect(response.body).toMatchObject({ error: 'USAGE_ALERT_DELIVERY_UNAVAILABLE' });
    expect(response.body.message).toMatch(/panel de uso muestra avisos dentro de GlowApp/i);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
