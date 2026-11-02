/**
 * smokeSurfaces.js — Guardián de Humo por Superficie (Fase A - Ronda 6)
 * 
 * COMANDO REPRODUCIBLE CASO SANO (base arriba):
 * DB_HOST=127.0.0.1 DATABASE_URL="postgres://admin:admin123@127.0.0.1:5435/beauty_db" NODE_ENV=test npm run smoke:surfaces
 * 
 * NOTA DE INFRAESTRUCTURA (SSL & db.js):
 * `backend/src/config/db.js` compara `DB_HOST` en lugar del host dentro de `DATABASE_URL`
 * para determinar si debe desactivar SSL. Sin `DB_HOST=127.0.0.1`, `getSslConfig` exige SSL
 * por defecto y PostgreSQL rechaza con: "The server does not support SSL connections".
 * 
 * NOTA SOBRE DIAGNÓSTICO DE CONEXIÓN:
 * `testConnection()` devuelve `true` aun sin base de datos real (modo memoria/fallback).
 * La comprobación real de conectividad PostgreSQL debe realizarse mediante `getDbStatus()`.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DEGRADED_ALLOWLIST } = require('../src/middleware/degradedLock');

const REPO_ROOT_BACKEND = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8080;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Extraer rutas del stack Express
let app;
try {
  const envBeforeRequire = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  app = require('../index');
  process.env.NODE_ENV = envBeforeRequire;
} catch (e) {
  console.warn('⚠️ No se pudo requerir app directamente de index.js:', e.message);
}

function cleanRegexpSource(source) {
  if (!source || source === '^\\/' || source === '^\\/\\/?') return '';

  let cleaned = source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)/g, '')
    .replace(/\$\/?$/g, '')
    .replace(/\\\//g, '/')
    .replace(/\?\(\?=\/\|\$\)/g, '')
    .replace(/\?$/g, '');

  if (!cleaned.startsWith('/')) {
    cleaned = '/' + cleaned;
  }
  return cleaned;
}

function extractRoutes(expressApp) {
  const routes = [];

  function print(stack, prefix = '') {
    if (!stack) return;
    
    stack.forEach(layer => {
      if (layer.route) {
        let routePath = layer.route.path;
        if (routePath === '/') routePath = '';
        const fullPath = (prefix + routePath) || '/';
        const methods = Object.keys(layer.route.methods)
          .filter(m => layer.route.methods[m])
          .map(m => m.toUpperCase());

        methods.forEach(method => {
          routes.push({ method, path: fullPath });
        });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        let routePrefix = '';
        if (layer.regexp && layer.regexp.source) {
          routePrefix = cleanRegexpSource(layer.regexp.source);
        }
        print(layer.handle.stack, prefix + routePrefix);
      }
    });
  }

  if (expressApp && expressApp._router && expressApp._router.stack) {
    print(expressApp._router.stack);
  }

  const uniqueMap = new Map();
  routes.forEach(r => {
    const normPath = r.path.replace(/\/+/g, '/');
    const key = `${r.method} ${normPath}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, { method: r.method, path: normPath });
    }
  });

  return Array.from(uniqueMap.values()).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Función pura para decidir la fuente de rutas del guardián de humo.
 */
function decidirRutas({ app: expressApp, inventario }) {
  let liveRoutes = [];
  if (expressApp) {
    liveRoutes = extractRoutes(expressApp);
  }

  if (liveRoutes && liveRoutes.length > 0) {
    return {
      rutas: liveRoutes,
      fuente: 'express_stack',
      exitCode: 0
    };
  }

  const backupRoutes = Array.isArray(inventario) ? inventario : [];
  if (backupRoutes.length > 0) {
    return {
      rutas: backupRoutes,
      fuente: 'inventario',
      exitCode: 1,
      error: 'no se pudo cargar el entry vivo de la app; el inventario NO sustituye la medición'
    };
  }

  return {
    rutas: [],
    fuente: 'ninguna',
    exitCode: 1,
    error: 'no se pudieron obtener rutas para el smoke test'
  };
}

