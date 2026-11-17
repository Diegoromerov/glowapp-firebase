import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const adminRoot = join(import.meta.dirname, '..');
const repoRoot = join(adminRoot, '..');
const page = readFileSync(join(adminRoot, 'src', 'app', '(dashboard)', 'admin', 'logistics', 'returns', 'page.tsx'), 'utf8');
const sidebar = readFileSync(join(adminRoot, 'src', 'components', 'dashboard', 'Sidebar.tsx'), 'utf8');
const controller = readFileSync(join(repoRoot, 'backend', 'src', 'controllers', 'returnController.js'), 'utf8');
const routes = readFileSync(join(repoRoot, 'backend', 'src', 'routes', 'productRoutes.js'), 'utf8');

test('la bandeja de devoluciones está enlazada y usa el endpoint solo de lectura protegido para admin', () => {
  assert.match(sidebar, /href: '\/admin\/logistics\/returns', label: 'Devoluciones GlowStore'/);
  assert.match(page, /\/api\/admin\/returns\?/);
  assert.match(page, /X-Requested-With/);
  assert.match(routes, /router\.get\('\/admin\/returns', authMiddleware, requireRol\('admin'\), returnController\.getAdminDevoluciones\)/);
  assert.match(controller, /async function getAdminDevoluciones\(/);
  assert.match(controller, /runAsSystem\(\{ pool, systemPool \}/);
});

test('la bandeja presenta el estado logístico inverso y no simula ejecutar el reembolso', () => {
  for (const field of ['guia_retorno_tracking_url', 'etiqueta_retorno_pdf_url', 'reembolso_estado', 'reembolso_monto_cop']) {
    assert.ok(controller.includes(field), `el endpoint debe exponer ${field}`);
    assert.ok(page.includes(field), `la interfaz debe mostrar ${field}`);
  }
  assert.match(page, /el reembolso se muestra como pendiente/);
  assert.doesNotMatch(page, /\/api\/admin\/returns\/\$\{.*\}\/(approve|reject|receive)/);
});
