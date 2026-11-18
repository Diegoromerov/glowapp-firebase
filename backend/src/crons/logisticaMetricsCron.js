// Refresco diario de métricas logísticas. La función SQL trabaja solo con el
// día solicitado; el advisory lock evita que réplicas simultáneas repitan el job.

const { pool, systemPool } = require('../config/db');
const { runAsSystem } = require('../config/tenantRouting');

const LOCK_NAMESPACE = 180;
const LOCK_ID = 173;
const RUN_HOUR_UTC = 2;
const RUN_MINUTE_UTC = 20;

let timer = null;

function fechaUtcAyer(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return date.toISOString().slice(0, 10);
}

function demoraAlProximoRefresco(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(RUN_HOUR_UTC, RUN_MINUTE_UTC, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

async function refrescarMetricasLogisticas(fecha = fechaUtcAyer()) {
  return runAsSystem({ pool, systemPool }, async (client) => {
    const lock = await client.query(
      'SELECT pg_try_advisory_xact_lock($1, $2) AS acquired',
      [LOCK_NAMESPACE, LOCK_ID]
    );
    if (!lock.rows[0]?.acquired) {
      return { skipped: true, reason: 'another instance is refreshing' };
    }

    await client.query(
      'SELECT refrescar_logistica_metricas_diarias($1::date)',
      [fecha]
    );
    return { skipped: false, fecha };
  });
}

function programarSiguiente() {
  timer = setTimeout(async () => {
    try {
      const result = await refrescarMetricasLogisticas();
      console.log('[CRON LOGISTICA METRICAS] Refresco finalizado:', JSON.stringify(result));
    } catch (error) {
      console.error('[CRON LOGISTICA METRICAS] Error de refresco:', error.message);
    } finally {
      programarSiguiente();
    }
  }, demoraAlProximoRefresco());
  timer.unref?.();
  return timer;
}

function iniciarLogisticaMetricsCron() {
  if (timer) return timer;
  console.log('[CRON LOGISTICA METRICAS] Programado diariamente a las 02:20 UTC');
  return programarSiguiente();
}

module.exports = {
  fechaUtcAyer,
  demoraAlProximoRefresco,
  refrescarMetricasLogisticas,
  iniciarLogisticaMetricsCron,
};
