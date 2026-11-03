// backend/tests/tenantMoneyTablesRls.test.js
//
// TEST-FIRST (FASE C — P0 TENANT #5)
// ----------------------------------
// Hallazgo de auditoría: las 4 tablas de DINERO
//   provider_wallet, wallet_transactions, retiros, disputas
// quedaban FUERA del aislamiento multi-tenant porque la migración 068 las
// declaraba "externas" (DDL supuestamente ausente del repositorio) y, si no
// tenían tenant_id, las SALTABA en silencio (RAISE NOTICE + CONTINUE).
//
// Esa premisa es falsa: su DDL SÍ vive en el repositorio
// (backend/migrations/001_payment_system.sql) y 065 ya les añade tenant_id.
// Una tabla de dinero sin tenant_id y sin política RLS es una fuga entre
// inquilinos y una violación de integridad de datos.
//
// Este test es el detector de regresión de ese contrato: falla si alguien
// vuelve a (a) eximir a estas tablas del aislamiento, (b) dejar de garantizar
// su tenant_id dentro de 068, o (c) quitar la política estricta + FORCE.

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const PATH_068 = path.join(MIGRATIONS_DIR, '068_force_rls_strict_isolation.sql');
const sql068 = fs.readFileSync(PATH_068, 'utf8');

const TABLAS_DINERO = ['provider_wallet', 'wallet_transactions', 'retiros', 'disputas'];

/** Extrae los literales de un arreglo `nombre text[] := ARRAY[ 'a', 'b' ];`. */
function extraerArreglo(nombre) {
  const decl = new RegExp(`${nombre}\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]`, 'i');
  const match = sql068.match(decl);
  if (!match) throw new Error(`No se encontró la declaración del arreglo "${nombre}" en 068.`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('068 — aislamiento estricto de las 4 tablas de dinero (P0 TENANT #5)', () => {
  test('las tablas de dinero NO están eximidas del aislamiento (arreglo "externas")', () => {
    const externas = extraerArreglo('externas');
    const eximidas = TABLAS_DINERO.filter((t) => externas.includes(t));
    expect(eximidas).toEqual([]);
  });

  test('las 4 tablas de dinero sí están en el arreglo "tablas" (reciben política + trigger + FORCE)', () => {
    const tablas = extraerArreglo('tablas');
    const faltantes = TABLAS_DINERO.filter((t) => !tablas.includes(t));
    expect(faltantes).toEqual([]);
  });

  test('068 garantiza tenant_id por sí misma en cada tabla de dinero (no depende de 065)', () => {
    const asegura = new Set(
      [...sql068.matchAll(/ALTER\s+TABLE\s+IF\s+EXISTS\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+tenant_id/gi)]
        .map((m) => m[1].toLowerCase())
    );
    const sinGarantia = TABLAS_DINERO.filter((t) => !asegura.has(t));
    expect(sinGarantia).toEqual([]);
  });

  test('068 crea UNA política estricta FOR ALL con USING y WITH CHECK', () => {
    expect(sql068).toMatch(/CREATE\s+POLICY\s+\w+\s+ON\s+public\.%I\s+FOR\s+ALL/i);
    expect(sql068).toMatch(/USING\s*\(\s*tenant_id\s+IS\s+NOT\s+NULL/i);
    expect(sql068).toMatch(/WITH\s+CHECK\s*\(\s*tenant_id\s+IS\s+NOT\s+NULL/i);
  });

  test('068 habilita Y fuerza Row Level Security (FORCE obliga al propietario)', () => {
    expect(sql068).toMatch(/ALTER\s+TABLE\s+public\.%I\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql068).toMatch(/ALTER\s+TABLE\s+public\.%I\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});
