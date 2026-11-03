#!/usr/bin/env node
/**
 * scripts/purgeAcademyEvidence.js
 * ============================================================================
 * Cumple la promesa de retención que la propia app declara al pedir el
 * consentimiento biométrico (Ley 1581 de 2012):
 *   "Autorizo que GlowApp almacene estas evidencias de forma cifrada y las
 *    elimine una vez cumplida su finalidad."
 *
 * Hasta ahora no existía ningún proceso que borrara nada: las fotografías de los
 * talleres (dato sensible) se acumulaban indefinidamente (hallazgo T3/T4 de la
 * auditoría 2026-09-22). Este script es ese proceso.
 *
 * Qué borra: la evidencia fotográfica y el texto de las respuestas de talleres
 *   con más de RETENCION_MESES (12 por defecto) de antigüedad.
 * Qué conserva: la fila de `academy_worksheet_submissions` (queda como constancia
 *   de que el taller se entregó) y TODO el rastro de consentimiento.
 *
 * Uso:
 *   node scripts/purgeAcademyEvidence.js                 # simulación
 *   node scripts/purgeAcademyEvidence.js --apply         # ejecuta el borrado
 *   node scripts/purgeAcademyEvidence.js --apply --months=6
 *
 * Programar en el cron del despliegue (p. ej. mensual): es idempotente.
 * ============================================================================
 */

const path = require('path');

try {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) { /* dotenv es opcional */ }

const { Client } = require('pg');

/** Meses de retención de evidencia (configurable por entorno). */
function mesesDeRetencion(override) {
  const valor = parseInt(override || process.env.ACADEMY_RETENTION_MONTHS, 10);
  if (!Number.isFinite(valor) || valor < 1) return 12;
  return valor;
}

/** Fecha de corte: lo anterior a ella se purga. */
function fechaLimite(meses, ahora = new Date()) {
  const limite = new Date(ahora.getTime());
  limite.setMonth(limite.getMonth() - meses);
  return limite;
}

function connectionString() {
  return process.env.DATABASE_URL
    || `postgres://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'beauty_db'}`;
}

async function purgar({ aplicar, meses, client }) {
  const limite = fechaLimite(meses);

  const { rows } = await client.query(`
    SELECT COUNT(*)::int AS total
      FROM academy_worksheet_submissions
     WHERE enviado_at < $1
       AND (evidencia_foto_url IS NOT NULL OR respuestas_texto IS DISTINCT FROM '{"purgado":true}'::jsonb)
  `, [limite]);

  console.log(`🗓️  Retención: ${meses} meses (corte: ${limite.toISOString().slice(0, 10)})`);
  console.log(`📸 Evidencias a purgar: ${rows[0].total}`);

  if (!aplicar || rows[0].total === 0) return { purgadas: 0, candidatas: rows[0].total };

  // La fotografía es el dato sensible: se elimina. El texto de respuestas es
  // NOT NULL en el esquema, así que se sustituye por una marca de purga en vez
  // de un NULL imposible (la fila se conserva como constancia de entrega).
  const resultado = await client.query(`
    UPDATE academy_worksheet_submissions
       SET evidencia_foto_url = NULL,
           respuestas_texto = '{"purgado":true}'::jsonb
     WHERE enviado_at < $1
       AND (evidencia_foto_url IS NOT NULL OR respuestas_texto IS DISTINCT FROM '{"purgado":true}'::jsonb)
  `, [limite]);

  return { purgadas: resultado.rowCount, candidatas: rows[0].total };
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--apply');
  const meses = mesesDeRetencion((args.find((a) => a.startsWith('--months=')) || '').split('=')[1]);

  const client = new Client({ connectionString: connectionString() });
  await client.connect();

  try {
    console.log(`\n🔐 Purga de evidencias de la Academia Glow — modo ${aplicar ? 'APLICAR' : 'SIMULACIÓN'}`);
    const { purgadas, candidatas } = await purgar({ aplicar, meses, client });

    if (!aplicar) {
      console.log('🧪 Simulación: no se modificó nada. Usa --apply para ejecutar.\n');
    } else {
      console.log(`✅ Filas purgadas: ${purgadas} (la constancia de entrega y el consentimiento se conservan)`);
      console.log(`ℹ️  Candidatas totales: ${candidatas}\n`);
    }

    const consent = await client.query(`
      SELECT COUNT(*)::int AS aceptados,
             COUNT(*) FILTER (WHERE aceptado = FALSE AND fecha_revocacion IS NOT NULL)::int AS revocados
        FROM academy_consentimientos`);
    console.log(`📋 Consentimientos: ${consent.rows[0].aceptados} (revocados con fecha: ${consent.rows[0].revocados})\n`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('💥 Error purgando evidencias de la academia:', err.message);
    process.exit(1);
  });
}

module.exports = { fechaLimite, mesesDeRetencion, purgar };
