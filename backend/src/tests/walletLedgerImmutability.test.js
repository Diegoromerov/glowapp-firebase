// backend/src/tests/walletLedgerImmutability.test.js
//
// Hallazgo P0 (AUD-SEGPAGOS-01 · P0-02): el ledger `wallet_transactions` se
// declara inmutable en la migración 001:
//   "Inmutabilidad: esta tabla NUNCA se actualiza, solo se inserta"
// pero el código de producción emite 6 sentencias UPDATE sobre el ledger
// (paymentRoutes.js:324,409,438 · paymentJobs.js:75 · wompiService.js:107,128),
// destruyendo la trazabilidad financiera (SOX / PCI DSS 10.2).
//
// Estos tests fallan si vuelve a introducirse una mutación del ledger o si
// desaparece la garantía append-only a nivel de base de datos.

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(BACKEND_ROOT, 'src');
const MIGRATIONS_DIR = path.join(BACKEND_ROOT, 'migrations');

// Mutación SQL directa contra el ledger (UPDATE ... wallet_transactions o DELETE FROM wallet_transactions)
const LEDGER_MUTATION = /\b(?:UPDATE|DELETE\s+FROM)\s+wallet_transactions\b/i;

function walkJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walkJs(full));
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

function sqlMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort()
    .map((file) => ({ file, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8') }));
}

describe('Ledger wallet_transactions — inmutabilidad append-only', () => {
  test('ningún módulo de backend/src emite UPDATE/DELETE contra wallet_transactions', () => {
    const offenders = [];
    for (const file of walkJs(SRC_DIR)) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (LEDGER_MUTATION.test(line)) {
          offenders.push(`${path.relative(BACKEND_ROOT, file)}:${i + 1}`);
        }
      });
    }
    // El ledger es write-once: sólo INSERT. Cualquier mutación es una regresión P0.
    expect(offenders).toEqual([]);
  });

  test('existe una migración que instala el trigger append-only sobre wallet_transactions', () => {
    const migracion = sqlMigrations().find(
      ({ sql }) =>
        /CREATE\s+TRIGGER[\s\S]*?ON\s+wallet_transactions/i.test(sql) &&
        /BEFORE\s+UPDATE\s+OR\s+DELETE/i.test(sql)
    );

    expect(migracion).toBeDefined();

    // Debe abortar la operación (no ignorarla silenciosamente).
    expect(migracion.sql).toMatch(/RAISE\s+EXCEPTION/i);
    // Debe cubrir UPDATE y DELETE.
    expect(migracion.sql).toMatch(/UPDATE/i);
    expect(migracion.sql).toMatch(/DELETE/i);
    // Debe ser idempotente (re-ejecutable sin romper).
    expect(migracion.sql).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS/i);
    expect(migracion.sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
  });
});
