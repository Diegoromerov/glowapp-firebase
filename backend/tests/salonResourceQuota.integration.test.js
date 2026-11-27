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
  let serviceId;
  const staffIds = [];
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
    if (serviceId) {
      await adminPool.query('DELETE FROM salon_servicio_insumos WHERE service_id = $1', [serviceId]);
      await adminPool.query('DELETE FROM services WHERE id = $1', [serviceId]);
    }
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
    if (userId || outsiderId || staffIds.length) {
      await adminPool.query('DELETE FROM usuarios WHERE id = ANY($1::integer[])', [[userId, outsiderId, ...staffIds].filter(Boolean)]);
    }
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

  test('authenticated resource entitlement follows the canonical tenant plan when the legacy salon plan is stale', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/salon', salonRoutes);
    app.use((error, _req, res, _next) => {
      console.error('Salon entitlement HTTP integration failed:', error.message);
      res.status(500).json({ error: 'Internal test request failure' });
    });
    const token = jwt.sign({ id: userId, email: ownerEmail }, getJwtSecret(), { expiresIn: '5m' });
    const getResources = () => request(app)
      .get(`/api/salon/${salonId}/recursos`)
      .set('Authorization', `Bearer ${token}`);
    const getInventory = () => request(app)
      .get(`/api/salon/${salonId}/inventario`)
      .set('Authorization', `Bearer ${token}`);

    try {
      // A downgrade in the canonical subscription profile must beat a stale
      // legacy salon copy that still says BASIC.
      await adminPool.query("UPDATE business_profiles SET saas_plan = 'FREEMIUM' WHERE id = $1", [profileId]);
      await adminPool.query("UPDATE salones SET plan_saas = 'BASIC' WHERE id = $1", [salonId]);
      for (const response of [await getResources(), await getInventory()]) {
        expect(response.status).toBe(403);
        expect(response.body.currentPlan).toBe('FREEMIUM');
      }

      // Conversely, a stale Freemium copy cannot hide a module included in the
      // current canonical BASIC plan.
      await adminPool.query("UPDATE business_profiles SET saas_plan = 'BASIC' WHERE id = $1", [profileId]);
      await adminPool.query("UPDATE salones SET plan_saas = 'FREEMIUM' WHERE id = $1", [salonId]);
      const [resources, inventory] = await Promise.all([getResources(), getInventory()]);
      expect(resources.status).toBe(200);
      expect(inventory.status).toBe(200);
      expect(inventory.body).toMatchObject({ success: true, items: [] });
    } finally {
      await adminPool.query("UPDATE business_profiles SET saas_plan = 'BASIC' WHERE id = $1", [profileId]);
      await adminPool.query("UPDATE salones SET plan_saas = 'BASIC' WHERE id = $1", [salonId]);
    }
  }, 30000);

  test('inventory reads and writes follow OWNER, ADMIN, MANAGER and MEMBER permissions under RLS', async () => {
    const staff = {};
    for (const [key, role, subRole] of [
      ['admin', 'ADMIN', 'ADMINISTRADOR'],
      ['manager', 'MANAGER', 'RECEPCIONISTA'],
      ['member', 'MEMBER', 'EMPLEADO'],
    ]) {
      const email = `resource-${key}-${crypto.randomUUID()}@test.local`;
      const created = await adminPool.query(
        "INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id, rol, tenant_id) VALUES ($1, $2, $3, 'LOCAL', $1, 'SALON', 1) RETURNING id",
        [email, 'integration-test-only', `Resource ${key}`]
      );
      const memberId = created.rows[0].id;
      staffIds.push(memberId);
      const client = await adminPool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);
        await client.query(
          `INSERT INTO memberships
             (id, user_id, business_profile_id, role, status, created_by_user_id, sub_rol)
           VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6)`,
          [crypto.randomUUID(), memberId, profileId, role, userId, subRole]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      staff[key] = { id: memberId, email };
    }

    const app = express();
    app.use(express.json());
    app.use('/api/salon', salonRoutes);
    app.use((error, _req, res, _next) => {
      console.error('Salon inventory role integration failed:', error.message);
      res.status(500).json({ error: 'Internal test request failure' });
    });
    const tokenFor = (id, email) => jwt.sign({ id, email }, getJwtSecret(), { expiresIn: '5m' });
    const callAs = (identity, method, path, body) => {
      const call = request(app)[method](path).set('Authorization', `Bearer ${tokenFor(identity.id, identity.email)}`);
      return body === undefined ? call : call.send(body);
    };
    const itemName = `QA inventory ${crypto.randomUUID()}`;
    let createdItemId;

    try {
      for (const identity of [{ id: userId, email: ownerEmail }, staff.admin, staff.manager, staff.member]) {
        await callAs(identity, 'get', `/api/salon/${salonId}/inventario`).expect(200);
      }

      const item = await callAs(staff.admin, 'post', `/api/salon/${salonId}/inventario`, {
        nombre: itemName, categoria: 'INSUMO', unidad: 'UNIDAD', stock_inicial: 3,
      }).expect(201);
      createdItemId = item.body.item.id;
      expect(Number(item.body.item.stock_actual)).toBe(3);

      await callAs(staff.manager, 'post', `/api/salon/${salonId}/inventario/${createdItemId}/movimientos`, {
        tipo: 'SALIDA', cantidad: 1, motivo: 'integration role test', idempotency_key: `role-${crypto.randomUUID()}`,
      }).expect(201);

      const service = await adminPool.query(
        `INSERT INTO services (id, provider_id, name, price, duration_minutes, tenant_id, business_profile_id, salon_id)
         VALUES ($1, $2, $3, 10000, 30, 1, $4, $5) RETURNING id`,
        [crypto.randomUUID(), userId, `QA service ${crypto.randomUUID()}`, profileId, salonId]
      );
      serviceId = service.rows[0].id;
      // Recipes are enabled by Prueba Gratis, not BASIC; grant the fixture's
      // canonical plan only for the recipe-specific HTTP checks below.
      await adminPool.query("UPDATE business_profiles SET saas_plan = 'FREE_TRIAL' WHERE id = $1", [profileId]);
      await adminPool.query("UPDATE salones SET plan_saas = 'FREE_TRIAL' WHERE id = $1", [salonId]);
      await callAs(staff.admin, 'put', `/api/salon/${salonId}/services/${serviceId}/inventory`, {
        items: [{ item_id: createdItemId, cantidad: 1 }],
      }).expect(200);
      const recipe = await callAs(staff.member, 'get', `/api/salon/${salonId}/services/${serviceId}/inventory`).expect(200);
      expect(recipe.body.items).toHaveLength(1);
      expect(recipe.body.items[0]).toMatchObject({ item_id: createdItemId, cantidad: 1 });
      await callAs(staff.member, 'put', `/api/salon/${salonId}/services/${serviceId}/inventory`, {
        items: [{ item_id: createdItemId, cantidad: 2 }],
      }).expect(403);

      await callAs(staff.member, 'post', `/api/salon/${salonId}/inventario`, {
        nombre: `Denied inventory ${crypto.randomUUID()}`,
      }).expect(403);
      await callAs(staff.member, 'post', `/api/salon/${salonId}/inventario/${createdItemId}/movimientos`, {
        tipo: 'ENTRADA', cantidad: 1, idempotency_key: `denied-${crypto.randomUUID()}`,
      }).expect(403);

      const history = await callAs(staff.member, 'get', `/api/salon/${salonId}/inventario/${createdItemId}/movimientos`).expect(200);
      expect(history.body.total).toBeGreaterThanOrEqual(2);
    } finally {
      await adminPool.query("UPDATE business_profiles SET saas_plan = 'BASIC' WHERE id = $1", [profileId]);
      await adminPool.query("UPDATE salones SET plan_saas = 'BASIC' WHERE id = $1", [salonId]);
      if (createdItemId) {
        if (serviceId) await adminPool.query('DELETE FROM salon_servicio_insumos WHERE service_id = $1', [serviceId]);
        await adminPool.query('DELETE FROM inventario_movimientos WHERE item_id = $1', [createdItemId]);
        await adminPool.query('DELETE FROM inventario_salon WHERE id = $1', [createdItemId]);
      }
      if (serviceId) await adminPool.query('DELETE FROM services WHERE id = $1', [serviceId]);
    }
  }, 30000);
});
