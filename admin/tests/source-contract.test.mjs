/**
 * Contratos estáticos de la estructura y utilidades del panel admin.
 *
 * Cubre: inventario mínimo de archivos, barrel de tipos, manejo de errores de
 * useBookings y configuración TypeScript (strict + alias @/*). Estático.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const src = join(root, 'src');
const read = (p) => readFileSync(join(src, p), 'utf8').replace(/\r\n/g, '\n');

test('existen los módulos núcleo del panel admin', () => {
  const required = [
    'app/layout.tsx',
    'app/page.tsx',
    'components/auth/ProtectedRoute.tsx',
    'contexts/AuthContext.tsx',
    'hooks/useBookings.ts',
    'hooks/useSocket.ts',
    'lib/api-client.ts',
    'middleware.ts',
    'types/index.ts',
  ];
  for (const rel of required) {
    assert.ok(existsSync(join(src, rel)), `falta src/${rel}`);
  }
});

test('existen las pantallas administrativas', () => {
  const screens = [
    'app/(dashboard)/admin/academia/page.tsx',
    'app/(dashboard)/admin/business/page.tsx',
    'app/(dashboard)/admin/precios/page.tsx',
    'app/(dashboard)/admin/vto/page.tsx',
    'app/(dashboard)/admin/pqrsf/page.tsx',
  ];
  for (const rel of screens) {
    assert.ok(existsSync(join(src, rel)), `falta src/${rel}`);
  }
});

test('types/index.ts re-exporta user, booking, service y chat', () => {
  const types = read('types/index.ts');
  for (const mod of ['user', 'booking', 'service', 'chat']) {
    assert.match(types, new RegExp(`export \\* from './${mod}'`));
  }
});

test('useBookings exporta useBookings y describeBookingsError', () => {
  const hook = read('hooks/useBookings.ts');
  assert.match(hook, /export function useBookings\(/);
  assert.match(hook, /export function describeBookingsError\(/);
});

test('describeBookingsError mapea 401, 403 y 404 a mensajes explícitos', () => {
  const hook = read('hooks/useBookings.ts');
  assert.match(hook, /status === 401\)[\s\S]*sesión expiró/);
  assert.match(hook, /status === 403\)[\s\S]*no tiene permisos/);
  assert.match(hook, /status === 404\)[\s\S]*HTTP 404/);
});

test('useBookings limpia las citas y expone error en fallo (no fallback silencioso)', () => {
  const hook = read('hooks/useBookings.ts');
  assert.match(hook, /setBookings\(\[\]\)/);
  assert.match(hook, /setError\(describeBookingsError\(err\)\)/);
});

test('tsconfig.json es strict y define el alias @/* -> ./src/*', () => {
  const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.deepEqual(tsconfig.compilerOptions.paths['@/*'], ['./src/*']);
});
