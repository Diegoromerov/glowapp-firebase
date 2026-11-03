#!/usr/bin/env node
'use strict';

/**
 * backend/scripts/checkOpenApiSpec.js
 *
 * Compuerta de deriva del contrato OpenAPI (FIX-FLUTTER-09).
 *
 * Regenera el contrato desde el app real y lo compara con el artefacto
 * versionado. Sale con código != 0 si:
 *   - falta el artefacto                (no hay contrato que verificar)
 *   - la cobertura no es del 100%       (endpoint montado sin contrato)
 *   - hay rutas declaradas que ya no se montan (contrato obsoleto)
 *   - una operación crítica quedó sin contrato explícito
 *   - el artefacto está desincronizado con el código (deriva de API)
 *
 * Es lo que se ejecuta en CI antes de los tests: un cambio de API sin regenerar
 * el contrato pone el pipeline en rojo.
 *
 *   npm run openapi:check
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..');
const specPath = path.join(backendRoot, 'openapi', 'openapi.json');

const app = require(path.join(backendRoot, 'index.js'));
const { buildOpenApiDocument, serializeSpec } = require(path.join(backendRoot, 'src', 'openapi', 'buildOpenApi'));
const { compareSpecToApp } = require(path.join(backendRoot, 'src', 'openapi', 'verifySpecAgainstApp'));
const {
  CRITICAL_OPERATION_KEYS,
  KNOWN_DUPLICATE_OPERATIONS,
} = require(path.join(backendRoot, 'src', 'openapi', 'criticalContract'));

function fail(lines) {
  console.error('❌ CONTRATO OPENAPI — compuerta en rojo');
  lines.forEach((l) => console.error(`   ${l}`));
  console.error('   Regenerar con: (cd backend && npm run openapi:generate)');
  process.exit(1);
}

if (!fs.existsSync(specPath)) {
  fail([`falta el artefacto versionado: ${specPath}`]);
}

const rel = path.relative(backendRoot, specPath).split(path.sep).join('/');
const committedRaw = fs.readFileSync(specPath, 'utf8');
let committed;
try {
  committed = JSON.parse(committedRaw);
} catch (err) {
  fail([`el artefacto ${rel} no es JSON válido: ${err.message}`]);
}

const regeneratedRaw = serializeSpec(buildOpenApiDocument(app));
const report = compareSpecToApp(committed, app, {
  criticalOperations: CRITICAL_OPERATION_KEYS,
  knownDuplicates: KNOWN_DUPLICATE_OPERATIONS,
});

const problems = [];
if (report.missing.length) {
  problems.push(
    `${report.missing.length} operación(es) montada(s) SIN contrato ` +
      `(cobertura ${report.coveragePct}% de ${report.total}):\n     ` +
      report.missing.slice(0, 10).join('\n     ') +
      (report.missing.length > 10 ? `\n     … y ${report.missing.length - 10} más` : '')
  );
}
if (report.orphan.length) {
  problems.push(
    `${report.orphan.length} ruta(s) declarada(s) que YA NO se montan: ` +
      report.orphan.join(', ')
  );
}
if (report.undocumentedCritical.length) {
  problems.push(
    `operación(es) crítica(s) sin contrato explícito: ${report.undocumentedCritical.join(', ')}`
  );
}
if (report.absentCritical.length) {
  problems.push(
    `operación(es) crítica(s) declarada(s) que no existen en el código: ${report.absentCritical.join(', ')}`
  );
}
if (report.newDuplicates.length) {
  problems.push(
    `operación(es) duplicada(s) NUEVA(s) en el enrutamiento: ${report.newDuplicates.join(', ')}`
  );
}
// Tolerante a CRLF: en Windows (core.autocrlf=true) el artefacto puede estar
// en disco con CRLF y la comparacion byte a byte daria un falso rojo.
const toLf = (s) => s.replace(/\r\n/g, '\n');

if (toLf(committedRaw) !== toLf(regeneratedRaw)) {
  problems.push(
    `el artefacto ${rel} está DESINCRONIZADO con el código: la API cambió y el ` +
      'contrato no se regeneró (deriva de API)'
  );
}

if (problems.length) {
  fail(problems);
}

console.log('✅ CONTRATO OPENAPI — compuerta en verde');
console.log(
  `   cobertura: ${report.covered}/${report.total} operaciones montadas bajo /api (${report.coveragePct}%)`
);
console.log(
  `   operaciones críticas con contrato explícito: ${CRITICAL_OPERATION_KEYS.length}`
);
console.log(`   artefacto ${rel} en sincronía con el código`);
process.exit(0);
