/**
 * QA #1 — Admin Dashboard CERO tests.
 *
 * Meta-test del contrato de testabilidad: el panel admin debe declarar un
 * runner de tests en package.json y mantener una suite real en tests/.
 * Runner: node:test nativo (sin dependencias externas, sin `npm install`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

test('package.json declara el bloque scripts', () => {
  assert.ok(pkg.scripts && typeof pkg.scripts === 'object', 'package.json debe tener "scripts"');
});

test('QA #1: package.json expone un script "test" no vacío', () => {
  assert.ok(
    typeof pkg.scripts.test === 'string' && pkg.scripts.test.trim().length > 0,
    'package.json.scripts.test debe existir (hallazgo: CERO tests en admin-dashboard)'
  );
});

test('el script test usa el runner nativo de Node (sin dependencias externas)', () => {
  assert.match(
    pkg.scripts.test,
    /node\s+--test/,
    'scripts.test debe invocar `node --test` para no requerir instalación de deps'
  );
});

test('el script test incluye el directorio tests/', () => {
  assert.match(pkg.scripts.test, /tests\/?/, 'scripts.test debe apuntar a tests/');
  assert.ok(existsSync(join(root, 'tests')), 'debe existir admin-dashboard/tests/');
});

test('la suite contiene al menos 3 archivos *.test.mjs', () => {
  const files = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.mjs'));
  assert.ok(files.length >= 3, `se esperaban >=3 archivos de test, encontrados ${files.length}`);
});

test('package.json conserva identidad del panel admin', () => {
  assert.equal(pkg.name, 'admin-dashboard');
  assert.equal(pkg.private, true);
});
