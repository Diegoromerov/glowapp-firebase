#!/usr/bin/env node
/**
 * Guard de las métricas de PQRSF en el dashboard raíz (F5).
 *
 * QUÉ PROTEGE, y por qué cada cosa:
 *   1. Que la pantalla pida las métricas al backend en vez de contarlas por su cuenta: un número
 *      calculado en el panel se desincroniza con la base en cuanto cambia un estado.
 *   2. Que los campos que la pantalla lee EXISTAN en la respuesta del controlador. El panel tendía
 *      a leer `mensajes` cuando el backend servía `mensajes_total`; aquí se comprueba el otro lado.
 *   3. Que la petición lleve el encabezado CSRF: el BFF responde 403 a una mutación sin
 *      `X-Requested-With` (y el síntoma sería «no carga nada»).
 *   4. Que una sección caída se declare como caída: el panel separa «0 PQRSF» de «no pude leerlos».
 *   5. Comportamiento real del formato y del orden, importando la lógica pura (no leyendo el fuente).
 *
 * Estático + comportamiento. Se ejecuta con `node --test tests/pqrsf-dashboard.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatMinutos, prioridadesPorRiesgo } from '../src/lib/metricasPqrsf.ts';

const panel = join(import.meta.dirname, '..');
const repo = join(panel, '..');
const PAGINA = join(panel, 'src', 'app', 'page.tsx');
const LIB = join(panel, 'src', 'lib', 'metricasPqrsf.ts');
const CTRL = join(repo, 'backend', 'src', 'controllers', 'adminTicketController.js');

const pagina = readFileSync(PAGINA, 'utf8');
const controlador = readFileSync(CTRL, 'utf8');

test('la pantalla pide las métricas al backend, con el encabezado CSRF', () => {
  assert.ok(
    pagina.includes("fetch('/api/admin/tickets/metricas'"),
    'el dashboard debe pedir /api/admin/tickets/metricas'
  );
  const idx = pagina.indexOf("fetch('/api/admin/tickets/metricas'");
  const linea = pagina.slice(idx, pagina.indexOf('\n', idx));
  assert.ok(
    linea.includes("'X-Requested-With': 'XMLHttpRequest'"),
    'la petición debe llevar X-Requested-With: el BFF responde 403 sin él'
  );
});

test('los campos que la pantalla lee existen en la respuesta del controlador', () => {
  for (const campo of ['por_prioridad', 'por_estado', 'sin_respuesta', 'vencidos', 'abiertos']) {
    assert.ok(controlador.includes(campo), `el controlador debe servir ${campo}`);
    assert.ok(pagina.includes(campo), `la pantalla debe leer ${campo}`);
  }
  for (const campo of ['plazo_dias_habiles', 'festivos_incluidos', 'dias_habiles_restantes', 'vencido_legal']) {
    assert.ok(controlador.includes(campo), `el controlador debe servir ${campo}`);
    assert.ok(pagina.includes(campo), `la pantalla debe leer ${campo}`);
  }
});

test('una sección caída se declara caída, no como cero', () => {
  assert.ok(
    pagina.includes("failures.push('pqrsf')"),
    'si la petición falla hay que registrarlo en failedSections'
  );
  assert.ok(
    pagina.includes("failedSections.includes('pqrsf')"),
    'el estado del sistema debe mostrar la sección de PQRSF'
  );
  assert.ok(
    readFileSync(LIB, 'utf8').includes("'Sin datos'"),
    'un valor ausente se declara «Sin datos», nunca 0'
  );
});

test('el tipo de la pantalla y el de la lógica pura son el mismo', () => {
  const tipo = readFileSync(LIB, 'utf8').includes('export interface PqrsfMetricas');
  assert.ok(tipo, 'metricasPqrsf.ts debe exportar el tipo PqrsfMetricas');
  assert.ok(
    pagina.includes("type PqrsfMetricas } from '@/lib/metricasPqrsf'"),
    'la pantalla debe importar el tipo del módulo puro, no redefinirlo'
  );
  for (const campo of ['prioridad', 'minutos_medio_respuesta', 'sin_respuesta', 'vencidos']) {
    assert.ok(readFileSync(LIB, 'utf8').includes(campo), `el tipo debe declarar ${campo}`);
  }
});

test('formatMinutos: los minutos se leen, y su ausencia no se disfraza de cero', () => {
  assert.equal(formatMinutos(null), 'Sin datos');
  assert.equal(formatMinutos(undefined), 'Sin datos');
  assert.equal(formatMinutos(Number.NaN), 'Sin datos');
  assert.equal(formatMinutos(0), '0 min');
  assert.equal(formatMinutos(45), '45 min');
  assert.equal(formatMinutos(59), '59 min');
  assert.equal(formatMinutos(90.4), '1 h 30 min');
  assert.equal(formatMinutos(60), '1 h');
  assert.equal(formatMinutos(135), '2 h 15 min');
  assert.equal(formatMinutos(1440), '1 d');
  assert.equal(formatMinutos(1500), '1 d 1 h');
});

test('prioridadesPorRiesgo: ordena por datos y no toca el arreglo recibido', () => {
  const filas = [
    { prioridad: 'BAJA', total: 10, abiertos: 3, sin_respuesta: 1, vencidos: 0, minutos_medio_respuesta: 100, minutos_medio_resolucion: null },
    { prioridad: 'EMERGENCIA', total: 4, abiertos: 2, sin_respuesta: 2, vencidos: 2, minutos_medio_respuesta: 31, minutos_medio_resolucion: null },
    { prioridad: 'MEDIA', total: 9, abiertos: 5, sin_respuesta: 4, vencidos: 1, minutos_medio_respuesta: 200, minutos_medio_resolucion: null },
  ];
  const copia = JSON.parse(JSON.stringify(filas));
  const orden = prioridadesPorRiesgo(filas).map((f) => f.prioridad);
  assert.deepEqual(orden, ['EMERGENCIA', 'MEDIA', 'BAJA'], 'primero las vencidas, luego sin responder, luego más abiertas');
  assert.deepEqual(filas, copia, 'no debe mutar el arreglo original');
  assert.deepEqual(prioridadesPorRiesgo(null), [], 'sin datos devuelve lista vacía, no una excepción');
});

test('el orden NO lleva una lista de prioridades copiada en el panel', () => {
  const lib = readFileSync(LIB, 'utf8');
  assert.ok(
    !/['"](EMERGENCIA|URGENTE|ALTA)['"]\s*,/.test(lib.replace(/\/\*[\s\S]*?\*\//g, '')),
    'el orden debe salir de los datos: una lista copiada se desincroniza con las migraciones'
  );
});
