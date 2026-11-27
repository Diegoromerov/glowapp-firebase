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

test('published quotas and modules are explicit for active onboarding levels', () => {
  assert.equal(PLAN_CATALOG.FREE_TRIAL.quotas.TEAM_SEATS, 3);
  assert.equal(PLAN_CATALOG.FREE_TRIAL.quotas.DIRECT_BOOKINGS, 150);
  assert.equal(PLAN_CATALOG.FREEMIUM.quotas.TEAM_SEATS, 1);
  assert.equal(PLAN_CATALOG.FREEMIUM.quotas.DIRECT_BOOKINGS, 30);
  assert.equal(PLAN_CATALOG.BASIC.quotas.TEAM_SEATS, 5);
  assert.equal(PLAN_CATALOG.BASIC.quotas.DIRECT_BOOKINGS, null);
  for (const id of ['FREE_TRIAL', 'BASIC']) {
    assert.ok(hasCapability(id, 'INVENTORY'));
    assert.ok(hasCapability(id, 'RESOURCES'));
  }
  assert.ok(hasCapability('FREE_TRIAL', 'RECIPES'));
  assert.ok(hasCapability('FREEMIUM', 'POS_RECEIPTS_ONLY'));
  assert.equal(hasCapability('FREEMIUM', 'INVENTORY'), false);
});

test('Flutter local fallback team and booking limits match the backend catalog', () => {
  const modelPath = path.resolve(
    __dirname,
    '../../../packages/glow_core/lib/src/models/saas/saas_models.dart'
  );
  const model = fs.readFileSync(modelPath, 'utf8');
  const tierNames = {
    FREE_TRIAL: 'freeTrial',
    FREEMIUM: 'freemium',
    BASIC: 'basic',
  };

  for (const [planId, tierName] of Object.entries(tierNames)) {
    const block = model.match(new RegExp(
      `case SaasPlanTier\\.${tierName}:\\s*return \\{([\\s\\S]*?)\\n        \\};`
    ))?.[1];
    assert.ok(block, `missing local limits for ${planId}`);
    const localLimits = Object.fromEntries(
      [...block.matchAll(/'([A-Z_]+)':\s*(null|\d+)/g)].map((match) => [
        match[1], match[2] === 'null' ? null : Number(match[2]),
      ])
    );
    for (const [metric, expected] of Object.entries(PLAN_CATALOG[planId].quotas)) {
      assert.equal(localLimits[metric], expected, `${planId}.${metric}`);
    }
  }
});

