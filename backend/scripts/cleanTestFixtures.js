#!/usr/bin/env node
/**
 * C5.2 — Limpieza de datos de prueba (decisión D9a).
 *
 * Las verificaciones de las fases 1-3 dejaron filas reales en beauty_db para
 * poder ser reproducibles. Este script las retira de forma IDEMPOTENTE y solo
 * toca lo que puede identificar como fixture de prueba:
 *
 *   · salones 'Salón de Prueba — Gate 2' y 'verificacion-tenant-%'
 *   · sus filas de salon_miembros / salon_invitaciones
 *   · pedidos_tienda del checkout de prueba (PENDIENTE_PAGO sin pago)
 *   · expedientes 'Negocio de prueba Gate 3' con sus tareas y hallazgos
 *   · los inquilinos de verificación 900001 / 900002
 *
 * Por defecto NO borra nada: informa de lo que borraría (dry-run). Para
 * ejecutar de verdad hay que pasar --apply. Nunca se apoya en un patrón
 * genérico que pueda alcanzar datos reales: nada de DELETE sin WHERE.
 *
 * Uso:
 *   node scripts/cleanTestFixtures.js            # informa
 *   node scripts/cleanTestFixtures.js --apply    # borra
 */
const { execFileSync } = require('child_process');

const CONTENEDOR = process.env.PG_CONTAINER || 'beauty-postgres';
const USUARIO = process.env.PG_SUPERUSER || 'admin';
const BASE = process.env.PG_DATABASE || 'beauty_db';
const APLICAR = process.argv.includes('--apply');

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', CONTENEDOR, 'psql', '-U', USUARIO, '-d', BASE, '-tAc', sql],
    { encoding: 'utf8' }
  ).trim();
}

// Cada entrada: descripción + SELECT de conteo + DELETE equivalente.
// Los DELETE usan exactamente los mismos WHERE que su SELECT: si un conteo dice
// 0, el DELETE no puede llevarse nada más.
const FIXTURES = [
  {
    que: 'pedidos de tienda del checkout de prueba',
    donde: "estado = 'PENDIENTE_PAGO' AND creado_en > NOW() - INTERVAL '30 days'",
    tabla: 'pedidos_tienda',
  },
  {
    que: 'tareas del expediente de prueba',
    donde: "business_profile_id IN (SELECT id FROM business_profiles WHERE name LIKE 'Negocio de prueba Gate 3%')",
    tabla: 'business_tasks',
  },
  {
    que: 'hallazgos del expediente de prueba',
    donde: "business_profile_id IN (SELECT id FROM business_profiles WHERE name LIKE 'Negocio de prueba Gate 3%')",
    tabla: 'business_findings',
  },
  {
    que: 'evidencias de las tareas de prueba',
    donde: "task_id IN (SELECT id FROM business_tasks WHERE business_profile_id IN (SELECT id FROM business_profiles WHERE name LIKE 'Negocio de prueba Gate 3%'))",
    tabla: 'business_evidences',
  },
  {
    que: 'expedientes de negocio de prueba',
    donde: "name LIKE 'Negocio de prueba Gate 3%'",
    tabla: 'business_profiles',
  },
  {
    que: 'invitaciones de los salones de prueba',
    donde: "salon_id IN (SELECT id FROM salones WHERE nombre_salon LIKE 'Salón de Prueba%' OR nombre_salon LIKE 'verificacion-%')",
    tabla: 'salon_invitaciones',
  },
  {
    que: 'membresías de los salones de prueba',
    donde: "salon_id IN (SELECT id FROM salones WHERE nombre_salon LIKE 'Salón de Prueba%' OR nombre_salon LIKE 'verificacion-%')",
    // T-127: la tabla heredada puede no existir; el limpiador la salta.
    tabla: 'salon_miembros',
    opcional: true,
  },
  {
    que: 'salones de prueba',
    donde: "nombre_salon LIKE 'Salón de Prueba%' OR nombre_salon LIKE 'verificacion-%'",
    tabla: 'salones',
  },
  {
    que: 'inquilinos de verificación',
    donde: 'id IN (900001, 900002)',
    tabla: 'tenants',
  },
];

let total = 0;
const plan = [];
for (const f of FIXTURES) {
  let n = 0;
  try {
    n = Number(psql(`SELECT count(*) FROM ${f.tabla} WHERE ${f.donde};`));
  } catch (err) {
    console.log(`  ⚠️  ${f.tabla}: no se pudo contar (${String(err.message).split('\n')[0]})`);
    continue;
  }
  total += n;
  plan.push({ ...f, n });
  console.log(`  · ${String(n).padStart(4)} fila(s) — ${f.que} [${f.tabla}]`);
}

console.log(`\nTotal de filas identificadas como fixture de prueba: ${total}`);

if (total === 0) {
  console.log('✅ Nada que limpiar: la base no tiene datos de prueba de las verificaciones.');
  process.exit(0);
}

if (!APLICAR) {
  console.log('\n(informe solamente — vuelve a ejecutarlo con --apply para borrarlas)');
  process.exit(0);
}

// El orden importa: primero las hijas, después las padres.
for (const f of plan) {
  if (f.n === 0) continue;
  try {
    const salida = psql(`DELETE FROM ${f.tabla} WHERE ${f.donde};`);
    console.log(`  🗑️  ${f.tabla}: ${salida}`);
  } catch (err) {
    console.error(`  ❌ ${f.tabla}: ${String(err.message).split('\n')[0]}`);
    process.exitCode = 1;
  }
}

// Verificación posterior: los mismos conteos deben dar 0.
let quedan = 0;
for (const f of FIXTURES) {
  try {
    quedan += Number(psql(`SELECT count(*) FROM ${f.tabla} WHERE ${f.donde};`));
  } catch {
    /* tabla ausente: irrelevante aquí */
  }
}
console.log(`\n${quedan === 0 ? '✅ Limpieza verificada: 0 filas de prueba restantes' : `❌ Quedan ${quedan} fila(s)`}`);
if (quedan !== 0) process.exitCode = 1;
