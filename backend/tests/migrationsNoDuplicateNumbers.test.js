/**
 * backend/tests/migrationsNoDuplicateNumbers.test.js
 *
 * Guard de integración — BLOQUEADOR DE MERGE DE FASE D.
 *
 * QUÉ PROTEGE
 *   `backend/src/config/migrationRunner.js` aplica las migraciones ordenando el
 *   directorio alfabéticamente y registra cada una por NOMBRE COMPLETO en
 *   `schema_migrations (filename UNIQUE)`. El prefijo numérico es el único contrato
 *   de orden entre migraciones independientes: si dos ramas crean a la vez
 *   `073_*.sql`, el orden de aplicación pasa a depender del alfabeto del sufijo y
 *   nadie puede razonar sobre él. Ya ocurrió: 4 ramas de fix partieron en
 *   aislamiento desde 9cb3fb077 y las 4 eligieron el 073.
 *
 * POR QUÉ HAY UN BASELINE
 *   15 números ya están duplicados en `main` — 002, 003, 004, 008, 011, 012, 026,
 *   029, 030, 032, 033, 034, 065, 066, 067 — y están APLICADOS en producción.
 *   `schema_migrations` los rastrea por nombre de archivo: renombrarlos los haría
 *   re-ejecutar (varias de esas migraciones no son idempotentes) o dejaría el
 *   registro huérfano, y `prepareRlsDatabase.js` / `verifyCatalogoAutorizado.js`
 *   los citan por ruta. El reordenamiento de todo el directorio tiene tarjeta
 *   propia (`agent/t_fix_8aeb7051-p2-3-consolidate-migrations`) y no se duplica
 *   aquí. Este guard CONGELA ese backlog —lo deja visible y verificable— y falla
 *   ante CUALQUIER duplicado nuevo, sea cual sea su número.
 *
 * QUÉ FALLA
 *   1. Un número con más de un archivo y fuera del baseline.
 *   2. Un baseline que deja de coincidir con la realidad (archivo renombrado,
 *      borrado o añadido bajo un número legacy): un baseline obsoleto no protege.
 *   3. Un `.down.sql` de `rollback/` sin su `up` correspondiente.
 *   4. La asignación de Fase D (073-076) sin materializar, o con números repetidos.
 *
 * SIN DEPENDENCIAS: solo `fs` / `path` / `assert` de Node. Corre dentro del gate
 * de jest (testMatch `**\/tests\/**\/*.test.js`) y también en solitario:
 *     node backend/tests/migrationsNoDuplicateNumbers.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ROLLBACK_DIR = path.join(MIGRATIONS_DIR, 'rollback');

/** `073_create_kyc_audit_logs.sql` → ['073', 'create_kyc_audit_logs.sql'] */
const PREFIJO_NUMERADO = /^(\d{3})_(.+)$/;

/** `073_x.down.sql` es un ROLLBACK: comparte número con su `up` a propósito. */
const esRollback = (archivo) => archivo.endsWith('.down.sql');

/**
 * Duplicados de número que YA existían antes de la Fase D. Cada entrada lista los
 * archivos EXACTOS que conviven bajo ese número: si el conjunto cambia, el guard
 * falla y obliga a decidir (renumerar de verdad o actualizar el registro), en vez
 * de dejar que el backlog crezca sin que nadie lo vea.
 *
 * Deuda asumida y con dueño: el reordenamiento completo del directorio es la
 * tarjeta `agent/t_fix_8aeb7051-p2-3-consolidate-migrations`.
 */
const BASELINE_DUPLICADOS_LEGACY = {
  '002': ['002_ai_history.sql', '002_fix_triggers.sql'],
  '003': ['003_habeas_data_and_config.sql', '003_taxes_config.sql'],
  '004': ['004_align_sequences.sql', '004_isolate_phi_schema.sql'],
  '008': ['008_academia_glow.sql', '008_social_integrations.sql'],
  '011': ['011_seed_mens_products.sql', '011_update_commission_trigger.sql'],
  '012': ['012_business_engine.sql', '012_create_user_biometrics.sql', '012_skincare_planner_reengineering.sql'],
  '026': ['026_align_biometric_consents_schema.sql', '026_curso_colorimetria_completo.sql'],
  '029': ['029_fix_beauty_profiles_user_id_type.sql', '029_refactor_biometric_architecture_premium.sql'],
  '030': ['030_enable_pgvector.sql', '030_fix_beauty_profiles_defaults.sql', '030_fix_beauty_profiles_id_default.sql'],
  '032': ['032_create_retention_policies.sql', '032_fix_011_insert.sql'],
  '033': ['033_add_id_academy_certificates.sql', '033_create_legal_holds.sql'],
  '034': ['034_add_fks_to_academy_tables.sql', '034_enable_rls_knowledge.sql'],
  '065': ['065_add_business_profile_id_bookings.sql', '065_multi_tenant_hardening.sql'],
  '066': ['066_fix_academia_curriculum_and_content.sql', '066_invalidate_legacy_unhashed_invitations.sql'],
  '067': ['067_academy_integrity_and_verifiable_certificates.sql', '067_create_multi_salon_ddl.sql'],
  '117': ['117_inventario_y_alquileres.sql', '117_rls_roles_array.sql'],
};

