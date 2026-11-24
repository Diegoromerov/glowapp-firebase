'use strict';

const express = require('express');
const request = require('supertest');

const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
};

jest.mock('../config/db', () => ({ pool: mockPool }));
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { id: 27 };
    next();
  },
}));

const router = require('../routes/saasBootstrapRoutes');

function transactionClient() {
  const queries = [];
  const client = {
    queries,
    release: jest.fn(),
    query: jest.fn(async (sql, params = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: normalized, params });
      if (normalized.startsWith('INSERT INTO business_profiles')) {
        return {
          rows: [{
            id: params[0],
            name: params[3],
            saas_plan: params[5],
            tenant_id: params[4],
          }],
        };
      }
      if (normalized.startsWith('UPDATE salones')) {
        return { rows: [{ business_profile_id: params[0] }] };
      }
      return { rows: [] };
    }),
  };
  return client;
}

describe('POST /api/saas/bootstrap — recuperación del tenant del salón', () => {
  let app;
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    client = transactionClient();
    mockPool.connect.mockResolvedValue(client);
    app = express();
    app.use(express.json());
    app.use('/api/saas/bootstrap', router);
  });

  test('conserva el plan existente del salón heredado aunque el cliente envíe FREE_TRIAL', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // findTenant: aún no está provisionado
      .mockResolvedValueOnce({
        rows: [{
          id: 91,
          nombre_salon: 'Studio Central',
          business_profile_id: null,
          plan_saas: 'PRO',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'vertical-beauty' }] })
      .mockResolvedValueOnce({
        rows: [{
          membership_id: 'membership-91',
          role: 'OWNER',
          status: 'ACTIVE',
          business_profile_id: 'salon-91',
          name: 'Studio Central',
          saas_plan: 'PRO',
          tenant_id: 'tenant-91',
        }],
      });

    const response = await request(app)
      .post('/api/saas/bootstrap')
      .send({ plan: 'FREE_TRIAL' });

    expect(response.status).toBe(201);
    expect(response.body.profile.plan).toBe('PRO');
    const profileInsert = client.queries.find((query) =>
      query.sql.startsWith('INSERT INTO business_profiles'));
    expect(profileInsert.params[5]).toBe('PRO');
    expect(mockPool.query.mock.calls[1][0]).toContain('plan_saas');
  });

  test('rechaza un plan legado desconocido sin provisionarlo como FREE_TRIAL', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 92,
          nombre_salon: 'Studio Legacy',
          business_profile_id: null,
          plan_saas: 'ENTERPRISE_PRO',
        }],
      });

    const response = await request(app)
      .post('/api/saas/bootstrap')
      .send({ plan: 'FREE_TRIAL' });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/conservar tu suscripción/i);
    expect(client.queries).toHaveLength(0);
  });
});
