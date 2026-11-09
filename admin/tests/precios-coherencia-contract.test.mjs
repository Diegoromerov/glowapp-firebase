/**
 * Test de contrato entre el panel admin y el backend.
 *
 * Caso real que lo motiva: la pantalla /admin/precios declaraba una interfaz
 * `CoherenciaReport` con campos (sin_precio_cliente, sin_precio_profesional,
 * sin_precio_negocio, incoherencias) que el endpoint
 * GET /api/admin/precios/coherencia NUNCA devolvio. Mientras la peticion
 * fallaba, el guard `coherencia &&` la tapaba; al pasar por el proxy BFF
 * empezo a responder 200 y `coherencia.incoherencias.length` tumbo la pagina
 * con "Cannot read properties of undefined (reading 'length')".
 *
 * Este test compara los campos de la interfaz del frontend con las claves que
 * el controlador del backend devuelve en res.json(), de modo que un
 * desalineamiento falla en CI en vez de en produccion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const repoRoot = join(root, '..');

const pagePath = join(root, 'src', 'app', '(dashboard)', 'admin', 'precios', 'page.tsx');
const controllerPath = join(
  repoRoot,
  'backend',
  'src',
  'controllers',
  'adminPreciosController.js'
);

const page = readFileSync(pagePath, 'utf8').replace(/\r\n/g, '\n');

/** Extrae las claves de nivel superior de un objeto literal de JS. */
function topLevelKeys(objectLiteral) {
  return objectLiteral
    .split('\n')
    .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*,?\s*$/))
    .filter(Boolean)
    .map((m) => m[1]);
}

/** Extrae los campos declarados en una interfaz TypeScript. */
function interfaceFields(source, name) {
  const start = source.indexOf(`interface ${name} {`);
  assert.notEqual(start, -1, `no se encontro la interfaz ${name}`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `no se encontro el cierre de ${name}`);
  const body = source.slice(start, end);
  return [...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]);
}

test('el panel declara el contrato real de /api/admin/precios/coherencia', () => {
  const declared = interfaceFields(page, 'CoherenciaReport');

  // El backend es la fuente de verdad; si no esta disponible, se omite la
  // comparacion pero se exige que el frontend normalice la respuesta.
  if (!existsSync(controllerPath)) {
    assert.match(
      page,
      /normalizarCoherencia\(/,
      'el panel debe normalizar la respuesta de coherencia'
    );
    return;
  }

  const controller = readFileSync(controllerPath, 'utf8').replace(/\r\n/g, '\n');
  const fnStart = controller.indexOf('async function getCoherenciaReport');
  assert.notEqual(fnStart, -1, 'no se encontro getCoherenciaReport en el controlador');
  const fnEnd = controller.indexOf('\n}', fnStart);
  const body = controller.slice(fnStart, fnEnd);

  const jsonStart = body.indexOf('res.json({');
  assert.notEqual(jsonStart, -1, 'getCoherenciaReport no devuelve un objeto literal');
  const jsonBody = body.slice(jsonStart + 'res.json({'.length, body.indexOf('})', jsonStart));
  const backendKeys = topLevelKeys(jsonBody);

  assert.ok(backendKeys.length > 0, 'no se extrajeron claves de la respuesta del backend');

  assert.deepEqual(
    [...declared].sort(),
    [...backendKeys].sort(),
    'la interfaz CoherenciaReport del panel no coincide con lo que responde el backend'
  );
});

test('la pantalla de precios no lee campos fantasma del reporte de coherencia', () => {
  for (const campo of ['sin_precio_cliente', 'sin_precio_profesional', 'sin_precio_negocio', 'incoherencias']) {
    assert.doesNotMatch(
      page,
      new RegExp(`coherencia\\s*\\.\\s*${campo}`),
      `la pantalla lee coherencia.${campo}, que el backend no devuelve`
    );
  }
});

test('la respuesta de coherencia se normaliza a listas antes de usarse', () => {
  assert.match(page, /setCoherencia\(normalizarCoherencia\(/, 'falta la normalizacion al asignar el estado');
  assert.match(page, /Array\.isArray\(value\)/, 'la normalizacion debe degradar a lista vacia');
  assert.match(page, /function tieneAvisosCoherencia\(/, 'falta el guard de render del panel de avisos');
});