/** Frontera del baseline: por encima de este número no se admite ningún duplicado. */
const LEGACY_MAX = 117;

/**
 * Asignación determinista de la resolución de la colisión de Fase D.
 * Ver `backend/migrations/REGISTRY.md`.
 */
const ASIGNACION_FASE_D = {
  '073': '073_create_kyc_audit_logs.sql',
  '074': '074_wallet_transactions_append_only.sql',
  '075': '075_create_admin_audit_logs.sql',
  '076': '076_rag_embedding_dimension_2048.sql',
};

/** Archivos de `rollback/` que la resolución debe traer apareados con su `up`. */
const ROLLBACKS_ESPERADOS = [
  '074_wallet_transactions_append_only.down.sql',
  '076_rag_embedding_dimension_2048.down.sql',
];

// ─────────────────────────────────────────────────────────────────────────────
// Inventario
// ─────────────────────────────────────────────────────────────────────────────

/** Migraciones aplicables (mismo filtro que el runner: `.sql`, sin `.down.sql`). */
function listarMigraciones(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .filter((f) => !esRollback(f))
    .filter((f) => PREFIJO_NUMERADO.test(f))
    .sort();
}

/** Directorio → { '073': ['073_a.sql', '073_b.sql'], ... } solo con los repetidos. */
function duplicadosEn(dir) {
  const porNumero = new Map();
  for (const archivo of listarMigraciones(dir)) {
    const numero = PREFIJO_NUMERADO.exec(archivo)[1];
    if (!porNumero.has(numero)) porNumero.set(numero, []);
    porNumero.get(numero).push(archivo);
  }
  const duplicados = {};
  for (const [numero, archivos] of [...porNumero.entries()].sort()) {
    if (archivos.length > 1) duplicados[numero] = archivos;
  }
  return duplicados;
}

function archivosDeRollback(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .filter(esRollback)
    .sort();
}

const duplicadosTop = duplicadosEn(MIGRATIONS_DIR);
const duplicadosRollback = duplicadosEn(ROLLBACK_DIR);

