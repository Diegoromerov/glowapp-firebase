const express = require('express');
const crypto = require('crypto');
const request = require('supertest');

jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.user = { id: 17 }; next(); },
}));
jest.mock('../src/middleware/saasContext', () => (
  (req, _res, next) => { req.saas = { tenantId: 'tenant-own', role: 'ADMIN' }; next(); }
));
jest.mock('../src/middleware/featureGate', () => ({
  requireEntitlement: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const { pool } = require('../src/config/db');
const app = express();
app.use(express.json());
app.use('/api/saas/api-keys', require('../src/routes/saasApiKeyRoutes'));

describe('POST /api/saas/api-keys/verify', () => {
  beforeEach(() => pool.query.mockReset());

  test('checks a key through the restricted lookup and returns its own tenant without counting usage', async () => {
    const apiKey = `gsk_live_${crypto.randomBytes(24).toString('base64url')}`;
    pool.query.mockResolvedValue({ rows: [{
      id: 'key-id', tenant_id: 'tenant-own', tenant_name: 'Own salon',
      saas_plan: 'PRO', scopes: ['read'],
    }] });

    const response = await request(app).post('/api/saas/api-keys/verify').send({ apiKey });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ valid: true, tenant: { id: 'tenant-own', plan: 'PRO' }, scopes: ['read'] });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('saas_api_key_lookup');
    expect(pool.query.mock.calls[0][1]).toEqual([crypto.createHash('sha256').update(apiKey).digest('hex')]);
  });

  test('does not reveal another tenant key or plan details', async () => {
    const apiKey = `gsk_live_${crypto.randomBytes(24).toString('base64url')}`;
    pool.query.mockResolvedValue({ rows: [{
      id: 'foreign-key', tenant_id: 'tenant-other', tenant_name: 'Other salon',
      saas_plan: 'PRO', scopes: ['read'],
    }] });

    const response = await request(app).post('/api/saas/api-keys/verify').send({ apiKey });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ valid: false, error: 'API key inválida, expirada o revocada' });
  });

  test('rejects a key with an invalid format before querying storage', async () => {
    const response = await request(app).post('/api/saas/api-keys/verify').send({ apiKey: 'wrong-prefix' });
    expect(response.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