test('fallback onboarding only offers production levels and uses catalog-backed plans', () => {
  const servicePath = path.resolve(
    __dirname,
    '../../../packages/glow_core/lib/src/services/saas_api_service.dart'
  );
  const service = fs.readFileSync(servicePath, 'utf8');
  assert.match(service, /static List<SaasPlan> get fallbackPlans => _legacyPlans\(\)/);
  assert.match(service, /where\(\(tier\) => tier\.isCommerciallyAvailable\)/);
  assert.match(service, /proposedPriceCents: null/);
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

test('provider salon shell defaults to FREEMIUM when the current plan is missing', () => {
  const shellPath = path.resolve(__dirname, '../../../apps/glow_provider/lib/screens/salon/salon_shell.dart');
  const shell = fs.readFileSync(shellPath, 'utf8');

  assert.match(shell, /this\.plan\s*=\s*'FREEMIUM'/);
  assert.match(shell, /salon\['plan_saas'\]\s*\?\?\s*'FREEMIUM'/);
  assert.doesNotMatch(shell, /salon\['plan_saas'\]\s*\?\?\s*'FREE_TRIAL'/);
});

test('provider onboarding distinguishes commercial availability from live checkout readiness', () => {
  const servicePath = path.resolve(
    __dirname,
    '../../../packages/glow_core/lib/src/services/saas_api_service.dart'
  );
  const modelPath = path.resolve(
    __dirname,
    '../../../packages/glow_core/lib/src/models/saas/saas_models.dart'
  );
  const onboardingPath = path.resolve(
    __dirname,
    '../../../apps/glow_provider/lib/screens/auth/onboarding_screen.dart'
  );
  const service = fs.readFileSync(servicePath, 'utf8');
  const model = fs.readFileSync(modelPath, 'utf8');
  const onboarding = fs.readFileSync(onboardingPath, 'utf8');

  assert.match(service, /checkoutAvailable:\s*data\['checkoutAvailable'\]\s*==\s*true/);
  assert.match(model, /final bool checkoutAvailable;/);
  assert.match(onboarding, /commercialPlan\.checkoutAvailable/);
  assert.match(onboarding, /Contratación pausada hasta que se habilite el pago\./);
});

test('Flutter fallback descriptions, prices and benefits match the public catalog', () => {
  const catalog = publicCatalog();
  const servicePath = path.resolve(
    __dirname,
    '../../../packages/glow_core/lib/src/services/saas_api_service.dart'
  );
  const modelPath = path.resolve(
    __dirname,
    '../../../packages/glow_core/lib/src/models/saas/saas_models.dart'
  );
  const service = fs.readFileSync(servicePath, 'utf8');
  const model = fs.readFileSync(modelPath, 'utf8');
  const tierNames = {
    FREE_TRIAL: 'freeTrial',
    FREEMIUM: 'freemium',
    BASIC: 'basic',
  };
  const featureMetrics = [
    ['RESOURCES', 'RESOURCES'],
    ['AURA_BUSINESS', 'AURA_QUERIES'],
    ['WHATSAPP_INTEGRATION', 'WHATSAPP_MESSAGES'],
    ['INVOICING', 'INVOICING_DOCUMENTS'],
    ['INVOICING_ADDON', 'INVOICING_DOCUMENTS'],
    ['API_KEYS', 'API_CALLS'],
    ['MULTI_SITE', 'SITES'],
  ];

  for (const plan of catalog.plans.filter((entry) => entry.commerciallyAvailable)) {
    const tierName = tierNames[plan.id];
    assert.ok(tierName, `missing Flutter fallback tier mapping for ${plan.id}`);

    const description = service.match(new RegExp(
      `case SaasPlanTier\\.${tierName}:\\s*return '([^']*)';`
    ))?.[1];
    assert.equal(description, plan.description, `${plan.id}.description`);

    const tierDeclaration = model.match(new RegExp(
      `${tierName}\\('${plan.id}',\\s*'([^']*)',\\s*(\\d+),`
    ));
    assert.ok(tierDeclaration, `missing local enum price for ${plan.id}`);
    assert.equal(tierDeclaration[1], plan.name, `${plan.id}.name`);
    assert.equal(Number(tierDeclaration[2]), plan.priceCop * 100, `${plan.id}.price`);

    const featureBlock = service.match(new RegExp(
      `case SaasPlanTier\\.${tierName}:\\s*return const \\[([\\s\\S]*?)\\];`
    ))?.[1];
    assert.ok(featureBlock, `missing local benefits for ${plan.id}`);
    const localFeatures = [...featureBlock.matchAll(/'([^']*)'/g)]
      .map((match) => match[1])
      .sort();

    const remoteFeatures = [];
    for (const capability of plan.capabilities) {
      const definition = catalog.capabilities[capability];
      if (definition && (definition.kind === 'boolean' || capability === 'ONLINE_BOOKING')) {
        remoteFeatures.push(definition.label || capability);
      }
    }
    for (const [capability, metric] of featureMetrics) {
      if (!plan.capabilities.includes(capability)) continue;
      const quota = plan.quotas[metric];
      if (!quota) continue;
      if (quota.limit === null) remoteFeatures.push(`${quota.unit} ilimitados`);
      else if (quota.limit > 0) remoteFeatures.push(`${quota.limit} ${quota.unit}`);
    }
    assert.deepEqual(localFeatures, remoteFeatures.sort(), `${plan.id}.features`);
  }
});