function formatear(grupos) {
  return Object.entries(grupos)
    .map(([numero, archivos]) => `  ${numero} (${archivos.length}): ${archivos.join(', ')}`)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Casos
// ─────────────────────────────────────────────────────────────────────────────

const registro = [];
const enJest = typeof globalThis.describe === 'function' && typeof globalThis.test === 'function';
const grupo = (nombre, fn) => (enJest ? describe(nombre, fn) : fn());
const caso = (nombre, fn) => {
  if (enJest) return test(nombre, fn);
  registro.push({ nombre, fn });
};

grupo('Guard de numeración de migraciones (backend/migrations)', () => {
  caso('el baseline de duplicados legacy coincide EXACTAMENTE con el directorio', () => {
    assert.deepStrictEqual(
      duplicadosTop,
      BASELINE_DUPLICADOS_LEGACY,
      'El baseline de duplicados legacy quedó obsoleto.\n' +
        `Realidad:\n${formatear(duplicadosTop)}\n` +
        `Baseline:\n${formatear(BASELINE_DUPLICADOS_LEGACY)}\n\n` +
        'Si renumeraste un legacy, actualiza BASELINE_DUPLICADOS_LEGACY y REGISTRY.md.\n' +
        'Si el cambio vino de una rama en vuelo, renumera ESA migración: no amplíes el baseline.'
    );
  });

  caso('0 duplicados de número fuera del baseline legacy', () => {
    const nuevos = Object.fromEntries(
      Object.entries(duplicadosTop).filter(([numero]) => !(numero in BASELINE_DUPLICADOS_LEGACY))
    );
    assert.deepStrictEqual(
      nuevos,
      {},
      'Dos o más migraciones comparten prefijo numérico.\n' +
        `${formatear(nuevos)}\n\n` +
        `El prefijo debe ser único: es el contrato de orden del runner. ` +
        `El máximo en uso es ${LEGACY_MAX}; la Fase D asignó 073-076. ` +
        'Renumera la migración nueva al siguiente número libre (ver backend/migrations/REGISTRY.md).'
    );
  });

  caso('el baseline legacy no se extiende por encima de la frontera', () => {
    const porEncima = Object.keys(BASELINE_DUPLICADOS_LEGACY).filter((n) => Number(n) > LEGACY_MAX);
    assert.deepStrictEqual(
      porEncima,
      [],
      `El baseline no puede justificar duplicados por encima de ${LEGACY_MAX} ` +
        `(encontrado: ${porEncima.join(', ')}). Un duplicado nuevo se renumera, no se registra.`
    );
  });

  caso('0 duplicados de número en migrations/rollback', () => {
    assert.deepStrictEqual(
      duplicadosRollback,
      {},
      `Dos rollbacks comparten prefijo numérico:\n${formatear(duplicadosRollback)}`
    );
  });

  caso('cada .down.sql de rollback tiene su migración `up` correspondiente', () => {
    // El `up` puede estar en migrations/ o en migrations/rag/ (RAG).
    const ups = new Set([
      ...listarMigraciones(MIGRATIONS_DIR),
      ...listarMigraciones(path.join(MIGRATIONS_DIR, 'rag')),
    ]);
    // Array.from(): readdirSync devuelve un array del realm del host y deepStrictEqual
    // compara prototipos — sin normalizar, dos listas vacías fallan con "no visual difference".
    const huerfanos = Array.from(
      archivosDeRollback(ROLLBACK_DIR)
        .map((down) => down.replace(/\.down\.sql$/, '.sql'))
        .filter((up) => !ups.has(up))
    );
    assert.deepStrictEqual(
      huerfanos,
      [],
      `Rollbacks sin migración que revertir: ${huerfanos.join(', ')}`
    );
  });

  caso('la asignación de Fase D está materializada con números distintos', () => {
    const numerosVistos = new Map();
    for (const [numero, archivo] of Object.entries(ASIGNACION_FASE_D)) {
      // Las migraciones del RAG viven en migrations/rag/ y las aplica su propio
      // runner contra RAG_DATABASE_URL (ver REGISTRY.md). Materializar cuenta en
      // cualquiera de las dos carpetas.
      const ubicaciones = [
        path.join(MIGRATIONS_DIR, archivo),
        path.join(MIGRATIONS_DIR, 'rag', archivo),
      ];
      assert.ok(
        ubicaciones.some((p) => fs.existsSync(p)),
        `Falta ${archivo} (asignación de Fase D). Ver backend/migrations/REGISTRY.md.`
      );
      assert.ok(
        archivo.startsWith(`${numero}_`),
        `${archivo} no lleva el prefijo ${numero} que documenta REGISTRY.md.`
      );
      assert.ok(
        !numerosVistos.has(numero),
        `El número ${numero} está asignado a ${numerosVistos.get(numero)} y a ${archivo}.`
      );
      numerosVistos.set(numero, archivo);
    }
    assert.strictEqual(
      numerosVistos.size,
      Object.keys(ASIGNACION_FASE_D).length,
      'Las migraciones de Fase D no tienen números distintos.'
    );
  });

  caso('los rollbacks de Fase D existen', () => {
    const presentes = archivosDeRollback(ROLLBACK_DIR);
    const faltantes = ROLLBACKS_ESPERADOS.filter((f) => !presentes.includes(f));
    assert.deepStrictEqual(faltantes, [], `Faltan rollbacks: ${faltantes.join(', ')}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ejecución en solitario (sin jest / sin node_modules)
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const totales = listarMigraciones(MIGRATIONS_DIR);
  const maximo = totales.length
    ? PREFIJO_NUMERADO.exec(totales[totales.length - 1])[1]
    : '---';

  console.log('══ Guard de numeración de migraciones ══');
  console.log(`  dir             : backend/migrations`);
  console.log(`  migraciones up  : ${totales.length}`);
  console.log(`  máximo legible  : ${maximo} (por orden alfabético de archivo)`);
  console.log(`  duplicados top  : ${Object.keys(duplicadosTop).length}`);
  if (Object.keys(duplicadosTop).length) console.log(formatear(duplicadosTop));
  console.log(`  duplicados rollback: ${Object.keys(duplicadosRollback).length}`);
  console.log('');

  let fallos = 0;
  for (const { nombre, fn } of registro) {
    try {
      fn();
      console.log(`  ✔ ${nombre}`);
    } catch (err) {
      fallos += 1;
      console.log(`  ✘ ${nombre}`);
      console.log(
        String(err.message)
          .split('\n')
          .map((l) => `      ${l}`)
          .join('\n')
      );
    }
  }

  console.log('');
  console.log(`══ ${registro.length - fallos}/${registro.length} casos en verde · ${fallos} fallo(s) ══`);
  process.exit(fallos === 0 ? 0 : 1);
}

module.exports = {
  listarMigraciones,
  duplicadosEn,
  archivosDeRollback,
  BASELINE_DUPLICADOS_LEGACY,
  ASIGNACION_FASE_D,
  ROLLBACKS_ESPERADOS,
  LEGACY_MAX,
};
