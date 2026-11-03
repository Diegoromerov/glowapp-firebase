/**
 * OpenTelemetry Instrumentation Setup
 * Inicializa tracing y métricas para el backend
 * Debe importarse ANTES que cualquier otro módulo (en index.js primer línea)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { PeriodicExportingMetricReader, MetricReader } from '@opentelemetry/sdk-metrics';

// Configuración de recursos
const resource = resourceFromAttributes({
  [SemanticResourceAttributes.SERVICE_NAME]: 'glowapp-backend',
  [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
  [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  [SemanticResourceAttributes.CLOUD_PROVIDER]: 'railway',
  [SemanticResourceAttributes.CLOUD_REGION]: process.env.RAILWAY_REGION || 'unknown',
});

// Exporter de traces (OTLP HTTP → Grafana Tempo / Jaeger / Grafana Cloud)
const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces',
  headers: process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS
    ? JSON.parse(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS)
    : {},
});

// Custom Prometheus Remote Write Exporter for Grafana Cloud
class PrometheusRemoteWriteExporter {
  constructor(url, headers = {}) {
    this.url = url;
    this.headers = { 'Content-Type': 'text/plain; version=0.0.4', ...headers };
  }

  async export(metrics, resultCallback) {
    try {
      const prometheusText = this.metricsToPrometheusText(metrics);
      
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.headers,
        body: prometheusText,
      });

      if (!response.ok) {
        throw new Error(`Remote write failed: ${response.status} ${response.statusText}`);
      }

      resultCallback({ code: 0 }); // SUCCESS = 0
    } catch (err) {
      console.error('[OTEL] Remote write export failed:', err);
      resultCallback({ code: 1, error: err }); // FAILED = 1
    }
  }

  async shutdown() {
    // No-op
  }

  metricsToPrometheusText(metrics) {
    const lines = [];
    for (const metric of metrics) {
      const name = metric.name;
      const description = metric.description || '';
      const unit = metric.unit || '';
      
      if (description) lines.push(`# HELP ${name} ${description}`);
      if (unit) lines.push(`# UNIT ${name} ${unit}`);
      // metricKind: 1 = Counter, 2 = UpDownCounter, 3 = Histogram, 4 = Gauge
      const type = metric.metricKind === 1 ? 'counter' : metric.metricKind === 2 ? 'gauge' : metric.metricKind === 3 ? 'histogram' : 'gauge';
      lines.push(`# TYPE ${name} ${type}`);
      
      for (const dataPoint of metric.dataPoints) {
        const labels = Object.entries(dataPoint.attributes || {})
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        const labelStr = labels ? `{${labels}}` : '';
        const value = dataPoint.value !== undefined ? dataPoint.value : 0;
        lines.push(`${name}${labelStr} ${value}`);
      }
    }
    return lines.join('\n') + '\n';
  }
}

// Exporter de métricas: Prometheus local (dev) OR Prometheus Remote Write (Grafana Cloud)
let metricReader;
if (process.env.PROMETHEUS_REMOTE_WRITE_URL) {
  // Grafana Cloud: Prometheus Remote Write
  const remoteWriteExporter = new PrometheusRemoteWriteExporter(
    process.env.PROMETHEUS_REMOTE_WRITE_URL,
    process.env.PROMETHEUS_REMOTE_WRITE_HEADERS
      ? JSON.parse(process.env.PROMETHEUS_REMOTE_WRITE_HEADERS)
      : {}
  );
  metricReader = new PeriodicExportingMetricReader({
    exporter: remoteWriteExporter,
    exportIntervalMillis: 10_000,
  });
  console.log('[OTEL] Using Prometheus Remote Write exporter for Grafana Cloud');
} else {
  // Local development: Prometheus HTTP exporter
  const prometheusExporter = new PrometheusExporter(
    { port: 9464, endpoint: '/metrics' },
    () => console.log('[OTEL] Prometheus exporter listening on :9464/metrics')
  );
  metricReader = new PeriodicExportingMetricReader({
    exporter: prometheusExporter,
    exportIntervalMillis: 10_000,
  });
}

// SDK de OpenTelemetry
const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Deshabilitar instrumentaciones que causan ruido o conflictos
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-tls': { enabled: false },
      // Configurar instrumentaciones clave
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-pg': { enabled: true },
      '@opentelemetry/instrumentation-redis-4': { enabled: true },
    }),
  ],
});

// Inicializar SDK
try {
  sdk.start();
  console.log('[OTEL] OpenTelemetry SDK initialized');
} catch (err) {
  console.error('[OTEL] Failed to initialize SDK:', err);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('[OTEL] SDK shutdown complete'))
    .catch((err) => console.error('[OTEL] SDK shutdown error:', err))
    .finally(() => process.exit(0));
});

export { sdk };
export default sdk;