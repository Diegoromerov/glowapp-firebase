const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

let canonicalPlan = 'GROWTH';
let legacySalonPlan = 'FREEMIUM';
let salonExists = true;
const service = {
  customerSummary: async () => ({ salon_id: 81, balance: 25, movements: [] }),
  customerRewards: async () => ({ salon_id: 81, enabled: true, rewards: [{ id: 'reward-1' }] }),
  redeem: async () => ({ redemption: { id: 'redemption-1' }, alreadyProcessed: false }),
};
const runAsSystem = async (_deps, callback) => callback({
  query: async (sql, params) => {
    assert.match(sql, /WHEN bp\.id IS NULL THEN s\.plan_saas/i);
    assert.match(sql, /LEFT JOIN business_profiles bp ON bp\.id = s\.business_profile_id/i);
    assert.deepEqual(params, [81]);
    return { rows: salonExists ? [{ saas_plan: canonicalPlan, plan_saas: legacySalonPlan }] : [] };
  },
});

const originalLoad = Module._load;
Module._load = function loadRouteDependencies(specifier, parent, isMain) {
  if (parent?.filename.endsWith(`${path.sep}middleware${path.sep}salonEntitlement.js`)) {
    if (specifier === '../config/db') return { pool: {}, systemPool: {} };
    if (specifier === '../config/tenantRouting') return { runAsSystem };
  }
  if (parent?.filename.endsWith(`${path.sep}routes${path.sep}salonLoyaltyCustomerRoutes.js`)) {
    if (specifier === '../middleware/auth') {
      return { authMiddleware: (req, _res, next) => { req.user = { id: 902, tenant_id: null }; next(); } };
    }
    if (specifier === '../services/salonLoyaltyService') return service;
  }
  return originalLoad.call(this, specifier, parent, isMain);
};
const loyaltyRoutes = require('../routes/salonLoyaltyCustomerRoutes');
Module._load = originalLoad;

const app = express();
app.use(express.json());
app.use('/api/salon-loyalty', loyaltyRoutes);

test('customer loyalty entitlement resolves a salon outside the customer tenant through system RLS scope', async () => {
  salonExists = true;
  canonicalPlan = 'GROWTH';
  legacySalonPlan = 'FREEMIUM';
  const response = await request(app).get('/api/salon-loyalty/salons/81/rewards');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.rewards, [{ id: 'reward-1' }]);
});

test('customer loyalty route blocks plans without LOYALTY before reading customer data', async () => {
  canonicalPlan = 'FREEMIUM';
  legacySalonPlan = 'GROWTH';
  const response = await request(app).get('/api/salon-loyalty/salons/81/rewards');
  assert.equal(response.status, 403);
  assert.equal(response.body.currentPlan, undefined);
  assert.equal(response.body.required, 'LOYALTY');
});

test('customer loyalty route does not expose plans for nonexistent salons', async () => {
  salonExists = false;
  const response = await request(app).get('/api/salon-loyalty/salons/81/rewards');
  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'El salón no existe.');
});

test('customer loyalty route rejects malformed salon identifiers before system lookup', async () => {
  const response = await request(app).get('/api/salon-loyalty/salons/1e3/rewards');
  assert.equal(response.status, 400);
});
