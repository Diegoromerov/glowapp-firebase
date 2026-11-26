// Race the final resource slot against PostgreSQL, not an in-memory DB stub.
const crypto = require('crypto');
const { Pool } = require('pg');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../src/config/jwt');
const { crearControladorOps } = require('../src/controllers/salonOpsController');
const salonRoutes = require('../src/routes/salonRoutes');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const APP_URL = process.env.DATABASE_URL;
const describeWithPostgres = ADMIN_URL && APP_URL ? describe : describe.skip;

describeWithPostgres('SaaS resource quota concurrency on PostgreSQL', () => {
  let adminPool;
  let verticalId;
  let userId;
  let outsiderId;
  let ownerEmail;
  let outsiderEmail;
  let ownerMembershipId;
  let profileId;
  let salonId;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    verticalId = crypto.randomUUID();
    profileId = crypto.randomUUID();
    await adminPool.query(
      'INSERT INTO business_verticals (id, code, name, description) VALUES ($1, $2, $3, $4)',
      [verticalId, 'RQUOTA_' + verticalId, 'Resource quota test', 'Ephemeral CI fixture']
    );
    ownerEmail = 'resource-quota-' + crypto.randomUUID() + '@test.local';
    const user = await adminPool.query(
      "INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id, rol, tenant_id) VALUES ($1, $2, $3, 'LOCAL', $1, 'SALON', 1) RETURNING id",
      [ownerEmail, 'integration-test-only', 'Resource quota test']
    );
    userId = user.rows[0].id;
    outsiderEmail = 'resource-outsider-' + crypto.randomUUID() + '@test.local';
    const outsider = await adminPool.query(
      "INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id, rol, tenant_id) VALUES ($1, $2, $3, 'LOCAL', $1, 'SALON', 1) RETURNING id",
      [outsiderEmail, 'integration-test-only', 'Resource quota outsider']
    );
    outsiderId = outsider.rows[0].id;
    await adminPool.query(
      `INSERT INTO business_profiles
         (id, provider_id, vertical_id, name, tenant_id, saas_plan)
       VALUES ($1, $2, $3, $4, $5, 'BASIC')`,
      [profileId, userId, verticalId, 'Resource quota ' + profileId, profileId]
    );
    const salon = await adminPool.query(
      `INSERT INTO salones (id_dueno, nombre_salon, business_profile_id, plan_saas, tenant_id)
       VALUES ($1, $2, $3, 'BASIC', 1) RETURNING id`,
      [userId, 'Resource quota ' + profileId, profileId]
    );
    salonId = salon.rows[0].id;
    ownerMembershipId = crypto.randomUUID();
    const membershipClient = await adminPool.connect();
    try {
      await membershipClient.query('BEGIN');
      await membershipClient.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);
      await membershipClient.query(
        `INSERT INTO memberships
           (id, user_id, business_profile_id, role, status, created_by_user_id, sub_rol)
         VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', $2, 'DUEÑO')`,
        [ownerMembershipId, userId, profileId]
      );
      await membershipClient.query('COMMIT');
    } catch (error) {
      await membershipClient.query('ROLLBACK');
      throw error;
    } finally {
      membershipClient.release();
    }
    for (let i = 1; i <= 4; i += 1) {
      await adminPool.query(
        `INSERT INTO recursos_alquilables (tenant_id, salon_id, nombre, tipo)
         VALUES ($1, $2, $3, 'PUESTO')`,
        [profileId, salonId, 'Existing resource ' + i]
      );
    }
  });

  afterAll(async () => {
    if (!adminPool) return;
    if (salonId) await adminPool.query('DELETE FROM recursos_alquilables WHERE salon_id = $1', [salonId]);
    if (profileId) {
      await adminPool.query('ALTER TABLE membership_audit_logs DISABLE TRIGGER USER');
      await adminPool.query('DELETE FROM membership_audit_logs WHERE business_profile_id = $1', [profileId]);
      await adminPool.query('ALTER TABLE membership_audit_logs ENABLE TRIGGER USER');
      await adminPool.query('ALTER TABLE memberships DISABLE TRIGGER trg_prevent_unsafe_membership_change');
      await adminPool.query('DELETE FROM memberships WHERE business_profile_id = $1', [profileId]);
      await adminPool.query('ALTER TABLE memberships ENABLE TRIGGER trg_prevent_unsafe_membership_change');
    }
    if (salonId) await adminPool.query('DELETE FROM salones WHERE id = $1', [salonId]);
    if (profileId) await adminPool.query('DELETE FROM business_profiles WHERE id = $1', [profileId]);
    if (userId || outsiderId) await adminPool.query('DELETE FROM usuarios WHERE id = ANY($1::integer[])', [[userId, outsiderId].filter(Boolean)]);
    if (verticalId) await adminPool.query('DELETE FROM business_verticals WHERE id = $1', [verticalId]);
    await adminPool.end();
  });

  function makeRequest(nombre) {
    return {
      salonId,
      salonMembership: { sub_rol: 'DUEÑO' },
      body: { nombre, tipo: 'PUESTO' },
    };
  }

  function makeResponse() {
    const res = { statusCode: null, body: null };
    res.status = (statusCode) => { res.statusCode = statusCode; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
  }

  test('two simultaneous creations cannot exceed the final Basic resource slot', async () => {
    const controller = crearControladorOps(adminPool);
    const responses = [makeResponse(), makeResponse()];
    await Promise.all([
      controller.crearRecurso(makeRequest('Concurrent resource A'), responses[0]),
      controller.crearRecurso(makeRequest('Concurrent resource B'), responses[1]),
    ]);

    expect(responses.map((res) => res.statusCode).sort()).toEqual([201, 403]);
    const rejected = responses.find((res) => res.statusCode === 403);
    expect(rejected.body).toMatchObject({ code: 'SAAS_QUOTA_EXCEEDED', feature: 'RESOURCES', current: 5, limit: 5 });
    const count = await adminPool.query(
      'SELECT COUNT(*)::int AS count FROM recursos_alquilables WHERE salon_id = $1',
      [salonId]
    );
    expect(count.rows[0].count).toBe(5);
  }, 30000);

  test('authenticated HTTP route enforces salon membership, RLS context and the same quota', async () => {
    // Isolate this HTTP scenario from the direct-controller concurrency case.
    await adminPool.query('DELETE FROM recursos_alquilables WHERE salon_id = $1', [salonId]);
    for (let i = 1; i <= 4; i += 1) {
      await adminPool.query(
        `INSERT INTO recursos_alquilables (tenant_id, salon_id, nombre, tipo)
         VALUES ($1, $2, $3, 'PUESTO')`,
        [profileId, salonId, 'HTTP baseline resource ' + i]
      );
    }
    const app = express();
    app.use(express.json());
    app.use('/api/salon', salonRoutes);
    app.use((error, _req, res, _next) => {
      console.error('Salon resource HTTP integration failed:', error.message);
      res.status(500).json({ error: 'Internal test request failure' });
    });
    const tokenFor = (id, email) => jwt.sign({ id, email }, getJwtSecret(), { expiresIn: '5m' });

    const outsiderToken = tokenFor(outsiderId, outsiderEmail);
    await request(app)
      .post(`/api/salon/${salonId}/recursos`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ nombre: 'Outsider resource', tipo: 'PUESTO' })
      .expect(403);

    const ownerToken = tokenFor(userId, ownerEmail);
    const responses = await Promise.all([
      request(app)
        .post(`/api/salon/${salonId}/recursos`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ nombre: 'HTTP concurrent A', tipo: 'PUESTO' }),
      request(app)
        .post(`/api/salon/${salonId}/recursos`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ nombre: 'HTTP concurrent B', tipo: 'PUESTO' }),
    ]);
    if (responses.some((res) => ![201, 403].includes(res.status))) {
      console.error('Unexpected salon resource HTTP responses:', JSON.stringify(responses.map(({ status, body }) => ({ status, body }))));
    }
    expect(responses.map((res) => res.status).sort()).toEqual([201, 403]);
    expect(responses.find((res) => res.status === 403).body).toMatchObject({
      code: 'SAAS_QUOTA_EXCEEDED', feature: 'RESOURCES', current: 5, limit: 5,
    });
    const count = await adminPool.query(
      'SELECT COUNT(*)::int AS count FROM recursos_alquilables WHERE salon_id = $1',
      [salonId]
    );
    expect(count.rows[0].count).toBe(5);
  }, 30000);
});
