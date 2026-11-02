// backend/src/tests/crashTraceCorrelation.test.js
//
// FIX-FLUTTER-07 (P1) — Guarda estática de correlación backend.
//
// El cliente Flutter envía el header X-Trace-Id en el reporte de crash; el
// middleware global (src/middleware/traceId.js, montado en index.js:205) lo
// expone como req.traceId y lo registra en los logs. Para cerrar la
// correlación, el evento de crash persistido debe guardar ese mismo trace_id
// de modo que la fila de analytics_events y la línea de log del backend
// compartan identificador.
//
// Test dual (patrón Fase C): corre bajo Jest si existe describe(), y con
// `node src/tests/crashTraceCorrelation.test.js` sin dependencias instaladas.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const CONTROLLER = read('controllers/analyticsController.js');
const TRACE_MW = read('middleware/traceId.js');

const cases = [
  [
    'el middleware de trace acepta X-Trace-Id del cliente',
    () => {
      assert.ok(
        /x-trace-id/i.test(TRACE_MW),
        'traceId.js debe leer el header x-trace-id'
      );
    },
  ],
  [
    'analyticsController persiste el trace_id de la request en el evento',
    () => {
      assert.ok(
        /trace_id\s*:\s*req\.traceId/.test(CONTROLLER),
        'El evento almacenado debe incluir trace_id: req.traceId para correlacionar con los logs del backend'
      );
    },
  ],
  [
    'el trace_id se agrega al metadata del evento persistido',
    () => {
      // Región del mapping de eventos (evita el falso positivo del `{}` de
      // `...(item.metadata || {})`).
      const region = CONTROLLER.match(/records\s*=\s*items\.map[\s\S]*?occurred_at\s*:/);
      assert.ok(region, 'analyticsController debe mapear los eventos a records');
      assert.ok(
        /trace_id/.test(region[0]),
        'metadata del evento persistido debe contener trace_id'
      );
    },
  ],
];

if (typeof describe === 'function' && typeof it === 'function') {
  describe('FIX-FLUTTER-07 crash trace correlation', () => {
    cases.forEach(([name, fn]) => it(name, fn));
  });
} else {
  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      fn();
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL  ${name}\n      -> ${err.message}`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed}/${cases.length} casos fallaron`);
    process.exitCode = 1;
  } else {
    console.log(`\n${cases.length}/${cases.length} casos OK`);
  }
}
