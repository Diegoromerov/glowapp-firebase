// backend/src/services/biometricTelemetry.js
/**
 * Servicio de Telemetría y Métricas en Tiempo Real para el Hub Biométrico (Sprint 4.2)
 */
class BiometricTelemetry {
  constructor() {
    this.metrics = {
      totalScans: 0,
      successfulScans: 0,
      failedScans: 0,
      circuitBreakerTrips: 0,
      avgLatencyMs: 0,
    };
  }

  recordScan(durationMs, success = true) {
    this.metrics.totalScans++;
    if (success) {
      this.metrics.successfulScans++;
    } else {
      this.metrics.failedScans++;
    }

    // Promedio móvil simple de latencia
    this.metrics.avgLatencyMs = Math.round(
      (this.metrics.avgLatencyMs * (this.metrics.totalScans - 1) + durationMs) / this.metrics.totalScans
    );

    console.log(`📊 [TELEMETRIA] Scan registrado: ${durationMs}ms | Éxito: ${success} | Avg: ${this.metrics.avgLatencyMs}ms`);
  }

  recordCircuitBreakerTrip(providerName) {
    this.metrics.circuitBreakerTrips++;
    console.warn(`🚨 [TELEMETRIA] Circuit Breaker trip registrado para: ${providerName}`);
  }

  getMetrics() {
    return { ...this.metrics };
  }
}

module.exports = new BiometricTelemetry();
