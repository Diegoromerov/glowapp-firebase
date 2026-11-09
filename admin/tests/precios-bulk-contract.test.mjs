/**
 * Contrato del ajuste masivo de precios (panel <-> backend).
 *
 * Fija tres defectos del mismo desempalme:
 *
 * 1. La pagina enviaba `cambios: [{producto_id, precio}]`, pero el endpoint espera
 *    `{ lista, producto_ids, operacion: { tipo, valor }, motivo }`. Respondia 400
 *    SIEMPRE: el ajuste masivo de precios nunca funciono.
 * 2. El tipo de operacion que ofrecia la pagina ('monto_fijo') no existe en el
 *    contrato del backend (porcentaje | fijar | delta).
 * 3. La formula de `porcentaje` estaba mal: `base * (valor/100)` en vez de
 *    `base * (1 + valor/100)`. Un "+10%" dejaba el precio en el 10% de su valor
 *    (10000 -> 1000). Cablear el endpoint tal cual habria destruido los precios en
 *    el primer ajuste masivo.
 *
 * El punto 3 se prueba con VALORES REALES importando el helper de calculo, que el
 * controlador usa: no es un test que lee el codigo, es el codigo ejecutandose.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calcularPrecioBulk } from '../../backend/src/utils/precioBulk.js';

const root = join(import.meta.dirname, '..');
const repoRoot = join(root, '..');
const pagePrecios = join(root, 'src', 'app', '(dashboard)', 'admin', 'precios', 'page.tsx');
const ctrl = join(repoRoot, 'backend', 'src', 'controllers', 'adminPreciosController.js');

test('porcentaje es un cambio RELATIVO, no una fraccion del precio', () => {
  // El bug exacto: 10000 con "+10%" daba 1000.
  assert.notEqual(
    calcularPrecioBulk(10000, 'porcentaje', 10),
    1000,
    'volvio la formula base*valor/100: un "+10%" seria un -90%'
  );
  assert.equal(calcularPrecioBulk(10000, 'porcentaje', 10), 11000);
  assert.equal(calcularPrecioBulk(10000, 'porcentaje', -50), 5000);
  assert.equal(calcularPrecioBulk(10000, 'porcentaje', 0), 10000);
});

test('fijar pone el precio y delta suma o resta, sin bajar de 0', () => {
  assert.equal(calcularPrecioBulk(10000, 'fijar', 3500), 3500);
  assert.equal(calcularPrecioBulk(10000, 'fijar', 0), 0);
  assert.equal(calcularPrecioBulk(10000, 'delta', 500), 10500);
  assert.equal(calcularPrecioBulk(10000, 'delta', -2500), 7500);
  assert.equal(
    calcularPrecioBulk(100, 'delta', -500),
    0,
    'un descuento mayor que el precio no puede dejar el precio negativo'
  );
});

test('valores basura no producen NaN ni Infinity', () => {
  for (const v of [NaN, Infinity, -Infinity, null, undefined, 'abc']) {
    const r = calcularPrecioBulk(10000, 'porcentaje', v);
    assert.ok(Number.isFinite(r), `calcularPrecioBulk(10000,'porcentaje',${String(v)}) devolvio ${r}`);
  }
});

test('el panel envia el formato que el controlador acepta', () => {
  const src = readFileSync(pagePrecios, 'utf8');

  assert.doesNotMatch(src, /cambios:\s*\[/, 'volvio `cambios: [...]`, que el endpoint rechaza con 400');
  assert.match(src, /producto_ids:/, 'el panel no envia producto_ids');
  assert.match(src, /operacion:\s*\{/, 'el panel no envia operacion { tipo, valor }');
  assert.match(src, /preview:\s*true/, 'la vista previa no se pide al servidor (dry-run)');

  const c = readFileSync(ctrl, 'utf8');
  // Acotado a bulkUpdatePrecios: el controlador tiene varios handlers y el primer
  // `req.body` del archivo es el de updatePrecioProducto, que no es este contrato.
  const fn = c.match(/async function bulkUpdatePrecios[\s\S]*?\n\}/);
  assert.ok(fn, 'no se encontro bulkUpdatePrecios en el controlador');
  const decl = fn[0].match(/const \{([^}]*)\} = req\.body/);
  assert.ok(decl, 'no se encontro el destructuring de req.body en bulkUpdatePrecios');
  for (const campo of ['lista', 'producto_ids', 'operacion']) {
    assert.ok(decl[1].includes(campo), `el controlador ya no lee '${campo}' de req.body`);
  }
});

test('los tipos de operacion que ofrece el panel existen en el contrato', () => {
  const src = readFileSync(pagePrecios, 'utf8');
  const validos = ['porcentaje', 'fijar', 'delta'];

  const opciones = [...src.matchAll(/<option value="([a-z_]+)"/g)].map((m) => m[1]);
  const delBulk = opciones.filter((o) => validos.includes(o) || o === 'monto_fijo');
  assert.ok(delBulk.length > 0, 'no se encontraron las opciones de operacion del ajuste masivo');

  for (const o of delBulk) {
    assert.ok(
      validos.includes(o),
      `el panel ofrece '${o}', que el backend no acepta (${validos.join(', ')})`
    );
  }
});
