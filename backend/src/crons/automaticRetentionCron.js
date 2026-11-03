// src/crons/automaticRetentionCron.js
const { AutomaticRetentionService } = require('../services/AutomaticRetentionService');

/**
 * Worker Cron para ejecutar políticas de retención automática de datos.
 * Se ejecuta diariamente.
 */
async function runAutomaticRetention() {
  console.log('🔄 [CRON RETENCIÓN] Iniciando ejecución de políticas de retención automática...');
  const service = new AutomaticRetentionService();

  try {
    // Ejecutar en modo de ejecución real (no dry-run) - el servicio leerá las variables de entorno
    const results = await service.runRetention({ dryRun: false });

    // Verificar si se obtuvo el lock (el servicio puede devolver un mensaje especial)
    if (results && results.lockObtained === false) {
      console.log('⚠️ [CRON RETENCIÓN] Otra instancia ya está ejecutándose. Saliendo.');
      return;
    }

    console.log('✅ [CRON RETENCIÓN] Ejecución completada. Resultados:');
    for (const [table, count] of Object.entries(results)) {
      // Skip special keys that are not tables
      if (table === 'executionId' || table === 'lockObtained' || table === 'message') continue;
      console.log(`  - ${table}: ${count}`);
    }
  } catch (err) {
    console.error('❌ [CRON RETENCIÓN] Error ejecutando políticas de retención:', err.message);
    // No lanzamos la excepción para que el proceso no termine abruptamente
    // En un entorno de producción, podríamos querer enviar una alerta.
  }
}

// Permitir ejecución directa por línea de comandos o invocación por programador
if (require.main === module) {
  runAutomaticRetention().then(() => {
    console.log('✅ [CRON RETENCIÓN] Proceso finalizado.');
    process.exit(0);
  }).catch((err) => {
    console.error('❌ [CRON RETENCIÓN] Error fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { runAutomaticRetention };