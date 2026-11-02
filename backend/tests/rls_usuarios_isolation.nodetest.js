// backend/tests/rls_usuarios_isolation.nodetest.js
//
// Regresión estática del hallazgo P0 t_fix_tenant_07 (tenant #7):
// `usuarios` estaba EXCLUIDA de RLS (migración 068 ejecutaba
// `ALTER TABLE public.usuarios DISABLE ROW LEVEL SECURITY`), así que CUALQUIER
// inquilino —o una conexión sin contexto— leía la PII de TODOS los usuarios.
//
// Sin dependencias (node:test + node:assert) para poder ejecutarse aunque no
// haya node_modules: sólo inspecciona el texto de las migraciones y del código
// de arranque de identidad, que es donde vive la regresión.
//
// Ejecutar:  node --test backend/tests/rls_usuarios_isolation.nodetest.js
//
// Debe fallar (ROJO) contra la versión base, que desactivaba RLS en `usuarios`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BACKEND = path.join(__dirname, '..');
const MIGRACION_068 = path.join(BACKEND, 'migrations', '068_force_rls_strict_isolation.sql');
const AUTH_JS = path.join(BACKEND, 'src', 'middleware', 'auth.js');
const VERIFY_JS = path.join(BACKEND, 'scripts', 'verifyTenantIsolation.js');
const PREPARE_JS = path.join(BACKEND, 'scripts', 'prepareRlsDatabase.js');

const leer = (p) => fs.readFileSync(p, 'utf8');
const sql068 = leer(MIGRACION_068);
const authJs = leer(AUTH_JS);
const verifyJs = leer(VERIFY_JS);
const prepareJs = leer(PREPARE_JS);

// ── 1. La migración NO puede desactivar RLS en `usuarios` ──────────────────
test('068 no desactiva RLS en usuarios (el agujero original)', () => {
  assert.ok(
    !/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql068),
    '068 no debe contener "DISABLE ROW LEVEL SECURITY" en ninguna tabla: ' +
    'era lo que exponía la PII de `usuarios`.'
  );
});

// ── 2. `usuarios` queda con RLS + FORCE activos ────────────────────────────
test('068 habilita RLS en usuarios', () => {
  assert.match(
    sql068,
    /ALTER\s+TABLE\s+public\.usuarios\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    'usuarios debe quedar con ENABLE ROW LEVEL SECURITY.'
  );
});

test('068 FUERZA RLS en usuarios (el propietario deja de estar exento)', () => {
  assert.match(
    sql068,
    /ALTER\s+TABLE\s+public\.usuarios\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i,
    'usuarios debe quedar con FORCE ROW LEVEL SECURITY: sin FORCE el rol ' +
    'propietario salta las políticas y la fuga persiste.'
  );
});

// ── 3. UNA sola política estricta, con USING y WITH CHECK ──────────────────
test('068 crea la política usuarios_isolation con USING y WITH CHECK', () => {
  assert.match(
    sql068,
    /CREATE\s+POLICY\s+usuarios_isolation\s+ON\s+public\.usuarios\s+FOR\s+ALL/i,
    'Debe existir la política `usuarios_isolation`.'
  );
  // Aísla el bloque de la política para comprobar sus dos predicados.
  const bloque = sql068.slice(sql068.indexOf('usuarios_isolation'));
  const fin = bloque.indexOf('$pol$');
  const pol = bloque.slice(0, fin === -1 ? 2000 : fin);
  assert.match(pol, /\bUSING\s*\(/i, 'La política debe declarar USING.');
  assert.match(pol, /WITH\s+CHECK\s*\(/i, 'La política debe declarar WITH CHECK (cubre escritura).');
  assert.match(pol, /app_current_user_id\s*\(/i, 'La política debe reconocer la propia fila (app_current_user_id).');
  assert.match(pol, /app_current_tenant_id\s*\(/i, 'La política debe acotar por inquilino (app_current_tenant_id).');
});

// ── 4. Falla CERRADO: sin contexto no debe lanzar error, sino dar 0 filas ──
test('app_current_user_id usa current_setting con missing_ok (no lanza error)', () => {
  assert.match(
    sql068,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app_current_user_id\s*\(\s*\)\s+RETURNS\s+integer/i,
    'Debe definirse app_current_user_id().'
  );
  assert.match(
    sql068,
    /current_setting\s*\(\s*'app\.user_id'\s*,\s*true\s*\)/i,
    "app_current_user_id debe usar current_setting('app.user_id', true): " +
    'el `true` (missing_ok) es lo que evita el error y devuelve NULL -> 0 filas.'
  );
});

// ── 5. Arranque de identidad por funciones SECURITY DEFINER (explícito) ────
test('068 define las funciones SECURITY DEFINER del arranque de identidad', () => {
  for (const fn of ['app_usuario_identidad', 'app_usuario_por_id', 'app_usuario_por_email']) {
    assert.match(
      sql068,
      new RegExp(`FUNCTION\\s+${fn}\\s*\\(`, 'i'),
      `Debe definirse la función ${fn} para leer identidad sin contexto.`
    );
  }
  const definiciones = sql068.match(/SECURITY\s+DEFINER/gi) || [];
  assert.ok(
    definiciones.length >= 3,
    'Las funciones de arranque de identidad deben ser SECURITY DEFINER para ' +
    'atravesar RLS de forma deliberada y auditable.'
  );
});

// ── 6. auth.js consume la vía explícita, no acceso directo sin contexto ────
test('auth.js resuelve la identidad con app_usuario_identidad()', () => {
  assert.match(
    authJs,
    /app_usuario_identidad\s*\(/,
    'auth.js debe consultar app_usuario_identidad($1) en vez de leer usuarios ' +
    'directamente: con RLS+FORCE una lectura sin contexto daría 0 filas -> 401.'
  );
  assert.ok(
    !/FROM\s+usuarios\s+WHERE\s+id\s*=\s*\$1/i.test(authJs),
    'auth.js no debe leer usuarios por id directamente (fuga / 401 global).'
  );
});

// ── 7. La verificación de aislamiento cubre a `usuarios` y su PII ──────────
test('verifyTenantIsolation.js exige RLS+FORCE+1 política en usuarios', () => {
  const bloque = verifyJs.slice(
    verifyJs.indexOf('TABLAS_ESPERADAS'),
    verifyJs.indexOf('];', verifyJs.indexOf('TABLAS_ESPERADAS'))
  );
  assert.match(bloque, /'usuarios'/, '`usuarios` debe estar en TABLAS_ESPERADAS.');
});

test('verifyTenantIsolation.js prueba que un inquilino NO ve la PII de otro', () => {
  assert.match(
    verifyJs,
    /pii-t2@verif\.test/,
    'El verificador debe sembrar PII de dos inquilinos y comprobar la fuga cross-tenant.'
  );
  assert.match(
    verifyJs,
    /app_usuario_identidad\s*\(/,
    'El verificador debe comprobar que el arranque de identidad funciona sin contexto.'
  );
});

// ── 8. prepareRlsDatabase.js ya no exime a usuarios de FORCE ───────────────
test('prepareRlsDatabase.js no exime a usuarios de FORCE', () => {
  assert.match(
    prepareJs,
    /EXENTAS_DE_FORCE\s*=\s*\[\s*\]/,
    'Ninguna tabla con tenant_id puede quedar sin FORCE: la lista de exentas debe estar vacía.'
  );
});
