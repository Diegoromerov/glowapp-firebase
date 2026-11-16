// backend/src/crons/fulfillmentRecoveryCron.js
// Cron job: recuperar pedidos PAGADO sin fulfillment procesado
// Se ejecuta cada 10 minutos para cubrir casos donde webhook falló o fulfillment falló

const { recoverUnfulfilledOrders } = require('../jobs/fulfillmentOrchestrator');

/**
 * Job programado: revisar pedidos PAGADO sin envíos creados
 * Se ejecuta cada 10 minutos (configurable via CRON_FULFILLMENT_RECOVERY)
 */
async function runFulfillmentRecovery() {
  const startTime = Date.now();
  console.log('[CRON FULFILLMENT RECOVERY] Iniciando...');

  try {
    const result = await recoverUnfulfilledOrders();
    const duration = Date.now() - startTime;
    console.log(`[CRON FULFILLMENT RECOVERY] Completado en ${duration}ms: ${result.procesados} pedidos procesados`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[CRON FULFILLMENT RECOVERY] Error tras ${duration}ms:`, error.message);
    throw error;
  }
}

// Auto-ejecutar si se invoca directamente (para testing)
if (require.main === module) {
  runFulfillmentRecovery()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runFulfillmentRecovery };