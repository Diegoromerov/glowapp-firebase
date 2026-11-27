jest.mock('../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { id: 42 };
    return next();
  },
}));
jest.mock('../middleware/saasContext', () => (req, _res, next) => {
  req.saas = { tenantId: 'tenant-qa', plan: 'FREEMIUM', role: 'OWNER' };
  return next();
});

const express = require('express');
const request = require('supertest');
const { pool } = require('../config/db');
const apiKeyRoutes = require('../routes/saasApiKeyRoutes');

const app = express();
app.use(express.json());
app.use('/api/saas/api-keys', apiKeyRoutes);

describe('Entitlement de gestión de API keys', () => {
  beforeEach(() => jest.clearAllMocks());

  test('FREEMIUM no puede editar una API key existente', async () => {
    const response = await request(app)
      .patch('/api/saas/api-keys/key-1')
      .send({ expiresInDays: 365 });

    expect(response.status).toBe(403);
    expect(response.body.required).toBe('API_KEYS');
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('FREEMIUM conserva la capacidad de revocar una clave anterior', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'key-1', name: 'Legacy', revoked_at: new Date() }] });

    const response = await request(app).post('/api/saas/api-keys/key-1/revoke');

    expect(response.status).toBe(200);
    expect(response.body.apiKey.id).toBe('key-1');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
