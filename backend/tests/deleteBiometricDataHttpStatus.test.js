'use strict';
// backend/tests/deleteBiometricDataHttpStatus.test.js
/**
 * TEST de la tarjeta t_fix_secapp_05 — P1 N-11 «la ruta de supresión responde
 * HTTP 200 {success:true} aunque el borrado FALLE».
 *
 * HALLAZGO
 *   t_fix_secapp_04 hizo que `backend/src/middleware/biometricConsent.js`
 *   delegue en la implementación única y real `consentService.deleteBiometricData`
 *   (7 tablas), que es FAIL-CLOSED: ante error de BD devuelve
 *   `{ deleted: false, recordsAffected: 0, error }` — nunca lanza.
 *   Pero la RESPUESTA HTTP quedó intacta: el handler de
 *   `backend/src/routes/biometricConsentRoutes.js:206`
 *   (`DELETE /api/consent/biometric/:consentType/data`) hacía `res.json({success:true,
 *   data: result, message: 'Datos biometricos eliminados permanentemente...'})`
 *   SIN mirar `result`. Resultado: el cliente recibía 200 + «eliminados
 *   permanentemente» mientras `result.deleted === false` y no se borró nada.
 *   El titular creía ejercido su derecho de supresión (Ley 1581, Art. 8/15) y no
 *   lo estaba.
 *
 * QUÉ REPRODUCE
 *   Éxito HTTP falso ante fallo de borrado: el contrato HTTP miente sobre el
 *   resultado de la operación.
 *
 * CÓMO PRUEBA (sin `node_modules`, sin red, sin BD)
 *   Carga el CÓDIGO REAL (middleware + servicio + routers) en un sandbox `vm`
 *   con un `require` propio que inyecta un pool falso:
 *     - `fallarEnDelete: true` → todo `DELETE` lanza `DB_ERROR_SIMULADO`
 *       (simulación literal de fallo de BD).
 *     - `fallarEnDelete: false` → `DELETE` devuelve 2 filas (borrado real).
 *   Se ejecuta el HANDLER REAL del endpoint (router express falso que captura
 *   los handlers declarados) y se observa la respuesta HTTP de verdad.
 *   Un segundo arnés sustituye `deleteBiometricData` por un doble con el
 *   contrato del servicio (fail-closed / éxito) para fijar el contrato HTTP sin
 *   depender de qué implementación puntual esté conectada.
 *
 *   - ROJO  antes del fix: fallo de BD → HTTP 200 `{success:true}` (falso éxito).
 *   - VERDE tras el fix:   fallo de BD → HTTP 500 con error, nunca `success:true`;
 *     el camino de éxito real sigue devolviendo 200.
 *
 * MODO DOBLE: bajo Jest registra casos `test()` (si jest está disponible); con
 * `node backend/tests/deleteBiometricDataHttpStatus.test.js` ejecuta las mismas
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
const ROUTE_BIO = path.join(SRC_DIR, 'routes', 'biometricConsentRoutes.js');
const ROUTE_CONSENT = path.join(SRC_DIR, 'routes', 'consentRoutes.js');

const ROUTE_BIO_SRC = fs.readFileSync(ROUTE_BIO, 'utf8');
const ROUTE_CONSENT_SRC = fs.readFileSync(ROUTE_CONSENT, 'utf8');

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
// Pool falso: registra cada sentencia; simula borrado real y fallo de BD.
// --------------------------------------------------------------------------
function crearPool({ fallarEnDelete = false, filasPorTabla = 2 } = {}) {
  const sentencias = [];
  const pool = {
    query: async (sql, params) => {
      const s = String(sql);
      sentencias.push(s);
      const norm = s.trim().replace(/\s+/g, ' ').toUpperCase();
      if (norm.startsWith('SELECT REVOKED_AT')) {
        // Consentimiento revocado: precondición del endpoint de supresión.
        return { rows: [{ revoked_at: new Date() }], rowCount: 1 };
      }
      if (norm.startsWith('DELETE')) {
        if (fallarEnDelete) throw new Error('DB_ERROR_SIMULADO');
        return { rows: [], rowCount: filasPorTabla };
      }
      if (norm.startsWith('INSERT')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  return { pool, sentencias };
}

// --------------------------------------------------------------------------
// Router express falso: captura método + path + handlers declarados.
// --------------------------------------------------------------------------
function crearFakeRouter() {
  const registro = [];
  const router = {
    get: (p, ...h) => (registro.push({ method: 'get', path: p, handlers: h }), router),
    post: (p, ...h) => (registro.push({ method: 'post', path: p, handlers: h }), router),
    put: (p, ...h) => (registro.push({ method: 'put', path: p, handlers: h }), router),
    patch: (p, ...h) => (registro.push({ method: 'patch', path: p, handlers: h }), router),
    delete: (p, ...h) => (registro.push({ method: 'delete', path: p, handlers: h }), router),
    use: () => router,
  };
  return { router, registro };
}

// Respuesta express falsa: registra status + payload exactos.
function crearResFalsa() {
  return {
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
}

async function invocarHandler(registro, filtro, req) {
  const ruta = registro.find(filtro);
  if (!ruta) throw new Error(`no se registró la ruta buscada (${String(filtro)})`);
  const handler = ruta.handlers[ruta.handlers.length - 1]; // el último es el handler de negocio
  if (typeof handler !== 'function') throw new Error('el handler capturado no es función');
  const res = crearResFalsa();
  let lanzo = null;
  try {
    await handler(req, res);
  } catch (e) {
    lanzo = e;
  }
  return { status: res.statusCode, body: res.body, lanzo };
}

function esExitoFalso(resp) {
  if (!resp || resp.lanzo) return false;
  const ok2xx = resp.status >= 200 && resp.status < 300;
  const reclamaExito =
    !!resp.body &&
    (resp.body.success === true ||
      (resp.body.data && resp.body.data.deleted === true) ||
      (typeof resp.body.message === 'string' && /eliminad/i.test(resp.body.message)));
  return ok2xx && reclamaExito;
}

// --------------------------------------------------------------------------
// Arnés 1: endpoint biométrico con la PILA REAL y fallo de BD simulado.
// --------------------------------------------------------------------------
function montarEndpointBiometrico({ fallarEnDelete = false, reemplazarDelete = null } = {}) {
  const { pool } = crearPool({ fallarEnDelete });

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

  // Sustitución del doble (arnés de contrato) ANTES de cargar el router, que
  // desestructura la función en tiempo de require.
  if (reemplazarDelete) mw.deleteBiometricData = reemplazarDelete;

  const { router, registro } = crearFakeRouter();
  cargarModulo(ROUTE_BIO, {
    express: { Router: () => router },
    '../utils/expressAsync': { wrapRouterAsync: () => {} },
    '../middleware/auth': { authMiddleware: (req, res, next) => next() },
    '../middleware/biometricConsent': mw,
    '../config/consentConfig': CONSENT_CONFIG,
  });

  return () =>
    invocarHandler(
      registro,
      (r) => r.method === 'delete' && r.path === '/biometric/:consentType/data',
      { user: { id: 'user-123' }, params: { consentType: 'facial_analysis' }, body: {} }
    );
}

// --------------------------------------------------------------------------
// Arnés 2: endpoint /api/consent/data (consentRoutes) con la PILA REAL.
// --------------------------------------------------------------------------
function montarEndpointConsent({ fallarEnDelete = false, reemplazarDelete = null } = {}) {
  const { pool } = crearPool({ fallarEnDelete });

  const svc = cargarModulo(SVC_PATH, {
    '../config/db': { pool },
    '../config/consentConfig': CONSENT_CONFIG,
    '../middleware/rateLimiter': { getRedisClient: async () => null },
  });

  if (reemplazarDelete) svc.deleteBiometricData = reemplazarDelete;

  const { router, registro } = crearFakeRouter();
  cargarModulo(ROUTE_CONSENT, {
    express: { Router: () => router },
    '../utils/expressAsync': { wrapRouterAsync: () => {} },
    '../middleware/auth': { authMiddleware: (req, res, next) => next() },
    '../services/consentService': svc,
    // consentRoutes.js:11 hace `require('../config/db')`. Sin este stub el sandbox
    // lanzaba «require no soportado» y la ruta /data no llegaba a registrarse, así que
    // C1/C2/C3 fallaban sin llegar a ejercitar el handler.
    '../config/db': { pool },
    '../config/consentConfig': CONSENT_CONFIG,
  });

  return () =>
    invocarHandler(registro, (r) => r.method === 'delete' && r.path === '/data', {
      user: { id: 'user-123' },
      params: {},
      body: {},
    });
}

// Lista estable de aserciones (ids usados por Jest y por el runner estático).
const CHECKS = [
  { id: 'D1', nombre: 'fallo de BD en el borrado → el endpoint biométrico NO responde 2xx' },
  { id: 'D2', nombre: 'fallo de BD en el borrado → el endpoint biométrico responde HTTP 500' },
  { id: 'D3', nombre: 'fallo de BD → la respuesta NO reclama éxito ni «eliminados permanentemente»' },
  { id: 'D4', nombre: 'fallo de BD → la respuesta reporta el error de supresión (campo error)' },
  { id: 'D5', nombre: 'contrato: deleted===false (fail-closed del servicio) → HTTP 500, nunca 200' },
  { id: 'D6', nombre: 'contrato: deleted===0 (forma del stub legado) → HTTP 500, nunca 200' },
  { id: 'D7', nombre: 'contrato: deleteBiometricData que LANZA → HTTP 500, nunca 200' },
  { id: 'D8', nombre: 'contrato: deleted===true con recordsAffected>0 → 200 success:true (sin sobre-bloqueo)' },
  { id: 'C1', nombre: 'endpoint /api/consent/data: fallo de BD → HTTP 500, nunca éxito' },
  { id: 'C2', nombre: 'endpoint /api/consent/data: borrado real → 200 deleted:true records_affected>0' },
  { id: 'C3', nombre: 'endpoint /api/consent/data: deleteBiometricData que LANZA → HTTP 500, nunca éxito' },
  { id: 'S1', nombre: 'biometricConsentRoutes.js guarda con `deleted !== true` antes de responder éxito' },
  { id: 'S2', nombre: 'consentRoutes.js guarda con `deleted !== true` (no truthiness laxa)' },
  { id: 'S3', nombre: 'el guard de 500 en biometricConsentRoutes precede al res.json de éxito' },
];

async function evaluarTodo() {
  const res = new Map();
  const put = (id, ok, detalle = '') => res.set(id, { id, ok: !!ok, detalle });
  const muestra = (r) =>
    r && r.lanzo
      ? `lanzó: ${r.lanzo.message}`
      : `HTTP ${r && r.status} body = ${JSON.stringify(r && r.body)}`;

  // ---------------- 1) PILA REAL + fallo de BD (núcleo del hallazgo) --------
  const invocarFallo = montarEndpointBiometrico({ fallarEnDelete: true });
  let rFallo = null;
  try {
    rFallo = await invocarFallo();
  } catch (e) {
    rFallo = { lanzo: e };
  }
  put('D1', !esExitoFalso(rFallo), muestra(rFallo));
  put('D2', !!rFallo && !rFallo.lanzo && rFallo.status === 500, muestra(rFallo));
  put(
    'D3',
    !!rFallo &&
      !rFallo.lanzo &&
      !!rFallo.body &&
      rFallo.body.success !== true &&
      !(rFallo.body.data && rFallo.body.data.deleted === true) &&
      !(typeof rFallo.body.message === 'string' && /eliminad/i.test(rFallo.body.message)),
    muestra(rFallo)
  );
  put(
    'D4',
    !!rFallo && !rFallo.lanzo && !!rFallo.body && typeof rFallo.body.error === 'string' && rFallo.body.error.length > 0,
    muestra(rFallo)
  );

  // ---------------- 2) CONTRATO HTTP (doble del servicio) -------------------
  const casos = [
    {
      id: 'D5',
      doble: async () => ({ deleted: false, recordsAffected: 0, error: 'DB_ERROR_SIMULADO' }),
      esperado: 500,
    },
    { id: 'D6', doble: async () => ({ deleted: 0, recordsAffected: 0 }), esperado: 500 },
    {
      id: 'D7',
      doble: async () => {
        throw new Error('DB_DOWN');
      },
      esperado: 500,
    },
    { id: 'D8', doble: async () => ({ deleted: true, recordsAffected: 14 }), esperado: 200 },
  ];
  for (const c of casos) {
    let r = null;
    try {
      r = await montarEndpointBiometrico({ reemplazarDelete: c.doble })();
    } catch (e) {
      r = { lanzo: e };
    }
    if (c.esperado === 200) {
      put(
        c.id,
        !!r && !r.lanzo && r.status === 200 && !!r.body && r.body.success === true && r.body.data && r.body.data.deleted === true,
        muestra(r)
      );
    } else {
      put(c.id, !esExitoFalso(r) && !!r && !r.lanzo && r.status === 500, muestra(r));
    }
  }

  // ---------------- 3) Endpoint /api/consent/data --------------------------
  let cFallo = null;
  try {
    cFallo = await montarEndpointConsent({ fallarEnDelete: true })();
  } catch (e) {
    cFallo = { lanzo: e };
  }
  put('C1', !esExitoFalso(cFallo) && !!cFallo && !cFallo.lanzo && cFallo.status === 500, muestra(cFallo));

  let cOk = null;
  try {
    cOk = await montarEndpointConsent({ fallarEnDelete: false })();
  } catch (e) {
    cOk = { lanzo: e };
  }
  const cOkEsperado =
    !!cOk &&
    !cOk.lanzo &&
    cOk.status === 200 &&
    !!cOk.body &&
    cOk.body.deleted === true &&
    typeof cOk.body.records_affected === 'number' &&
    cOk.body.records_affected > 0;
  put('C2', !!cOkEsperado, muestra(cOk));

  // C3: el endpoint /api/consent/data no debe dar éxito si el servicio LANZA.
  let cThrow = null;
  try {
    cThrow = await montarEndpointConsent({
      reemplazarDelete: async () => {
        throw new Error('DB_DOWN');
      },
    })();
  } catch (e) {
    cThrow = { lanzo: e };
  }
  put('C3', !esExitoFalso(cThrow) && !!cThrow && !cThrow.lanzo && cThrow.status === 500, muestra(cThrow));

  // ---------------- 4) Estáticos (contrato en el fuente) -------------------
  const guardBio = /deleted\s*!==\s*true/.test(ROUTE_BIO_SRC);
  put(
    'S1',
    guardBio,
    'biometricConsentRoutes.js ' + (guardBio ? 'contiene' : 'NO contiene') + ' guard `deleted !== true`'
  );

  const guardConsent = /deleted\s*!==\s*true/.test(ROUTE_CONSENT_SRC);
  put(
    'S2',
    guardConsent,
    'consentRoutes.js ' + (guardConsent ? 'contiene' : 'NO contiene') + ' guard `deleted !== true`'
  );

  // El guard de 500 debe estar ANTES del res.json de éxito en el handler /data.
  const inicio = ROUTE_BIO_SRC.indexOf("router.delete('/biometric/:consentType/data'");
  const bloque = inicio >= 0 ? ROUTE_BIO_SRC.slice(inicio) : '';
  const idxGuard = bloque.search(/deleted\s*!==\s*true/);
  const idxGuardMasLaxo = bloque.search(/if\s*\(\s*!result\s*\.\s*deleted\s*\)/);
  const idxExito = bloque.search(/res\s*\.\s*json\s*\(\s*\{[^]*?success\s*:\s*true/);
  put(
    'S3',
    idxGuard > -1 && idxExito > -1 && idxGuard < idxExito && idxGuardMasLaxo === -1,
    `posición guard=${idxGuard} / res.json éxito=${idxExito}`
  );

  return res;
}

// --------------------------------------------------------------------------
// MODO JEST / CI
// --------------------------------------------------------------------------
if (typeof describe === 'function' && typeof test === 'function') {
  describe('t_fix_secapp_05 — la supresión debe fallar en HTTP cuando el borrado falla', () => {
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
    console.log('\n== Verificación t_fix_secapp_05 — N-11: 200 falso en la ruta de supresión ==');
    console.log(`Endpoint biométrico: ${ROUTE_BIO}`);
    console.log(`Endpoint consent:    ${ROUTE_CONSENT}`);
    console.log(`Middleware bajo test: ${MW_PATH}\n`);
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
