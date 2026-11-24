const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let plan = 'BASIC';
let queryError = null;
const dbMock = {
  pool: {
    async query(_sql, [salonId]) {
      if (queryError) throw queryError;
      assert.equal(salonId, '42');
      return { rows: [{ plan_saas: plan }] };
    },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithDbStub(request, parent, isMain) {
  if (request === '../config/db' && parent?.filename.endsWith('salonEntitlement.js')) {
    return dbMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { requireSalonEntitlement } = require('../middleware/salonEntitlement');
Module._load = originalLoad;

async function invoke(capability) {
  const req = { params: { salonId: '42' }, body: {} };
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
    const { req, res, nextCalls } = await invoke('INVENTORY');
    assert.equal(nextCalls, 1);
    assert.equal(req.salonPlan, 'BASIC');
    assert.equal(res.statusCode, null);
  });

  await t.test('Freemium blocks inventory with a 403', async () => {
    plan = 'FREEMIUM';
    const { res, nextCalls } = await invoke('INVENTORY');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.required, 'INVENTORY');
    assert.equal(res.body.currentPlan, 'FREEMIUM');
    assert.equal(nextCalls, 0);
  });

  await t.test('Freemium accepts its non-fiscal receipt entitlement', async () => {
    plan = 'FREEMIUM';
    const { nextCalls } = await invoke(['POS_INTEGRATION', 'POS_RECEIPTS_ONLY']);
    assert.equal(nextCalls, 1);
  });

  await t.test('database failures fail closed with a 500', async () => {
    queryError = new Error('database unavailable');
    const { res, nextCalls } = await invoke('RESOURCES');
    assert.equal(res.statusCode, 500);
    assert.equal(nextCalls, 0);
    queryError = null;
  });
});
