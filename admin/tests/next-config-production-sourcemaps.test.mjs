#!/usr/bin/env node
/**
 * TEST — tarjeta t_fix_flutter_05 (P1)
 * «admin-dashboard/next.config.ts:1-9 — sin `productionBrowserSourceMaps: false`
 *  ni config webpack para ocultar source maps en producción».
 *
 * QUÉ VERIFICA (test-first, reproducible sin `node_modules`)
 *   [0] La superficie de config existe y no hay copia que la shadowee.
 *   [1] Declaración EXPLÍCITA   `productionBrowserSourceMaps: false`   (estático, CRLF-safe).
 *   [2] El config REALMENTE exportado por el módulo tiene esa propiedad (carga
 *       dinámica de `next.config.ts` con type-stripping de Node >= 22.6).
 *   [3] Ningún override (`webpack`) re-habilita la emisión de source maps en
 *       el build de producción (cliente).
 *   [4] Invariante derivada: el build de producción NO puede emitir source maps
 *       de navegador, y `public/` no publica ningún `.map`.
 *
 * POR QUÉ EXISTE (y no jest/webpack real)
 *   El worktree no tiene `node_modules` y el mandato de la tarjeta prohíbe
 *   `npm install`/`npm ci`, así que `next build` no puede ejecutarse aquí.
 *   Este archivo reproduce, sin dependencias ni red, las invariantes que un
 *   `next build` respeta para el bundle de navegador. NO sustituye a una
 *   compilación real (nivel de evidencia E1).
 *
 * Uso:  node admin-dashboard/tests/next-config-production-sourcemaps.test.mjs [worktree-o-admin-dashboard]
 *       (sin argumento: deduce la raíz subiendo desde este archivo)
 * Salida: una línea por aserción (PASS/FAIL) + resumen; exit 1 si algo falla.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// Localización de la raíz del worktree
// ─────────────────────────────────────────────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url)); // .../admin-dashboard/tests
function resolverAdminDashboard(arg) {
  if (arg) {
    const abs = path.resolve(arg);
    return path.basename(abs) === 'admin-dashboard' ? abs : path.join(abs, 'admin-dashboard');
  }
  return path.dirname(HERE); // .../admin-dashboard
}
const ADMIN = resolverAdminDashboard(process.argv[2]);
const WT = path.dirname(ADMIN);

const CONFIG_TS = path.join(ADMIN, 'next.config.ts');
const SHADOWS = ['next.config.js', 'next.config.mjs', 'next.config.cjs'].map((f) => path.join(ADMIN, f));
const PUBLIC = path.join(ADMIN, 'public');

let pass = 0;
let fail = 0;
let skip = 0;
const fallos = [];

function ok(nombre, cond) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${nombre}`);
  } else {
    fail++;
    fallos.push(nombre);
    console.log(`  FAIL  ${nombre}`);
  }
}
function salta(nombre, motivo) {
  skip++;
  console.log(`  SKIP  ${nombre} — ${motivo}`);
}
function leer(p) {
  try {
    return fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
  } catch {
    return null;
  }
}

console.log('\n== Test t_fix_flutter_05 — source maps en producción (admin-dashboard) ==');
console.log(`Worktree: ${WT}`);
console.log(`Node: ${process.version}\n`);

// ─────────────────────────────────────────────────────────────────────────────
// [0] Superficie de configuración
// ─────────────────────────────────────────────────────────────────────────────
console.log('[0] Superficie de configuración de Next.js');
const configSrc = leer(CONFIG_TS);
ok('admin-dashboard/next.config.ts existe', configSrc !== null);
ok('admin-dashboard/next.config.ts no está vacío', !!configSrc && configSrc.trim().length > 0);
for (const s of SHADOWS) {
  ok(`no existe ${path.basename(s)} (no shadowea next.config.ts)`, !fs.existsSync(s));
}

// ─────────────────────────────────────────────────────────────────────────────
// [1] Declaración explícita (estático)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] Declaración explícita en el fuente');
if (configSrc) {
  ok(
    'next.config.ts declara `productionBrowserSourceMaps: false`',
    /productionBrowserSourceMaps\s*:\s*false\b/.test(configSrc)
  );
  ok(
    'no hay ningún `productionBrowserSourceMaps: true`',
    !/productionBrowserSourceMaps\s*:\s*true\b/.test(configSrc)
  );
  ok(
    'no hay toggle condicional que pueda habilitar los source maps (env / negación)',
    !/productionBrowserSourceMaps\s*:\s*(process\.env|!|\()/.test(configSrc)
  );
} else {
  ok('next.config.ts declara `productionBrowserSourceMaps: false`', false);
  ok('no hay ningún `productionBrowserSourceMaps: true`', false);
  ok('no hay toggle condicional que pueda habilitar los source maps (env / negación)', false);
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] Carga real del módulo (funcional, no regex)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] Config REALMENTE exportado por el módulo');
let config = null;
let importError = null;
try {
  const mod = await import(pathToFileURL(CONFIG_TS).href);
  config = mod.default ?? mod;
} catch (e) {
  importError = e;
}
const sinTypeStripping = importError && /Unknown file extension|strip-types|ERR_UNSUPPORTED_|Cannot use import statement|Cannot find module|ERR_MODULE_NOT_FOUND/i.test(importError.message);
if (importError) {
  if (sinTypeStripping) {
    salta('carga dinámica de next.config.ts', `runtime sin type-stripping (${importError.code || 'error'}); usar Node >= 22.6`);
    salta('productionBrowserSourceMaps es exactamente `false` (boolean)', 'carga no disponible');
  } else {
    ok('el módulo next.config.ts se carga sin errores', false);
    ok('productionBrowserSourceMaps es exactamente `false` (boolean)', false);
  }
} else {
  ok('el módulo next.config.ts se carga sin errores', true);
  ok(
    'productionBrowserSourceMaps es exactamente `false` (boolean)',
    config !== null && typeof config === 'object' && config.productionBrowserSourceMaps === false
  );
  ok(
    'el resto de la config se conserva: eslint.ignoreDuringBuilds === true',
    config !== null && typeof config === 'object' && config.eslint && config.eslint.ignoreDuringBuilds === true
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] Ningún override `webpack` re-habilita los source maps en producción
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] Override `webpack` (cliente, producción)');
let webpackForzaSinMapas = false;
if (config && typeof config.webpack === 'function') {
  let devtool = null;
  try {
    const res = config.webpack(
      { devtool: undefined, mode: 'production' },
      { dev: false, isServer: false, buildId: 'test', nextRuntime: undefined, defaultLoaders: {}, webpack: () => {} }
    );
    devtool = res && res.devtool;
  } catch (e) {
    devtool = `ERROR:${e.message}`;
  }
  ok('la webpack config de producción no emite source maps (devtool vacío/false)', !devtool || devtool === 'false');
  webpackForzaSinMapas = !devtool || devtool === 'false';
} else {
  ok('no hay override `webpack` que pueda re-habilitar source maps', true);
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] Invariante derivada + assets publicados
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] Invariante: el build de producción NO emite source maps de navegador');
const declaradoExplicito = !!(configSrc && /productionBrowserSourceMaps\s*:\s*false\b/.test(configSrc));
const apagadoEnObjeto = !!(config && config.productionBrowserSourceMaps === false) || (declaradoExplicito && sinTypeStripping);
ok(
  'apagado por declaración explícita o por webpack (no por confianza en el default implícito)',
  declaradoExplicito || webpackForzaSinMapas
);
ok(
  'el objeto de config efectivo apaga los source maps de navegador',
  apagadoEnObjeto || webpackForzaSinMapas
);
const maps = fs.existsSync(PUBLIC)
  ? (function walk(dir, acc) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, acc);
        else if (e.name.endsWith('.map')) acc.push(p);
      }
      return acc;
    })(PUBLIC, [])
  : [];
ok(`public/ no publica ningún archivo .map (encontrados: ${maps.length})`, maps.length === 0);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n== RESULTADO: ${pass} PASS / ${fail} FAIL / ${skip} SKIP ==`);
if (fail > 0) {
  console.log('Fallos:');
  fallos.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
process.exit(0);
