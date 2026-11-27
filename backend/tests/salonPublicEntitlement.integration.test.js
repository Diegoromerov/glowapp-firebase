const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.user = { id: 987654, tenant_id: null }; next(); },
}));
jest.mock('../src/services/salonLoyaltyService', () => ({
  customerSummary: jest.fn(async ({ salonId }) => ({ salon_id: salonId, balance: 0, movements: [] })),
  customerRewards: jest.fn(async ({ salonId }) => ({ salon_id: salonId, enabled: true, rewards: [] })),
  redeem: jest.fn(async () => ({ redemption: { id: 'qa-redemption' }, alreadyProcessed: false })),
}));

const { customerRewards } = require('../src/services/salonLoyaltyService');
const router = require('../src/routes/salonLoyaltyCustomerRoutes');
const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const APP_URL = process.env.DATABASE_URL;
const describeWithPostgres = ADMIN_URL && APP_URL ? describe : describe.skip;

describeWithPostgres('public salon entitlement lookup with PostgreSQL RLS', () => {
  let adminPool;
  let app;
  let tenantId;
  let ownerId;
  let salonId;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    const suffix = crypto.randomUUID();
    const tenant = await adminPool.query(
      'INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id',
      ['Public entitlement test', `public-entitlement-${suffix}`]
    );
    tenantId = tenant.rows[0].id;
    const ownerEmail = `public-entitlement-${suffix}@test.local`;
    const owner = await adminPool.query(
      `INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id, rol, tenant_id)
       VALUES ($1, 'integration-test-only', 'Entitlement Test Owner', 'LOCAL', $1, 'SALON', $2)
       RETURNING id`,
      [ownerEmail, tenantId]
    );
    ownerId = owner.rows[0].id;
    const salon = await adminPool.query(
      `INSERT INTO salones (tenant_id, id_dueno, nombre_salon, plan_saas)
       VALUES ($1, $2, 'Public Entitlement Test Salon', 'GROWTH') RETURNING id`,
      [tenantId, ownerId]
    );
    salonId = salon.rows[0].id;

    app = express();
    app.use(express.json());
    app.use('/api/salon-loyalty', router);
  });

  afterAll(async () => {
    if (!adminPool) return;
    if (salonId) await adminPool.query('DELETE FROM salones WHERE id = $1', [salonId]);
    if (ownerId) await adminPool.query('DELETE FROM usuarios WHERE id = $1', [ownerId]);
    if (tenantId) await adminPool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await adminPool.end();
  });

  test('authenticated customer without a salon tenant can reach a different tenant salon with LOYALTY', async () => {
    const response = await request(app).get(`/api/salon-loyalty/salons/${salonId}/rewards`);
    expect(response.status).toBe(200);
    expect(response.body.salon_id).toBe(salonId);
    expect(customerRewards).toHaveBeenCalledWith({ salonId });
  }, 30000);

  test('the RLS-scoped system lookup still blocks a salon whose plan lacks LOYALTY', async () => {
    await adminPool.query("UPDATE salones SET plan_saas = 'FREEMIUM' WHERE id = $1", [salonId]);
    customerRewards.mockClear();
    const response = await request(app).get(`/api/salon-loyalty/salons/${salonId}/rewards`);
    expect(response.status).toBe(403);
    expect(response.body.required).toBe('LOYALTY');
    expect(response.body.currentPlan).toBeUndefined();
    expect(customerRewards).not.toHaveBeenCalled();
    await adminPool.query("UPDATE salones SET plan_saas = 'GROWTH' WHERE id = $1", [salonId]);
  }, 30000);
});
