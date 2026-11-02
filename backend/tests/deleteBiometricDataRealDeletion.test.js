'use strict';
// backend/tests/deleteBiometricDataRealDeletion.test.js
/**
 * TEST de la tarjeta t_fix_secapp_04 — P0 N-1 «deleteBiometricData STUB que no
 * borra nada y responde éxito».
 *
 * HALLAZGO
 *   `backend/src/middleware/biometricConsent.js:360` definía un SEGUNDO
 *   `deleteBiometricData` (el bueno vive en `services/consentService.js:298`)
 *   que era un STUB: TODOS los `DELETE` estaban comentados
 *   («// Nota: Ajustar tablas según tu schema real»), devolvía `{ deleted: 0 }`
 *   y la ruta `backend/src/routes/biometricConsentRoutes.js:206`
 *   (`DELETE /api/consent/biometric/:consentType/data`) respondía
 *   `{ success: true }` sin haber borrado ni un registro.
 *
 * QUÉ REPRODUCE
 *   El derecho de supresión (Art. 15 Ley 1581) quedaba FALSO: éxito 200 +
 *   cero filas afectadas.
 *
 * CÓMO PRUEBA (sin `node_modules`, sin red, sin BD)
 *   Carga el CÓDIGO REAL de `middleware/biometricConsent.js` y de
 *   `services/consentService.js` en un sandbox `vm` con un `require` propio que
 *   inyecta únicamente los stubs de `config/db` (pool falso que REGISTRA el SQL
 *   ejecutado) y de `middleware/rateLimiter` (Redis nulo). Se ejecuta la función
 *   del middleware expuesta por la ruta y se observa qué SQL llega de verdad al
 *   pool. No se reimplementa el código bajo test.
 *
 *   - ROJO  antes del fix: 0 sentencias DELETE, delegación 0, resultado
 *     `{ deleted: 0 }` → la supresión es un no-op con éxito.
 *   - VERDE tras el fix: delegación al servicio único y DELETE reales sobre las
 *     7 tablas biométricas.
 *
 * MODO DOBLE: bajo Jest registra casos `test()` (si jest está disponible); con
 * `node backend/tests/deleteBiometricDataRealDeletion.test.js` ejecuta las mismas
 * aserciones y fija `process.exitCode`. Sin dependencias.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_DIR = path.join(__dirname, '..', 'src');
// config/consentConfig.js es configuración pura (versión vigente y encargados del
// tratamiento). El sandbox la inyecta para no depender del allowlist de requires.
const CONSENT_CONFIG = require(path.join(SRC_DIR, 'config', 'consentConfig.js'));
const MW_PATH = path.join(SRC_DIR, 'middleware', 'biometricConsent.js');
const SVC_PATH = path.join(SRC_DIR, 'services', 'consentService.js');
const ROUTE_PATH = path.join(SRC_DIR, 'routes', 'biometricConsentRoutes.js');

const MW_SRC = fs.readFileSync(MW_PATH, 'utf8');
const SVC_SRC = fs.readFileSync(SVC_PATH, 'utf8');
const ROUTE_SRC = fs.readFileSync(ROUTE_PATH, 'utf8');

// --------------------------------------------------------------------------
// Sandbox: carga el fuente REAL del módulo con un `require` restringido.
// --------------------------------------------------------------------------
function cargarModulo(ruta, stubs) {
  const src = fs.readFileSync(ruta, 'utf8');
  const moduleObj = { exports: {} };
  const sandbox = {
    module: moduleObj,
    exports: moduleObj.exports,
    __dirname: path.dirname(ruta),
    __filename: ruta,
    require: (req) => {
      if (Object.prototype.hasOwnProperty.call(stubs, req)) return stubs[req];
      throw new Error(`require no soportado en el sandbox estático: '${req}' (desde ${ruta})`);
    },
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: ruta });
  return moduleObj.exports;
}

// --------------------------------------------------------------------------
// Pool falso: registra cada sentencia; simula filas borradas y fallos de BD.
// --------------------------------------------------------------------------
function crearPool({ fallarEnDelete = false } = {}) {
  const sentencias = [];
  const pool = {
    query: async (sql, params) => {
      const s = String(sql);
      sentencias.push(s);
      const norm = s.trim().replace(/\s+/g, ' ').toUpperCase();
      if (fallarEnDelete && norm.startsWith('DELETE')) {
        throw new Error('DB_ERROR_SIMULADO');
      }
      if (norm.startsWith('SELECT REVOKED_AT')) {
        // Consentimiento revocado (precondición del endpoint de supresión).
        return { rows: [{ revoked_at: new Date() }], rowCount: 1 };
      }
      if (norm.startsWith('DELETE')) {
        return { rows: [], rowCount: 2 }; // 2 filas afectadas por tabla
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { pool, sentencias };
}

// --------------------------------------------------------------------------
// Arnés: carga servicio canónico + middleware contra el MISMO pool falso y
// espía la función canónica para observar la delegación real.
// --------------------------------------------------------------------------
function montar({ fallarEnDelete = false } = {}) {
  const { pool, sentencias } = crearPool({ fallarEnDelete });

  const svc = cargarModulo(SVC_PATH, {
    '../config/db': { pool },
    '../config/consentConfig': CONSENT_CONFIG,
    '../middleware/rateLimiter': { getRedisClient: async () => null },
  });

  let delegaciones = 0;
  const original = svc.deleteBiometricData;
  if (typeof original === 'function') {
    svc.deleteBiometricData = function (...args) {
      delegaciones += 1;
      return original.apply(this, args);
    };
  }

  const mw = cargarModulo(MW_PATH, {
    '../config/db': { pool },
    '../config/consentConfig': CONSENT_CONFIG,
    './rateLimiter': { getRedisClient: async () => null },
    '../services/consentService': svc,
  });

  return { mw, svc, pool, sentencias, delegaciones: () => delegaciones };
}

// --------------------------------------------------------------------------
// Arnés de RUTA: carga el router REAL de express con un `express` mínimo que
// captura los handlers declarados, y ejecuta el handler del endpoint expuesto.
// --------------------------------------------------------------------------
function montarRuta({ fallarEnDelete = false } = {}) {
  const { pool, sentencias } = crearPool({ fallarEnDelete });

  const svc = cargarModulo(SVC_PATH, {
    '../config/db': { pool },
    '../config/consentConfig': CONSENT_CONFIG,
    '../middleware/rateLimiter': { getRedisClient: async () => null },
  });
  const mw = cargarModulo(MW_PATH, {
    '../config/db': { pool },
    '../config/consentConfig': CONSENT_CONFIG,
    './rateLimiter': { getRedisClient: async () => null },
    '../services/consentService': svc,
  });

  const registro = [];
  const noop = () => fakeRouter;
  const fakeRouter = {
    get: (p, ...h) => registro.push({ method: 'get', path: p, handlers: h }),
    post: (p, ...h) => registro.push({ method: 'post', path: p, handlers: h }),
    put: (p, ...h) => registro.push({ method: 'put', path: p, handlers: h }),
    patch: (p, ...h) => registro.push({ method: 'patch', path: p, handlers: h }),
    delete: (p, ...h) => registro.push({ method: 'delete', path: p, handlers: h }),
    use: noop,
  };

  cargarModulo(ROUTE_PATH, {
    express: { Router: () => fakeRouter },
    '../utils/expressAsync': { wrapRouterAsync: () => {} },
    '../middleware/auth': { authMiddleware: (req, res, next) => next() },
    '../middleware/biometricConsent': mw,
    '../config/consentConfig': CONSENT_CONFIG,
  });

  const ruta = registro.find(
    (r) => r.method === 'delete' && /biometric\/:consentType\/data/.test(r.path)
  );

  async function invocar() {
    if (!ruta) throw new Error('no se registró DELETE /biometric/:consentType/data');
    const handler = ruta.handlers[ruta.handlers.length - 1];
    const req = { user: { id: 'user-123' }, params: { consentType: 'facial_analysis' } };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    await handler(req, res);
    return { status: res.statusCode, body: res.body };
  }

  return { ruta, invocar, sentencias };
}

// Tablas que la implementación canónica (consentService) borra de verdad.
//
// Se derivan de la lista `tables` del propio código, NO de un escaneo de literales
// `DELETE FROM <tabla>`: el refactor 94b199b45 pasó de 7 sentencias sueltas a un bucle
// parametrizado sobre un array, y el escaneo textual devolvía [] — lo que rompía B3/E4
// por la razón equivocada mientras el borrado funcionaba.
//
// Y se exige además que cada tabla exista en las migraciones: la versión anterior
// borraba de 6 tablas FANTASMA (facial_analysis, skin_analysis, hair_analysis,
// virtual_try_on, body_measurements, facial_embeddings) que ninguna migración crea,
// mientras las 6 reales del servicio no se tocaban. Eso es lo que hay que vigilar.
const TABLAS_CANONICAS = [
  ...(SVC_SRC.match(/const\s+tables\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1].matchAll(
    /'([A-Za-z_][A-Za-z0-9_]*)'/g
  ),
].map((m) => m[1].toLowerCase());

// Esquema real: toda tabla de la lista de supresión debe estar creada por alguna migración.
const MIGRACIONES_SRC = fs
  .readdirSync(path.join(__dirname, '..', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'))
  .join('\n');
const tablasReales = (tabla) =>
  new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(public\\.)?${tabla}\\b`, 'i').test(
    MIGRACIONES_SRC
  );

function tablasBorradas(sentencias) {
  const set = new Set();
  for (const s of sentencias) {
    const m = s.match(/^\s*DELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (m) set.add(m[1].toLowerCase());
  }
  return set;
}

// Lista estable de aserciones (ids usados por Jest y por el runner estático).
const CHECKS = [
  { id: 'B1', nombre: 'el middleware DELEGA en consentService.deleteBiometricData (implementación única)' },
  { id: 'B2', nombre: 'deleteBiometricData ejecuta sentencias DELETE reales contra la BD' },
  { id: 'B3', nombre: 'la supresión cubre TODAS las tablas canónicas del servicio' },
  { id: 'B4', nombre: 'reporta recordsAffected > 0 (registros realmente suprimidos)' },
  { id: 'B5', nombre: 'retorna deleted === true en éxito (no un falso {deleted:0})' },
  { id: 'B6', nombre: 'ante error de BD retorna deleted===false (fail-closed, nunca falso éxito)' },
  { id: 'R1', nombre: 'el endpoint expuesto DELETE /biometric/:consentType/data responde supresión efectiva (no {deleted:0} con éxito)' },
  { id: 'E1', nombre: 'el middleware ya no contiene DELETEs comentados (stub muerto eliminado)' },
  { id: 'E2', nombre: 'el fuente del middleware delega explícitamente en consentService' },
  { id: 'E3', nombre: 'la ruta de exposición (DELETE /biometric/:consentType/data) usa esa única implementación' },
  { id: 'E4', nombre: 'toda tabla de la supresión existe en las migraciones (sin tablas fantasma)' },
];

async function evaluarTodo() {
  const res = new Map();
  const put = (id, ok, detalle = '') => res.set(id, { id, ok: !!ok, detalle });

  // ---------------- comportamiento observable (happy path) ----------------
  const h = montar();
  let salida = null;
  let lanzo = null;
  try {
    salida = await h.mw.deleteBiometricData('user-123', 'facial_analysis');
  } catch (e) {
    lanzo = e;
  }
  const deletes = h.sentencias.filter((s) => /^\s*DELETE\s+FROM/i.test(s));
  const borradas = tablasBorradas(h.sentencias);
  const delegaciones = h.delegaciones();

  put(
    'B1',
    delegaciones >= 1,
    `delegaciones a consentService.deleteBiometricData = ${delegaciones}`
  );
  put('B2', deletes.length >= 1, `sentencias DELETE ejecutadas = ${deletes.length}`);
  put(
    'B3',
    TABLAS_CANONICAS.length > 0 &&
      TABLAS_CANONICAS.every((t) => borradas.has(t)) &&
      TABLAS_CANONICAS.every(tablasReales),
    `tablas canónicas borradas = [${[...borradas].join(', ') || 'ninguna'}] de [${TABLAS_CANONICAS.join(', ')}]` +
      ` · todas existen en migraciones = ${TABLAS_CANONICAS.every(tablasReales)}`
  );
  put(
    'B4',
    !!salida && typeof salida.recordsAffected === 'number' && salida.recordsAffected > 0,
    `salida = ${JSON.stringify(salida)}`
  );
  put('B5', !!salida && salida.deleted === true, `salida.deleted = ${salida && salida.deleted}`);
  if (lanzo) {
    put('B1', false, `la llamada lanzó: ${lanzo.message}`);
  }

  // ------------- comportamiento ante fallo de BD (fail-closed) -------------
  const hErr = montar({ fallarEnDelete: true });
  let salidaErr = null;
  let lanzoErr = null;
  try {
    salidaErr = await hErr.mw.deleteBiometricData('user-123', 'facial_analysis');
  } catch (e) {
    lanzoErr = e;
  }
  put(
    'B6',
    !lanzoErr &&
      !!salidaErr &&
      salidaErr.deleted === false &&
      salidaErr.recordsAffected === 0,
    lanzoErr ? `lanzó: ${lanzoErr.message}` : `salida = ${JSON.stringify(salidaErr)}`
  );

  // ------------- comportamiento del ENDPOINT expuesto (ruta real) ----------
  const r = montarRuta();
  let resp = null;
  let lanzoRuta = null;
  try {
    resp = await r.invocar();
  } catch (e) {
    lanzoRuta = e;
  }
  put(
    'R1',
    !lanzoRuta &&
      !!resp &&
      resp.status === 200 &&
      resp.body &&
      resp.body.success === true &&
      resp.body.data &&
      resp.body.data.deleted === true &&
      resp.body.data.recordsAffected > 0,
    lanzoRuta ? `lanzó: ${lanzoRuta.message}` : `HTTP ${resp && resp.status} body = ${JSON.stringify(resp && resp.body)}`
  );

  // ---------------------------- estáticos --------------------------------
  const deletesComentados = [...MW_SRC.matchAll(/^[ \t]*\/\/.*DELETE\s+FROM/gim)].map((m) =>
    m[0].trim()
  );
  put(
    'E1',
    deletesComentados.length === 0,
    `DELETEs comentados en el middleware = ${deletesComentados.length}`
  );

  put(
    'E2',
    /consentService\s*\.\s*deleteBiometricData/.test(MW_SRC),
    'referencia a consentService.deleteBiometricData en el fuente'
  );

  put(
    'E3',
    /deleteBiometricData\s*\(\s*userId\s*,\s*consentType\s*\)/.test(ROUTE_SRC) &&
      /require\('\.\.\/middleware\/biometricConsent'\)/.test(ROUTE_SRC),
    'la ruta invoca deleteBiometricData(userId, consentType) del middleware'
  );

  const fantasmas = TABLAS_CANONICAS.filter((t) => !tablasReales(t));
  put(
    'E4',
    TABLAS_CANONICAS.length > 0 && fantasmas.length === 0,
    `tablas de supresión en consentService = ${TABLAS_CANONICAS.length} · sin tablas fantasma = ${fantasmas.length === 0}` +
      (fantasmas.length ? ` (fantasma: ${fantasmas.join(', ')})` : '')
  );

  return res;
}

// --------------------------------------------------------------------------
// MODO JEST / CI
// --------------------------------------------------------------------------
if (typeof describe === 'function' && typeof test === 'function') {
  describe('t_fix_secapp_04 — deleteBiometricData borra de verdad (sin stub que finge éxito)', () => {
    for (const c of CHECKS) {
      test(`${c.id} — ${c.nombre}`, async () => {
        const res = await evaluarTodo();
        const r = res.get(c.id);
        if (!r.ok) throw new Error(`${c.id}: ${c.nombre} :: ${r.detalle}`);
        expect(r.ok).toBe(true);
      });
    }
  });
} else {
  // ------------------------------------------------- RUNNER ESTÁTICO (E1)
  (async () => {
    const res = await evaluarTodo();
    const fallos = [];
    console.log('\n== Verificación t_fix_secapp_04 — deleteBiometricData (supresión real) ==');
    console.log(`Middleware bajo test: ${MW_PATH}`);
    console.log(`Servicio canónico:    ${SVC_PATH}`);
    console.log(`Ruta expuesta:        ${ROUTE_PATH}\n`);
    for (const c of CHECKS) {
      const r = res.get(c.id);
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  [${c.id}] ${c.nombre}`);
      console.log(`         ${r.detalle}`);
      if (!r.ok) fallos.push(`${c.id} — ${c.nombre}`);
    }
    const total = CHECKS.length;
    console.log(`\n== RESULTADO: ${total - fallos.length} PASS / ${fallos.length} FAIL ==`);
    if (fallos.length) {
      console.log('Fallos:');
      for (const f of fallos) console.log(`  - ${f}`);
      process.exitCode = 1;
    }
  })().catch((e) => {
    console.error('ERROR en el runner:', e);
    process.exitCode = 1;
  });
}