function makeRequest(method, urlPath, headers = {}) {
  return new Promise((resolve) => {
    const url = new URL(urlPath, BASE_URL);
    const req = http.request(url, { method, headers, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          parsed = body;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers || {},
          body: parsed,
          rawBody: body
        });
      });
    });

    req.on('error', (err) => resolve({ error: err.message, status: 0, headers: {} }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'TIMEOUT', status: 0, headers: {} });
    });
    req.end();
  });
}

/**
 * Arranca el proceso servidor real (camino real de entrada) y sondea /api/health
 * hasta que el estado de la base de datos es comprobado (pgAvailable !== null).
 */
async function startRealServerAndAwaitChecked(deps = {}) {
  // Cargo 2 (ronda 7): dependencias inyectables para poder MEDIR el camino del timeout sin depender
  // de la red ni de que un hijo real se cuelgue. Con deps vacío el comportamiento es el de siempre.
  const spawnFn = deps.spawn || spawn;
  const requestFn = deps.makeRequest || makeRequest;
  const exitFn = deps.exit || process.exit;
  const maxWaitMs = deps.maxWaitMs || 15000;
  const cwd = deps.cwd || REPO_ROOT_BACKEND;
  const entry = deps.entry || 'index.js';

  console.log('🚀 Iniciando servidor backend vía proceso hijo real (node index.js)...');
  
  const serverProcess = spawnFn('node', [entry], {
    cwd,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'development'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', (d) => {
    const line = d.toString().trim();
    if (line.includes('✅ Conexión exitosa a PostgreSQL') || line.includes('⚠️ PostgreSQL local no disponible')) {
      console.log(`   [server] ${line}`);
    }
  });

  serverProcess.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line.includes('ERROR') || line.includes('warn') || line.includes('Unhandled')) {
      console.log(`   [server err] ${line}`);
    }
  });

  const startTime = Date.now();
  let healthRes = null;

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, 400));
    healthRes = await requestFn('GET', '/api/health');

    // Esperar hasta que el servidor responda Y la base de datos haya sido comprobada (pgAvailable !== null)
    if (healthRes && healthRes.status > 0 && healthRes.body && healthRes.body.database && healthRes.body.database.pgAvailable !== null) {
      console.log(`✅ Servidor real respondiendo con estado comprobado (pgAvailable: ${healthRes.body.database.pgAvailable}).`);
      break;
    }
  }

  if (!healthRes || healthRes.status === 0 || !healthRes.body || !healthRes.body.database || healthRes.body.database.pgAvailable === null) {
    console.error('❌ TIMEOUT: El servidor real no logró comprobar el estado de la base de datos a tiempo.');
    if (serverProcess && typeof serverProcess.kill === 'function') {
      serverProcess.kill('SIGTERM');
    }
    exitFn(1);
    return { timedOut: true, serverProcess, healthRes };
  }

  return {
    serverProcess,
    healthRes
  };
}

