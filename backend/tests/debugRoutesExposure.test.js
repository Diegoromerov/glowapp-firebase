'use strict';
// backend/tests/debugRoutesExposure.test.js
/**
 * TEST de la tarjeta t_fix_secapp_03 — P0 «Debug endpoints expuestos non-prod
 * sin auth» (FASE C · AUD-SECAPP-03, backend/index.js:370).
 *
 * QUÉ REPRODUCE
 *   El guard de las rutas de diagnóstico (`/api/test-db`, `/api/debug-db`) era
 *   fail-OPEN:
 *
 *     const allowDebugRoutes =
 *       process.env.ALLOW_DEBUG_ROUTES === 'true' ||
 *       process.env.NODE_ENV !== 'production';
 *
 *   Es decir, CUALQUIER entorno en el que `NODE_ENV` NO fuese exactamente el
 *   literal 'production' (incluye `NODE_ENV` ausente, el error de configuración
 *   más común en un despliegue) servía `/api/test-db` y `/api/debug-db` SIN
 *   autenticación. Además, `ALLOW_DEBUG_ROUTES='true'` abría las rutas incluso
 *   en producción.
 *
 * CÓMO PRUEBA (sin `node_modules`, sin red, sin BD)
 *   Extrae el BLOQUE REAL del guard desde `backend/index.js` y lo EJECUTA en un
 *   sandbox `vm` con stubs de `authMiddleware`/`adminMiddleware`, de modo que se
 *   observa el comportamiento del código real (no una reimplementación).
 *   - ROJO  antes del fix: NODE_ENV ausente / development, y prod+flag, quedan
 *     ABIERTOS (traza `[next]`, sin `auth`).
 *   - VERDE tras el fix: todas las configuraciones exigen auth+admin salvo el
 *     opt-in explícito `ALLOW_DEBUG_ROUTES=true` FUERA de producción.
 *
 * MODO DOBLE: bajo Jest registra casos `test()`; con `node debugRoutesExposure.test.js`
 * ejecuta las mismas aserciones y fija `process.exitCode`. Sin dependencias.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX_PATH = path.join(__dirname, '..', 'index.js');
const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

/** Extrae el bloque real `allowDebugRoutes` + `debugRouteMiddleware` del índice. */
function extraerBloque(src) {
  const ini = src.indexOf('const allowDebugRoutes');
  const fin = src.indexOf('const { rateLimitByIP }');
  if (ini === -1 || fin === -1 || fin <= ini) return null;
  return src.slice(ini, fin).trim();
}

const BLOQUE = extraerBloque(SRC);

/** Ejecuta el middleware REAL en un sandbox vm con stubs de auth/admin. */
function ejecutarMiddleware(env) {
  const trace = [];
  const sandbox = {
    process: { env },
    authMiddleware: (req, res, next) => {
      trace.push('auth');
      return next();
    },
    adminMiddleware: (req, res, next) => {
      trace.push('admin');
      return next();
    },
    console,
  };
  vm.createContext(sandbox);
  const mw = vm.runInContext(BLOQUE + '\n; debugRouteMiddleware;', sandbox);
  return { mw, trace };
}

/** Devuelve la traza de decisión del guard para un entorno dado. */
function correConEnv(env) {
  const { mw, trace } = ejecutarMiddleware(env);
  mw({ ip: '203.0.113.7', headers: {} }, {}, () => trace.push('next'));
  return trace;
}

function exigeAuthYAdmin(trace) {
  // Protegido = pasó por auth Y por admin (el `next` final es el handler real).
  // Abierto (fail-open) = solo [next], sin 'auth'.
  return trace.includes('auth') && trace.includes('admin');
}

// Rutas de diagnóstico declaradas en el índice (deben TODAS pasar por el guard).
const RUTAS_DEBUG = SRC.split(/\r?\n/).filter((l) =>
  /app\.(get|post|put|patch|delete)\(\s*['"`][^'"`]*(debug|test-db)/i.test(l)
);

// Contrato fail-closed del guard (comportamiento observable del código real).
const CASOS = [
  {
    nombre: 'NODE_ENV ausente (undefined) -> EXIGE auth+admin',
    env: {},
    exigeAuth: true,
  },
  {
    nombre: 'NODE_ENV=production -> EXIGE auth+admin',
    env: { NODE_ENV: 'production' },
    exigeAuth: true,
  },
  {
    nombre: 'NODE_ENV=production + ALLOW_DEBUG_ROUTES=true -> prod NUNCA se abre',
    env: { NODE_ENV: 'production', ALLOW_DEBUG_ROUTES: 'true' },
    exigeAuth: true,
  },
  {
    nombre: 'NODE_ENV=development sin flag -> EXIGE auth+admin (fail-closed)',
    env: { NODE_ENV: 'development' },
    exigeAuth: true,
  },
  {
    nombre: 'NODE_ENV=development + ALLOW_DEBUG_ROUTES=true -> bypass SOLO con opt-in explícito',
    env: { NODE_ENV: 'development', ALLOW_DEBUG_ROUTES: 'true' },
    exigeAuth: false,
  },
];

function evaluarTodo() {
  const resultados = [];
  const fallos = [];
  function check(nombre, cond) {
    resultados.push({ nombre, ok: !!cond });
    if (!cond) fallos.push(nombre);
  }

  check(
    'el bloque del guard es extraíble de backend/index.js',
    BLOQUE !== null && BLOQUE.length > 0
  );
  check(
    'las rutas de diagnóstico (/api/test-db, /api/debug-db) pasan por debugRouteMiddleware',
    RUTAS_DEBUG.length >= 2 && RUTAS_DEBUG.every((l) => /debugRouteMiddleware/.test(l))
  );

  for (const c of CASOS) {
    const trace = correConEnv(c.env);
    const desc = `${c.nombre} -> [${trace.join(',') || 'sin decisión'}]`;
    if (c.exigeAuth) {
      check(desc, exigeAuthYAdmin(trace));
    } else {
      check(desc, trace.includes('next') && !trace.includes('auth'));
    }
  }

  return { resultados, fallos };
}

if (typeof describe === 'function' && typeof test === 'function') {
  // ------------------------------------------------------------------ Jest / CI
  describe('t_fix_secapp_03 — debug endpoints NO expuestos sin auth (fail-closed)', () => {
    const { resultados } = evaluarTodo();
    for (const r of resultados) {
      test(r.nombre, () => {
        expect(r.ok).toBe(true);
      });
    }
  });
} else {
  // -------------------------------------------------------- runner estático E1
  const { resultados, fallos } = evaluarTodo();
  console.log('\n== Verificación t_fix_secapp_03 — debug endpoints (fail-closed) ==');
  console.log(`Archivo bajo test: ${INDEX_PATH}\n`);
  for (const r of resultados) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.nombre}`);
  }
  console.log(
    `\n== RESULTADO: ${resultados.length - fallos.length} PASS / ${fallos.length} FAIL ==`
  );
  if (fallos.length) {
    console.log('Fallos:');
    for (const f of fallos) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}
