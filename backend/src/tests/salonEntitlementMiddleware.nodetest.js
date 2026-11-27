const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let plan = 'BASIC';
let legacySalonPlan = 'FREEMIUM';
let queryError = null;
const rlsContext = [];
const client = {
  async query(sql, params = []) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (/set_config/i.test(sql)) {
      rlsContext.push(sql.includes('app.tenant_id') ? ['app.tenant_id', params[0]] : params);
    }
    if (/SELECT tenant_id FROM usuarios/i.test(sql)) return { rows: [{ tenant_id: 17 }] };
    if (/SELECT CASE\s+WHEN bp\.id IS NULL/i.test(sql)) {
      return { rows: [{ saas_plan: plan }] };
    }
    if (/SELECT bp\.saas_plan/i.test(sql)) {
      if (queryError) throw queryError;
      assert.equal(params[0], '42');
      assert.match(sql, /JOIN business_profiles bp ON bp\.id = s\.business_profile_id/);
      return { rows: [{ saas_plan: plan, plan_saas: legacySalonPlan }] };
    }
    return { rows: [] };
  },
  release() {},
};
const dbMock = {
  pool: {
    async query() { throw new Error('must use an RLS transaction'); },
    async connect() { return client; },
  },
  systemPool: null,
};

const originalLoad = Module._load;
Module._load = function loadWithDbStub(request, parent, isMain) {
  if (request === '../config/db' && parent?.filename.endsWith('salonEntitlement.js')) {
    return dbMock;
  }
  if (request === '../config/tenantRouting' && parent?.filename.endsWith('salonEntitlement.js')) {
    const actual = originalLoad.call(this, request, parent, isMain);
    return { ...actual, runAsSystem: async (_db, callback) => callback(client) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { requireSalonEntitlement, requirePublicSalonEntitlement } = require('../middleware/salonEntitlement');
Module._load = originalLoad;

async function invoke(capability) {
  const req = { params: { salonId: '42' }, body: {}, user: { id: 7 } };
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  let nextCalls = 0;
  await requireSalonEntitlement(capability)(req, res, () => { nextCalls += 1; });
  return { req, res, nextCalls };
}

test('salon entitlement allows included modules and blocks excluded modules', async (t) => {
  await t.test('Basic permits inventory and annotates resolved plan', async () => {
    plan = 'BASIC';
    rlsContext.length = 0;
    const { req, res, nextCalls } = await invoke('INVENTORY');
    assert.equal(nextCalls, 1);
    assert.equal(req.salonPlan, 'BASIC');
    assert.equal(res.statusCode, null);
    assert.deepEqual(rlsContext, [['app.user_id', '7'], ['app.tenant_id', '17']]);
  });

  await t.test('canonical Freemium downgrade blocks inventory even if legacy salon copy says Basic', async () => {
    plan = 'FREEMIUM';
    legacySalonPlan = 'BASIC';
    const { res, nextCalls } = await invoke('INVENTORY');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.required, 'INVENTORY');
    assert.equal(res.body.currentPlan, 'FREEMIUM');
    assert.equal(nextCalls, 0);
  });

  await t.test('Freemium accepts its non-fiscal receipt entitlement', async () => {
    plan = 'FREEMIUM';
    legacySalonPlan = 'BASIC';
    const { nextCalls } = await invoke(['POS_INTEGRATION', 'POS_RECEIPTS_ONLY']);
    assert.equal(nextCalls, 1);
  });

  await t.test('null canonical plan defaults to Freemium and blocks inventory', async () => {
    plan = null;
    legacySalonPlan = 'FREE_TRIAL';
    const { req, res, nextCalls } = await invoke('INVENTORY');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.currentPlan, 'FREEMIUM');
    assert.equal(nextCalls, 0);
    assert.equal(req.salonPlan, undefined);
  });

  await t.test('canonical Basic allows inventory even if legacy salon copy says Freemium', async () => {
    plan = 'BASIC';
    legacySalonPlan = 'FREEMIUM';
    const { req, res, nextCalls } = await invoke('INVENTORY');
    assert.equal(nextCalls, 1);
    assert.equal(req.salonPlan, 'BASIC');
    assert.equal(res.statusCode, null);
  });

  await t.test('database failures fail closed with a 500', async () => {
    queryError = new Error('database unavailable');
    const { res, nextCalls } = await invoke('RESOURCES');
    assert.equal(res.statusCode, 500);
    assert.equal(nextCalls, 0);
    queryError = null;
  });
});

test('public salon entitlement treats a null canonical plan as Freemium', async () => {
  plan = null;
  const req = { params: { salonId: '42' } };
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  let nextCalls = 0;
  await requirePublicSalonEntitlement('LOYALTY')(req, res, () => { nextCalls += 1; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalls, 0);
});
