#!/usr/bin/env node
'use strict';

/**
 * backend/scripts/generateOpenApiSpec.js
 *
 * Regenera el contrato OpenAPI versionado (backend/openapi/openapi.json) a partir
 * del app Express real.
 *
 *   npm run openapi:generate
 *
 * NODE_ENV=test antes de requerir index.js para que el servidor no abra puerto
 * ni inicialice jobs (index.js solo hace listen cuando NODE_ENV !== 'test').
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..');
const outputPath = path.join(backendRoot, 'openapi', 'openapi.json');

const app = require(path.join(backendRoot, 'index.js'));
const { buildOpenApiDocument, serializeSpec } = require(path.join(backendRoot, 'src', 'openapi', 'buildOpenApi'));

const document = buildOpenApiDocument(app);
const serialized = serializeSpec(document);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const previous = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
fs.writeFileSync(outputPath, serialized, 'utf8');

const contract = document['x-glowapp-contract'];
const rel = path.relative(backendRoot, outputPath).split(path.sep).join('/');
console.log(`✅ Contrato OpenAPI escrito en ${rel}`);
console.log(
  `   rutas montadas: ${contract.routesMounted} · ` +
    `con contrato explícito: ${contract.operationsDocumented} · ` +
    `stubs autodescubiertos: ${contract.operationsDiscovered}`
);
console.log(`   rutas en paths: ${Object.keys(document.paths).length}`);
if (previous !== null && previous !== serialized) {
  console.log('   ⚠️  el artefacto cambió respecto al anterior (revisar el diff antes de commitear)');
}
process.exit(0);
