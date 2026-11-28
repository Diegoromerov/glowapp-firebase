// backend/src/jobs/usageMonthlyReset.js
const { pool } = require('../config/db');
const usageMeteringService = require('../services/usageMeteringService');

/**
 * Job mensual: resumen y auditoría de métricas de uso
 * Se ejecuta día 1 de cada mes a las 00:05 UTC (configurar en cron)
 * 
 * En PostgreSQL, el "reset" es natural porque period_start cambia.
 * Este job no envía email ni webhook. Solo calcula datos y registra un
 * resumen interno para auditoría/diagnóstico.
 */
async function runMonthlyUsageReset() {
  const startTime = Date.now();
  console.log('[usageMonthlyReset] Iniciando reset mensual...', new Date().toISOString());

  try {
    // 1. Calcular reglas heredadas de umbral; no se despachan externamente.
    const alerts = await usageMeteringService.checkUsageAlerts();
    console.log(`[usageMonthlyReset] Alertas de uso generadas: ${alerts.length}`);

    // 2. Detectar tenants que excedieron límites mes anterior
    const exceeded = await usageMeteringService.resetMonthlyCounters();
    console.log(`[usageMonthlyReset] Tenants con overage mes anterior: ${exceeded.exceeded.length}`);

    // 3. Log de auditoría
    await pool.query(`
      INSERT INTO audit_logs (actor_id, action, target_type, metadata)
      VALUES (NULL, 'monthly_usage_reset', 'platform', $1)
    `, [JSON.stringify({
      executedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      alertsGenerated: alerts.length,
      overageTenants: exceeded.exceeded.length
    })]);

    // 4. Escribir un resumen interno en logs; no se envía correo ni webhook.
    if (alerts.length > 0 || exceeded.exceeded.length > 0) {
      await logSuperAdminUsageSummary({ alerts, exceeded });
    }

    console.log(`[usageMonthlyReset] Completado en ${Date.now() - startTime}ms`);
    return { success: true, alerts, exceeded: exceeded.exceeded };

  } catch (error) {
    console.error('[usageMonthlyReset] Error:', error.message);
    
    await pool.query(`
      INSERT INTO audit_logs (actor_id, action, target_type, metadata)
      VALUES (NULL, 'monthly_usage_reset_failed', 'platform', $1)
    `, [JSON.stringify({ error: error.message, executedAt: new Date().toISOString() })]);

    throw error;
  }
}

/**
 * Registra en logs un resumen interno para diagnóstico de super-admins.
 */
async function logSuperAdminUsageSummary({ alerts, exceeded }) {
  console.log('[usageMonthlyReset] Resumen interno de uso (solo logs):');
  console.log(`  - Alertas de threshold: ${alerts.length}`);
  console.log(`  - Tenants con overage: ${exceeded.length}`);
  
  if (exceeded.length > 0) {
    exceeded.forEach(e => {
      console.log(`  ⚠ ${e.name} (${e.saas_plan}): ${e.feature} = ${e.count}/${e.limit} (+${Math.round(((e.count - e.limit) / e.limit) * 100)}%)`);
    });
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  runMonthlyUsageReset()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { runMonthlyUsageReset };
