const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PLAN_CATALOG, PLAN_IDS, ADD_ONS, publicCatalog, hasCapability } = require('../config/saasCatalog');

test('availability in the catalog matches offers that are active in production', () => {
  const available = PLAN_IDS.filter((id) => PLAN_CATALOG[id].commerciallyAvailable !== false);
  assert.deepEqual(available, ['FREE_TRIAL', 'FREEMIUM', 'BASIC']);
  assert.equal(PLAN_CATALOG.BASIC.priceCop, 99000);
  for (const id of ['GROWTH', 'PRO', 'ENTERPRISE']) {
    assert.equal(PLAN_CATALOG[id].commerciallyAvailable, false);
  }
});

test('proposed prices and add-ons are not exposed as collectible amounts or available products', () => {
  const catalog = publicCatalog();
  const byId = Object.fromEntries(catalog.plans.map((plan) => [plan.id, plan]));

  assert.equal(byId.GROWTH.priceCop, null);
  assert.equal(byId.GROWTH.proposedPriceCop, 169000);
  assert.equal(byId.PRO.priceCop, 249000); // vigente para contratos; nuevas ventas bloqueadas
  assert.equal(byId.PRO.commerciallyAvailable, false);
  assert.equal(byId.ENTERPRISE.proposedPriceCop, 449000);
  assert.ok(ADD_ONS.every((addOn) => addOn.available === false));
});

test('salon loyalty capability is enforced from each plan entitlement', () => {
  assert.equal(hasCapability('FREE_TRIAL', 'LOYALTY'), true);
  assert.equal(hasCapability('GROWTH', 'LOYALTY'), true);
  assert.equal(hasCapability('FREEMIUM', 'LOYALTY'), false);
  assert.equal(hasCapability('BASIC', 'LOYALTY'), false);
  assert.equal(hasCapability('PRO', 'LOYALTY'), false);
  assert.equal(hasCapability('ENTERPRISE', 'LOYALTY'), false);
});

test('Flutter fallback availability and purchase flags stay in parity with backend catalog', () => {
  const dartPath = path.resolve(__dirname, '../../../packages/glow_core/lib/src/models/saas/saas_models.dart');
  const dart = fs.readFileSync(dartPath, 'utf8');
  const enumBody = dart.match(/enum SaasPlanTier\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const codeByTier = Object.fromEntries(
    [...enumBody.matchAll(/(\w+)\('([A-Z_]+)'/g)].map((match) => [match[1], match[2]])
  );
  const getter = (name) => dart.match(new RegExp(`bool get ${name} =>([\\s\\S]*?);`))?.[1] || '';
  const tiersFromGetter = (name) => [...getter(name).matchAll(/SaasPlanTier\.(\w+)/g)]
    .map((match) => codeByTier[match[1]])
    .filter(Boolean)
    .sort();

  const backendAvailable = PLAN_IDS
    .filter((id) => PLAN_CATALOG[id].commerciallyAvailable !== false)
    .sort();
  const backendPurchasable = PLAN_IDS
    .filter((id) => PLAN_CATALOG[id].commerciallyAvailable !== false && PLAN_CATALOG[id].priceCop > 0)
    .sort();

  assert.deepEqual(tiersFromGetter('isCommerciallyAvailable'), backendAvailable);
  assert.deepEqual(tiersFromGetter('isPurchasable'), backendPurchasable);
});
