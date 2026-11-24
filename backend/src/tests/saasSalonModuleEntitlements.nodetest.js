const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../routes/salonRoutes.js'),
  'utf8'
);
const businessSource = fs.readFileSync(
  path.resolve(__dirname, '../routes/businessRoutes.js'),
  'utf8'
);
const customerLoyaltySource = fs.readFileSync(
  path.resolve(__dirname, '../routes/salonLoyaltyCustomerRoutes.js'),
  'utf8'
);

function routeBlocks(fragment) {
  return [...source.matchAll(/router\.(?:get|post|put|patch|delete)\([\s\S]*?\n\);/g)]
    .map((match) => match[0])
    .filter((block) => block.includes(fragment));
}

test('todas las rutas de inventario del salón exigen INVENTORY', () => {
  const routes = routeBlocks('/:salonId/inventario');
  assert.equal(routes.length, 4);
  assert.ok(routes.every((route) => route.includes("requireSalonEntitlement('INVENTORY')")));
});

test('recursos y alquileres exigen RESOURCES en lectura y escritura', () => {
  const routes = [...routeBlocks('/:salonId/recursos'), ...routeBlocks('/:salonId/alquileres')];
  assert.equal(routes.length, 5);
  assert.ok(routes.every((route) => route.includes("requireSalonEntitlement('RESOURCES')")));
});

test('las recetas de servicio exigen RECIPES', () => {
  const routes = routeBlocks('/:salonId/services/:serviceId/inventory');
  assert.equal(routes.length, 2);
  assert.ok(routes.every((route) => route.includes("requireSalonEntitlement('RECIPES')")));
});

test('caja permite solo integración POS o recibos no fiscales según catálogo', () => {
  const routes = routeBlocks('/:salonId/caja/');
  assert.equal(routes.length, 4);
  assert.ok(routes.every((route) => route.includes("requireSalonEntitlement(['POS_INTEGRATION', 'POS_RECEIPTS_ONLY'])")));
});

test('las rutas de diagnóstico, tareas y documentos requieren COMPLIANCE', () => {
  const blocks = [...businessSource.matchAll(/router\.(?:get|post|put|patch|delete)\([\s\S]*?\n\);/g)]
    .map((match) => match[0])
    .filter((block) => !block.includes('/verticals') && !block.includes('/admin/'));
  assert.equal(blocks.length, 11);
  assert.ok(blocks.every((block) => block.includes("requireEntitlement('COMPLIANCE')")));
});

test('el saldo, catálogo y canje de puntos del cliente respetan LOYALTY del salón', () => {
  const routes = [...customerLoyaltySource.matchAll(/router\.(?:get|post)\([\s\S]*?\n\}\);/g)]
    .map((match) => match[0]);
  assert.equal(routes.length, 3);
  assert.ok(routes.every((route) => route.includes("requireSalonEntitlement('LOYALTY')")));
});
