const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const fakePool = { query: async () => ({ rows: [] }) };
const originalLoad = Module._load;
Module._load = function loadWithDbStub(request, parent, isMain) {
  if (request === '../config/db' && parent?.filename.includes('salonOpsController.js')) {
    return { pool: fakePool };
  }
  if (request === '../config/db' && parent?.filename.includes('usageMeteringService.js')) {
    return { pool: fakePool };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { crearControladorOps } = require('../controllers/salonOpsController');
Module._load = originalLoad;

function createDb({ plan, current }) {
  const calls = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') return { rows: [] };
      if (normalized.includes('SELECT bp.tenant_id, bp.saas_plan')) {
        return { rows: [{ tenant_id: 'tenant-1', saas_plan: plan }] };
      }
      if (normalized.includes('SELECT COUNT(*)::int AS count FROM recursos_alquilables')) {
        return { rows: [{ count: current }] };
      }
      if (normalized.includes('INSERT INTO recursos_alquilables')) {
        return { rows: [{ id: 101, nombre: 'Puesto', tipo: 'PUESTO', canon_mensual: '0', estado: 'DISPONIBLE' }] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
    release() { calls.push('RELEASE'); },
  };
  return { calls, db: { connect: async () => client } };
}

function request() {
  return {
    salonId: 42,
    salonMembership: { sub_rol: 'DUEÑO' },
    body: { nombre: 'Puesto', tipo: 'PUESTO' },
  };
}

function response() {
  const res = { statusCode: null, body: null };
  res.status = (statusCode) => { res.statusCode = statusCode; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('salon resource quota is enforced in the same transaction as creation', async (t) => {
  await t.test('Basic permits creation below the five-resource limit', async () => {
    const { db, calls } = createDb({ plan: 'BASIC', current: 4 });
    const res = response();
    await crearControladorOps(db).crearRecurso(request(), res);
    assert.equal(res.statusCode, 201);
    assert.ok(calls.includes('BEGIN'));
    assert.ok(calls.includes('COMMIT'));
    assert.ok(calls.includes('RELEASE'));
  });

  await t.test('Basic blocks the sixth resource and rolls back', async () => {
    const { db, calls } = createDb({ plan: 'BASIC', current: 5 });
    const res = response();
    await crearControladorOps(db).crearRecurso(request(), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.feature, 'RESOURCES');
    assert.equal(res.body.limit, 5);
    assert.ok(calls.includes('ROLLBACK'));
    assert.ok(!calls.some((sql) => sql.includes('INSERT INTO recursos_alquilables')));
  });

  await t.test('trial keeps its explicitly unlimited resources', async () => {
    const { db } = createDb({ plan: 'FREE_TRIAL', current: 500 });
    const res = response();
    await crearControladorOps(db).crearRecurso(request(), res);
    assert.equal(res.statusCode, 201);
  });

  await t.test('Freemium cannot create a resource even if called directly', async () => {
    const { db, calls } = createDb({ plan: 'FREEMIUM', current: 0 });
    const res = response();
    await crearControladorOps(db).crearRecurso(request(), res);
    assert.equal(res.statusCode, 403);
    assert.ok(calls.includes('ROLLBACK'));
  });
});
