const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../routes/superAdminRoutes.js'), 'utf8');

test('SuperAdmin classifies null SaaS plans as Freemium in counts and filters', () => {
  assert.match(source, /WHERE COALESCE\(saas_plan, 'FREEMIUM'\) != 'FREEMIUM'/);
  assert.match(source, /SELECT COALESCE\(saas_plan, 'FREEMIUM'\) AS saas_plan, COUNT\(\*\)[\s\S]*?GROUP BY COALESCE\(saas_plan, 'FREEMIUM'\)/);
  assert.match(source, /AND COALESCE\(bp\.saas_plan, 'FREEMIUM'\) = \$\$\{paramIdx\+\+\}/);
  assert.match(source, /AND COALESCE\(bp\.saas_plan, 'FREEMIUM'\) = 'FREEMIUM'/);
  assert.match(source, /AND COALESCE\(bp\.saas_plan, 'FREEMIUM'\) IN \('FREE_TRIAL', 'FREE_TRIAL_LEGACY'\)/);
});

test('SuperAdmin responses use the effective plan in tenant, revenue and usage views', () => {
  assert.match(source, /bp\.id, bp\.name, COALESCE\(bp\.saas_plan, 'FREEMIUM'\) AS saas_plan/);
  assert.match(source, /plan: t\.saas_plan/);
  assert.match(source, /COALESCE\(bp\.saas_plan, 'FREEMIUM'\) AS effective_saas_plan/);
  assert.match(source, /plan: t\.effective_saas_plan/);
  assert.match(source, /COALESCE\(bp\.saas_plan, 'FREEMIUM'\) AS saas_plan,[\s\S]*?COUNT\(DISTINCT bp\.id\)/);
  assert.match(source, /GROUP BY COALESCE\(bp\.saas_plan, 'FREEMIUM'\)/);
  assert.match(source, /COALESCE\(bp\.saas_plan, 'FREEMIUM'\) AS saas_plan[\s\S]*?um\.count > um\.limit/);
});
