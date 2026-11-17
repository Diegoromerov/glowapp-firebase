import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const adminRoot = join(import.meta.dirname, '..');
const repoRoot = join(adminRoot, '..');
const page = readFileSync(join(adminRoot, 'src', 'app', '(dashboard)', 'admin', 'logistics', 'page.tsx'), 'utf8');
const sidebar = readFileSync(join(adminRoot, 'src', 'components', 'dashboard', 'Sidebar.tsx'), 'utf8');
const tracking = readFileSync(join(repoRoot, 'backend', 'src', 'controllers', 'trackingController.js'), 'utf8');
const routes = readFileSync(join(repoRoot, 'backend', 'src', 'routes', 'productRoutes.js'), 'utf8');

test('Logística GlowStore tiene acceso en el menú y consume el API administrativo real', () => {
  assert.match(sidebar, /href: '\/admin\/logistics', label: 'Logística GlowStore'/);
  assert.match(page, /\/api\/admin\/logistics\/shipments\?/);
  assert.match(page, /\/api\/admin\/logistics\/shipments\/\$\{selected\.id\}\/manual-status/);
  assert.match(page, /X-Requested-With/);
  assert.match(routes, /router\.get\('\/admin\/logistics\/shipments'/);
  assert.match(routes, /router\.post\('\/admin\/logistics\/shipments\/:id\/manual-status'/);
});

test('la atribución de cada paquete usa el proveedor del envío, no el del pedido agregado', () => {
  assert.ok(tracking.includes('where.push(`e.prestador_id = $${paramIdx++}`)'));
  assert.match(tracking, /e\.prestador_id AS prestador_comisionado_id/);
  assert.match(tracking, /LEFT JOIN usuarios u ON u\.id = e\.prestador_id/);
});

test('un cambio manual de estado requiere nota y fija entregado_en al entregar', () => {
  assert.match(tracking, /Nota obligatoria \(mín 5 caracteres\)/);
  assert.match(tracking, /entregado_en = CASE WHEN \$1 = 'ENTREGADO'/);
});
