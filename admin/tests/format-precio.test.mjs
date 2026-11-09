/**
 * Test del formateo de valores numéricos.
 *
 * Regresión concreta: /admin/productos se caía con
 *   "Cannot read properties of null (reading 'toLocaleString')"
 * porque el formateador local hacía `isNaN(num) ? '-' : num.toLocaleString()`, y
 * `isNaN(null)` es `false` (Number(null) === 0), así que el guard no atrapaba el
 * null. `productos.costo` es NULL-able: se añadió sin NOT NULL en la migración 071.
 *
 * Estos tests son de comportamiento real (importan el módulo y lo ejecutan con
 * valores), no de reflexión sobre el fuente.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatPrecio, formatNumero } from '../src/lib/format.ts';

test('formatPrecio no revienta con null ni undefined (el crash real)', () => {
  // Antes: TypeError. Este assert es el que fija la regresión.
  assert.doesNotThrow(() => formatPrecio(null));
  assert.doesNotThrow(() => formatPrecio(undefined));
  assert.equal(formatPrecio(null), '-');
  assert.equal(formatPrecio(undefined), '-');
});

test('formatPrecio degrada a "-" con vacíos y no numéricos', () => {
  for (const v of ['', '   ', 'abc', 'null', NaN, Infinity, -Infinity, {}, []]) {
    assert.equal(formatPrecio(v), '-', `formatPrecio(${JSON.stringify(v)}) debería ser '-'`);
  }
});

test('formatPrecio formatea números y strings numéricos', () => {
  // Se compara contra el mismo formateador para no depender de los datos ICU.
  assert.equal(formatPrecio(0), `$${(0).toLocaleString('es-CO')}`);
  assert.equal(formatPrecio(15000), `$${(15000).toLocaleString('es-CO')}`);
  assert.equal(formatPrecio('15000'), `$${(15000).toLocaleString('es-CO')}`);
  assert.equal(formatPrecio(' 15000 '), `$${(15000).toLocaleString('es-CO')}`);
  assert.equal(formatPrecio(15000.5), `$${(15000.5).toLocaleString('es-CO')}`);
  assert.equal(formatPrecio('15000.5'), `$${(15000.5).toLocaleString('es-CO')}`);
  assert.equal(formatPrecio(-3), `$${(-3).toLocaleString('es-CO')}`);
});

test('el 0 es un valor válido, no se confunde con ausente', () => {
  // Number(null) === 0 es justo lo que hacía que el bug pasara desapercibido.
  assert.notEqual(formatPrecio(0), '-');
  assert.equal(formatPrecio(0), `$${(0).toLocaleString('es-CO')}`);
  assert.notEqual(formatNumero(0), '-');
});

test('formatPrecio se comporta igual que formatNumero salvo el símbolo', () => {
  const casos = [null, undefined, '', 'abc', 0, 15000, '15000', 15000.5];
  for (const v of casos) {
    const num = formatNumero(v);
    assert.equal(formatPrecio(v), num === '-' ? '-' : `$${num}`);
  }
});

test('las pantallas usan el helper seguro y no un formateador local', () => {
  const raiz = join(import.meta.dirname, '..');
  const productos = readFileSync(
    join(raiz, 'src', 'app', '(dashboard)', 'admin', 'productos', 'page.tsx'),
    'utf8'
  );

  // El formateador inseguro no debe volver.
  assert.doesNotMatch(
    productos,
    /isNaN\(num\)/,
    'volvio el guard `isNaN(num)` a /admin/productos: no atrapa null'
  );
  assert.match(productos, /formatPrecio/, 'la pantalla no usa el helper seguro');

  // Y el tipo debe declarar la realidad: costo puede ser null.
  const interfaz = productos.match(/interface Producto \{[\s\S]*?\n\}/);
  assert.ok(interfaz, 'no se encontro la interfaz Producto');
  assert.match(
    interfaz[0],
    /costo:\s*[^;]*null/,
    'Producto.costo debe declararse NULL-able (la migracion 071 lo anade sin NOT NULL)'
  );
});