async function runSmoke() {
  console.log('🔥 Ejecutando Smoke Test por Superficie (Fase A - Ronda 6)...');

  const routesFile = path.resolve(__dirname, '../../docs/audit/routes-2026-09-24.json');
  let inventario = null;
  if (fs.existsSync(routesFile)) {
    try {
      inventario = JSON.parse(fs.readFileSync(routesFile, 'utf-8'));
    } catch (e) {
      inventario = null;
    }
  }

  const { rutas: routes, fuente, exitCode, error } = decidirRutas({ app, inventario });

  if (fuente === 'express_stack') {
    console.log(`🔍 Descubiertas dinámicamente ${routes.length} rutas del stack vivo de Express.`);
  } else {
    console.error(`❌ ERROR CRÍTICO EN GUARDIA: ${error}.`);
    if (fuente === 'inventario') {
      console.error(`📄 (Diagnóstico: inventario respaldado contiene ${routes.length} rutas, pero se aborta con exit 1).`);
    }
    process.exit(exitCode);
  }

  const { serverProcess, healthRes: initialHealth } = await startRealServerAndAwaitChecked();

  const stopServer = () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  };

  const safeRoutes = routes.filter(r => ['GET', 'HEAD', 'OPTIONS'].includes(r.method));
  let fakedSuccessCount = 0;
  const results = [];

  const healthRes = await makeRequest('GET', '/api/health');
  const testDbRes = await makeRequest('GET', '/api/test-db');

  const isServerDegraded = 
    healthRes.status === 503 ||
    (healthRes.headers && healthRes.headers['x-glowapp-degraded'] === 'memory-fallback') ||
    (healthRes.body && healthRes.body.status === 'DEGRADED') ||
    (healthRes.body && healthRes.body.database && healthRes.body.database.pgAvailable === false) ||
    (testDbRes.body && testDbRes.body.status === 'error');

  const pgAvailable = healthRes.body?.database?.pgAvailable ?? null;

  console.log(`📊 Estado del servidor detectado (probes inicio): IsDegraded=${isServerDegraded}, HealthStatus=${healthRes.status}, PgAvailable=${pgAvailable}`);

  for (const r of safeRoutes) {
    let testPath = r.path
      .replace(':id', '1')
      .replace(':userId', '1')
      .replace(':code', 'GLW-TEST')
      .replace(/:\w+/g, '1');

    if (testPath.includes('*') || testPath.includes('^')) continue;

    const res = await makeRequest(r.method, testPath);
    const hasDegradedHeader = !!(res.headers && res.headers['x-glowapp-degraded']);
    const cleanPath = testPath.split('?')[0];

    let fakedSuccess = false;

    if (isServerDegraded) {
      if (testPath.startsWith('/api/')) {
        if (DEGRADED_ALLOWLIST.has(cleanPath)) {
          if (res.status >= 200 && res.status < 300) {
            if (cleanPath === '/api/health' && (res.body?.status === 'OK' || !hasDegradedHeader)) {
              fakedSuccess = true;
            } else if (cleanPath === '/api/providers' && res.body?.success === true) {
              fakedSuccess = true;
            } else if (cleanPath === '/api/test-db' && res.body?.status === 'success') {
              fakedSuccess = true;
            }
          }
        } else {
          if (res.status >= 200 && res.status < 300) {
            fakedSuccess = true;
          }
        }
      }
    }

    if (fakedSuccess) {
      fakedSuccessCount++;
      console.error(`❌ FAKED SUCCESS detectado en ${r.method} ${testPath} -> HTTP ${res.status} (respuesta 2xx engañosa en estado degradado)`);
    }

    results.push({
      method: r.method,
      path: testPath,
      status: res.status,
      degraded_header: hasDegradedHeader,
      faked_success: fakedSuccess
    });
  }

  const todayDate = new Date().toISOString().split('T')[0];
  const statusSuffix = isServerDegraded ? 'degraded' : 'ok';
  const reportDir = path.resolve(__dirname, '../../docs/audit');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportFile = path.join(reportDir, `smoke-${todayDate}-${statusSuffix}.json`);

  const reportData = {
    timestamp: new Date().toISOString(),
    routes_source: fuente,
    server_degraded: isServerDegraded,
    health_status: healthRes.status,
    pg_available: pgAvailable,
    total_surfaces_tested: results.length,
    faked_success_count: fakedSuccessCount,
    results: results
  };

  fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2), 'utf-8');
  console.log(`📄 Informe de auditoría guardado en: ${reportFile}`);

  console.log(`\n📋 Resumen de Smoke Test (${results.length} superficies probadas):`);
  console.log(`- Faked Success Totales: ${fakedSuccessCount}`);

  stopServer();

  if (fakedSuccessCount > 0) {
    console.error('❌ SMOKE TEST FALLIDO: Se detectaron respuestas de éxito falso (faked_success).');
    process.exit(1);
  } else {
    console.log('✅ SMOKE TEST EXITOSO: Ninguna superficie fingió éxito.');
    process.exit(0);
  }
}

if (require.main === module) {
  runSmoke();
} else {
  module.exports = { decidirRutas, extractRoutes, runSmoke, startRealServerAndAwaitChecked };
}
