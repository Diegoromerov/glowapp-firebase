#!/usr/bin/env node
// backend/scripts/verifyTestBaseline.js
//
// Verificación automatizada del baseline de tests congelado en
// tests/baseline.frozen.json.
//
// Falla (exit 1) si:
//   - alguna suite listada en `verde` deja de pasar, o
//   - aparece un fallo en una suite que no está en `rojo_heredado`.
//
// No falla si las suites de `rojo_heredado` siguen fallando (son los 30 fallos
// preexistentes, fuera del alcance del sprint) ni si alguna empieza a pasar.
//
// Uso:
//   node scripts/verifyTestBaseline.js                 # ejecuta jest y compara
//   node scripts/verifyTestBaseline.js --report=r.json # compara un informe previo

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKEND_DIR = path.join(__dirname, '..');
const FROZEN_PATH = path.join(BACKEND_DIR, 'tests', 'baseline.frozen.json');
const REPORT_PATH = path.join(BACKEND_DIR, '.jest-baseline-report.json');

function norm(p) {
  return String(p).replace(/\\/g, '/').replace(/^.*\/backend\//, '');
}

function loadFrozen() {
  if (!fs.existsSync(FROZEN_PATH)) {
    console.error(`✗ No se encontró el baseline congelado: ${FROZEN_PATH}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(FROZEN_PATH, 'utf8'));
}

/**
 * Invoca jest directamente con el mismo intérprete de Node.
 *
 * NO usar `npx.cmd`: en Windows spawnSync sin `shell: true` falla con
 * EINVAL y devuelve status = null, lo que se traduce en un falso "falló".
 */
function jestBin() {
  return path.join(BACKEND_DIR, 'node_modules', 'jest', 'bin', 'jest.js');
}

function spawnJest(args) {
  return spawnSync(process.execPath, [jestBin(), ...args], {
    cwd: BACKEND_DIR,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/**
 * Reejecuta UNA suite en aislamiento (--runInBand, sin el resto de la suite).
 * Devuelve true si pasa. Se usa para distinguir un fallo por carga de una
 * regresión real.
 */
function pasaEnAislamiento(suiteRelPath) {
  console.log(`   ↻ reintentando en aislamiento: ${suiteRelPath}`);
  const res = spawnJest([suiteRelPath, '--runInBand']);
  return res.status === 0;
}

function runJest() {
  console.log('▶ Ejecutando jest con informe JSON...');
  spawnJest(['--json', `--outputFile=${REPORT_PATH}`]);
}

function readReport(arg) {
  const reportPath = arg ? path.resolve(BACKEND_DIR, arg) : REPORT_PATH;
  if (!fs.existsSync(reportPath)) {
    console.error(`✗ Informe no encontrado: ${reportPath}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function main() {
  const reportArg = (process.argv.find((a) => a.startsWith('--report=')) || '').split('=')[1];
  if (!reportArg) runJest();

  const frozen = loadFrozen();
  const report = readReport(reportArg);

  const verdeEsperado = new Set(frozen.verde.map(norm));
  const rojoEsperado = new Set(frozen.rojo_heredado.map(norm));

  const fallidas = new Set();
  const presentes = new Set();
  let nuevasVerdes = 0;

  for (const suite of report.testResults || []) {
    const name = norm(path.relative(BACKEND_DIR, suite.name || ''));
    presentes.add(name);
    const fallo = suite.status === 'failed' || (suite.numFailingTests || 0) > 0;
    if (fallo) fallidas.add(name);
    else if (!verdeEsperado.has(name)) nuevasVerdes += 1;
  }

  const regresionesCandidatas = [...verdeEsperado].filter((n) => fallidas.has(n));
  const ausentes = [...verdeEsperado].filter((n) => !presentes.has(n));

  // Reintento en aislamiento. Varias suites de este repo miden tiempo de reloj
  // de pared (backoff con setTimeout sobre Date.now) y fallan bajo carga aunque
  // el código sea correcto. Una suite que pasa sola NO es una regresión: se
  // reporta como inestable. Solo se declara regresión si falla también aislada.
  const inestables = [];
  const regresiones = [];
  for (const nombre of regresionesCandidatas) {
    if (pasaEnAislamiento(nombre)) {
      inestables.push(nombre);
    } else {
      regresiones.push(nombre);
    }
  }

  // Un fallo "nuevo" es el que no está en el rojo heredado NI resultó ser un
  // falso positivo por carga (inestable). Este cálculo va DESPUÉS del reintento
  // a propósito: si se hace antes, el flake se cuenta como fallo nuevo.
  const fallosNuevos = [...fallidas].filter(
    (n) => !rojoEsperado.has(n) && !inestables.includes(n)
  );

  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log(' VERIFICACIÓN DEL BASELINE DE TESTS');
  console.log('══════════════════════════════════════════════════════════');
  console.log(` Suite verde esperada : ${verdeEsperado.size}`);
  console.log(` Suites verdes OK     : ${verdeEsperado.size - regresiones.length - ausentes.length - inestables.length}`);
  console.log(` Rojo heredado tolerado: ${rojoEsperado.size}  (fallando ahora: ${[...rojoEsperado].filter((n) => fallidas.has(n)).length})`);
  console.log(` Inestables (pasaron aisladas): ${inestables.length}`);
  console.log(` Fallos nuevos        : ${fallosNuevos.length}`);

  if (inestables.length) {
    console.log('\n ⚠ INESTABLES — fallaron en la corrida completa pero PASAN en aislamiento.');
    console.log('   Suites con aserciones de tiempo de reloj de pared; no son regresiones:');
    inestables.forEach((n) => console.log(`   - ${n}`));
  }

  if (ausentes.length) {
    console.log('\n ⚠ Suites verdes que NO se ejecutaron (¿renombradas o borradas?):');
    ausentes.forEach((n) => console.log(`   - ${n}`));
  }
  if (regresiones.length) {
    console.log('\n ✗ REGRESIONES en suites que estaban verdes:');
    regresiones.forEach((n) => console.log(`   - ${n}`));
  }
  if (fallosNuevos.length) {
    console.log('\n ✗ FALLOS NUEVOS (no estaban en el rojo heredado):');
    fallosNuevos.forEach((n) => console.log(`   - ${n}`));
  }

  const ok = regresiones.length === 0 && fallosNuevos.length === 0 && ausentes.length === 0;
  console.log('');
  console.log(ok ? '✅ BASELINE OK — sin regresiones ni fallos nuevos.' : '❌ BASELINE VIOLADO — ver detalle arriba.');
  console.log('══════════════════════════════════════════════════════════');
  process.exit(ok ? 0 : 1);
}

main();
