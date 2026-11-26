// Race the final resource slot against PostgreSQL, not an in-memory DB stub.
const crypto = require('crypto');
const { Pool } = require('pg');
const { crearControladorOps } = require('../src/controllers/salonOpsController');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const APP_URL = process.env.DATABASE_URL;
const describeWithPostgres = ADMIN_URL && APP_URL ? describe : describe.skip;

describeWithPostgres('SaaS resource quota concurrency on PostgreSQL', () => {
  let adminPool;
  let verticalId;
  let userId;
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
    const user = await adminPool.query(
      "INSERT INTO usuarios (email, password_hash, nombre, auth_provider, provider_id) VALUES ($1, $2, $3, 'LOCAL', $1) RETURNING id",
      ['resource-quota-' + crypto.randomUUID() + '@test.local', 'integration-test-only', 'Resource quota test']
    );
    userId = user.rows[0].id;
    await adminPool.query(
      `INSERT INTO business_profiles
         (id, provider_id, vertical_id, name, tenant_id, saas_plan)
       VALUES ($1, $2, $3, $4, $5, 'BASIC')`,
      [profileId, userId, verticalId, 'Resource quota ' + profileId, 'resource-test-' + profileId]
    );
    const salon = await adminPool.query(
      `INSERT INTO salones (id_dueno, nombre_salon, business_profile_id, plan_saas)
       VALUES ($1, $2, $3, 'BASIC') RETURNING id`,
      [userId, 'Resource quota ' + profileId, profileId]
    );
    salonId = salon.rows[0].id;
    for (let i = 1; i <= 4; i += 1) {
      await adminPool.query(
        `INSERT INTO recursos_alquilables (tenant_id, salon_id, nombre, tipo)
         VALUES ($1, $2, $3, 'PUESTO')`,
        ['resource-test-' + profileId, salonId, 'Existing resource ' + i]
      );
    }
  });

  afterAll(async () => {
    if (!adminPool) return;
    if (salonId) await adminPool.query('DELETE FROM recursos_alquilables WHERE salon_id = $1', [salonId]);
    if (salonId) await adminPool.query('DELETE FROM salones WHERE id = $1', [salonId]);
    if (profileId) await adminPool.query('DELETE FROM business_profiles WHERE id = $1', [profileId]);
    if (userId) await adminPool.query('DELETE FROM usuarios WHERE id = $1', [userId]);
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
});
