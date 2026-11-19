const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '181_productos_peso_kg.sql'),
  'utf8'
);
const orchestrator = fs.readFileSync(
  path.join(__dirname, '..', 'jobs', 'fulfillmentOrchestrator.js'),
  'utf8'
);
const prepareDatabase = fs.readFileSync(
  path.join(__dirname, '..', '..', 'scripts', 'prepareRlsDatabase.js'),
  'utf8'
);

test('la migración agrega el peso opcional sin alterar productos existentes', () => {
  assert.match(migration, /ALTER TABLE productos[\s\S]*ADD COLUMN IF NOT EXISTS peso_kg NUMERIC\(8,3\)/i);
  assert.doesNotMatch(migration, /\bUPDATE\s+productos\b/i);
  assert.doesNotMatch(migration, /\bSET\s+NOT\s+NULL\b/i);
});

test('fulfillment conserva el fallback de 0.5 kg cuando el producto no tiene peso', () => {
  assert.match(orchestrator, /COALESCE\(p\.peso_kg,\s*0\.5\)/i);
});

test('la migración del peso opcional está en las cadenas de base nueva y existente', () => {
  assert.equal((prepareDatabase.match(/'181_productos_peso_kg\.sql'/g) || []).length, 2);
});

test('fulfillment bloquea por pedido y omite si el juego de envíos ya existe', () => {
  assert.match(orchestrator, /pg_advisory_xact_lock\(hashtextextended\(\$1::text, 0\)\)/i);
  assert.match(orchestrator, /SELECT 1 FROM envios WHERE pedido_id = \$1 LIMIT 1/i);
});
