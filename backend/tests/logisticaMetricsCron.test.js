'use strict';

const fs = require('fs');
const path = require('path');

describe('refresco diario de métricas logísticas', () => {
  const backend = path.join(__dirname, '..');
  const migration = fs.readFileSync(
    path.join(backend, 'migrations/180_fix_logistics_daily_metrics.sql'),
    'utf8'
  );
  const cron = fs.readFileSync(
    path.join(backend, 'src/crons/logisticaMetricsCron.js'),
    'utf8'
  );
  const runner = fs.readFileSync(
    path.join(backend, 'scripts/prepareRlsDatabase.js'),
    'utf8'
  );
  const entrypoint = fs.readFileSync(path.join(backend, 'index.js'), 'utf8');
  const orderController = fs.readFileSync(
    path.join(backend, 'src/controllers/orderController.js'),
    'utf8'
  );

  test('cuenta estados terminales del flujo real de devoluciones', () => {
    expect(migration).toMatch(/RECHAZADA','REEMBOLSADA','CAMBIADA','CERRADA/);
    expect(migration).not.toMatch(/estado\s*=\s*'RESUELTA'/);
  });

  test('agrega envíos y devoluciones por separado, sin multiplicar valores del envío', () => {
    expect(migration).toMatch(/shipment_stats AS/);
    expect(migration).toMatch(/return_events AS/);
    expect(migration).toMatch(/FULL JOIN return_stats/);
    expect(migration).toMatch(/LATERAL/);
    expect(migration).toMatch(/idx_envios_creado_en_metricas/);
  });

  test('registra la migración y arranca el job diario una sola vez por proceso', () => {
    expect(runner.match(/'180_fix_logistics_daily_metrics\.sql'/g)).toHaveLength(2);
    expect(entrypoint).toMatch(/iniciarLogisticaMetricsCron\(\)/);
    expect(cron).toMatch(/pg_try_advisory_xact_lock/);
    expect(cron).toMatch(/RUN_HOUR_UTC = 2/);
  });

  test('persiste peso y tarifa cotizada al crear una etiqueta', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS peso_kg NUMERIC/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS costo_etiqueta_cop BIGINT/);
    expect(orderController).toMatch(/peso_kg = \$6, costo_etiqueta_cop = \$7/);
    expect(orderController).toMatch(/bestRate\.rate_cop/);
  });
});
