#!/usr/bin/env node
/**
 * backend/scripts/verifyTenantIsolation.js
 *
 * Comprueba, contra una base de datos REAL, que el aislamiento multi-tenant de
 * la migración 068 está efectivamente en vigor. No es una inspección de código:
 * ejecuta consultas y exige el resultado del aislamiento.
 *
 * Es el detector de mutación de la Ola 2. Si alguien:
 *   - quita FORCE ROW LEVEL SECURITY de 068,
 *   - añade otra política permisiva (se OR-ean y la laxa gana),
 *   - hace que la aplicación se conecte con un rol que salta RLS,
 *   - o revierte `app_current_tenant_id()` a `current_setting(..., false)`,
 * este script se pone ROJO. Si no se ejecuta (falta la URL), sale con código 2,
 * NUNCA con 0: no poder comprobar no es aprobar.
 *
 * Uso:
 *   TEST_DATABASE_URL=postgres://app_owner:...@localhost:55432/glowtest \
 *     node backend/scripts/verifyTenantIsolation.js
 *
 * Salida: 0 = aislado y verificado | 1 = fuga demostrada | 2 = no se pudo probar
 */

const path = require('path');
const { Client } = require('pg');

// Para poder ejecutarlo con un solo comando en local: si no hay URL en el
// entorno, se toma de backend/.env.test (no versionado — .gitignore lo cubre
// con `.env.*`). En CI la variable se pasa explícita y esto no hace nada.
if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });
}

const TABLAS_ESPERADAS = [
  'services', 'bookings', 'transactions', 'messages', 'reviews',
  'portfolio_items', 'nail_tryon_jobs', 'perfiles_prestador', 'productos',
  'salones', 'salon_invitaciones',
  // `usuarios` dejó de ser una excepción (P0 t_fix_tenant_07): con RLS apagado
  // cualquier inquilino leía la PII de todos. Ahora exige RLS + FORCE + 1 política.
  'usuarios'
];

const URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const T1 = 900001;
const T2 = 900002;

let fallos = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const mal = (m) => { fallos++; console.log(`  ❌ ${m}`); };

function cabecera(t) { console.log(`\n${t}`); }

/** Ejecuta fn dentro de una transacción con el contexto de inquilino fijado.
 *  commit=true para lo que debe persistir (sembrar/limpiar); por defecto ROLLBACK,
 *  porque una prueba que necesita persistir y no lo hace pasa en vacío. */
async function conContexto(cli, tenantId, fn, { commit = false } = {}) {
  await cli.query('BEGIN');
  try {
    if (tenantId !== null && tenantId !== undefined) {
      // set_config(..., is_local = true): el ajuste vive solo dentro de esta
      // transacción. Es lo que sustituye al set_config(is_local=false) de nivel
      // de sesión que filtraba el inquilino a la siguiente petición que
      // reutilizara la conexión.
      // No se puede usar `SET LOCAL app.tenant_id = $1`: SET es una sentencia
      // utilitaria y PostgreSQL no admite parámetros ligados en ella.
      await cli.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(tenantId)]);
    }
    const r = await fn();
    await cli.query(commit ? 'COMMIT' : 'ROLLBACK');
    return r;
  } catch (err) {
    await cli.query('ROLLBACK');
    throw err;
  }
}

/** Devuelve el id de un usuario dueño, creándolo si la tabla está vacía.
 *  salones.id_dueno tiene FK a usuarios, así que la prueba necesita uno real. */
async function asegurarUsuarioDueno(cli) {
  const { rows } = await cli.query('SELECT id FROM usuarios ORDER BY id LIMIT 1');
  if (rows.length) return rows[0].id;

  const { rows: enums } = await cli.query(
    `SELECT a.attname,
            (SELECT e.enumlabel FROM pg_enum e JOIN pg_type et ON et.oid = e.enumtypid
              WHERE et.oid = t.oid LIMIT 1) AS etiqueta
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_type  t ON t.oid = a.atttypid
      WHERE c.relname = 'usuarios' AND a.attname IN ('rol', 'auth_provider')`
  );
  const etiqueta = (n, def) => (enums.find((e) => e.attname === n) || {}).etiqueta || def;
  const id = 900001;

  // Sin ON CONFLICT: con RLS + FORCE un ON CONFLICT contra una fila NO visible
  // lanza 'new row violates row-level security policy' en vez de no hacer nada.
  // Un INSERT normal que choque con el indice unico da 23505, que si se puede
  // absorber, y funciona igual con RLS apagado (que es el estado ROJO).
  await cli.query('BEGIN');
  try {
    await cli.query('SAVEPOINT seed_owner');
    try {
      await cli.query(
        `INSERT INTO usuarios (id, email, nombre, auth_provider, provider_id, rol, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
        [id, 'verify-isolation@test.local', 'Verify Isolation',
         etiqueta('auth_provider', 'LOCAL'), 'verify-isolation', etiqueta('rol', 'CLIENTE')]
      );
    } catch (e) {
      if (e.code !== '23505') throw e; // ya existe
      await cli.query('ROLLBACK TO SAVEPOINT seed_owner');
    }
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK');
    throw e;
  }
  return id;
}

async function main() {
  if (!URL) {
    console.error('❌ No se pudo probar: define TEST_DATABASE_URL o DATABASE_URL.');
    console.error('   (No poder comprobar el aislamiento NO cuenta como aprobado.)');
    process.exit(2);
  }

  const cli = new Client({ connectionString: URL });
  try {
    await cli.connect();
  } catch (err) {
    console.error(`❌ No se pudo conectar a la base de datos: ${err.message}`);
    process.exit(2);
  }

  try {
    const { rows: [{ usuario, superu, bypass }] } = await cli.query(
      `SELECT current_user AS usuario,
              (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS superu,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`
    );
    cabecera(`Rol de conexión: ${usuario}`);
    console.log(`  superusuario=${superu} bypassrls=${bypass}`);
    if (superu) {
      mal(`"${usuario}" es SUPERUSUARIO: PostgreSQL lo exceptúa de TODAS las políticas, `
        + 'incluso con FORCE. El aislamiento no se puede comprobar con este rol.');
    } else if (bypass) {
      mal(`"${usuario}" tiene BYPASSRLS: salta las políticas. Úsalo solo para webhooks/jobs, `
        + 'nunca como rol de la aplicación.');
    } else {
      ok('el rol no es superusuario ni tiene BYPASSRLS: las políticas se evalúan');
    }

    // ── 1. Estado declarativo de las tablas ────────────────────────────────
    cabecera('1. Estado de las tablas en pg_class / pg_policies');
    const { rows } = await cli.query(
      `SELECT c.relname,
              c.relrowsecurity       AS rls,
              c.relforcerowsecurity  AS force,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas,
              pg_get_userbyid(c.relowner) AS propietario
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'`
    );
    const porNombre = new Map(rows.map((r) => [r.relname, r]));
    for (const t of TABLAS_ESPERADAS) {
      const r = porNombre.get(t);
      if (!r) { console.log(`  · ${t}: no existe en este esquema (omitida)`); continue; }
      const nPoliticas = Number(r.politicas); // pg devuelve count(*) como string
      if (!r.rls)        mal(`${t}: RLS DESACTIVADO`);
      else if (!r.force) mal(`${t}: RLS activo pero SIN FORCE -> el propietario (${r.propietario}) salta las políticas`);
      else if (nPoliticas !== 1) {
        mal(`${t}: ${nPoliticas} políticas. Deben ser exactamente 1: con varias, las `
          + 'permisivas se OR-ean y una laxa anula a la estricta.');
      } else ok(`${t}: RLS + FORCE + 1 política`);
    }

    // ── 2. Comportamiento real ─────────────────────────────────────────────
    if (!porNombre.has('salones')) {
      console.log('\n⚠️  No hay tabla "salones": se omiten las pruebas de comportamiento.');
      console.log('   Aplica 067_create_multi_salon_ddl.sql para habilitarlas.');
    } else {
      cabecera('2. Comportamiento con datos de dos inquilinos distintos');

      // Fixture: salones.id_dueno -> usuarios y salones.tenant_id -> tenants,
      // así que ambas referencias tienen que existir de verdad.
      const duenoId = await asegurarUsuarioDueno(cli);
      await cli.query(
        `INSERT INTO tenants (id, name, slug)
         VALUES ($1, $2, $3), ($4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [T1, 'Verificacion Inquilino 1', 'verif-t1', T2, 'Verificacion Inquilino 2', 'verif-t2']
      );
      ok(`fixture listo (dueño id=${duenoId}, inquilinos ${T1} y ${T2})`);

      // Sembrar usando el contexto correcto de cada inquilino. commit: true,
      // porque si se revierte no hay nada que aislar y todas las comprobaciones
      // posteriores pasarían en vacío.
      const insertar = async (tenantId, nombre) => conContexto(cli, tenantId, async () => {
        await cli.query(
          'INSERT INTO salones (tenant_id, nombre_salon, id_dueno) VALUES ($1, $2, $3)',
          [tenantId, nombre, duenoId]
        );
      }, { commit: true });
      await insertar(T1, 'verificacion-tenant-1');
      await insertar(T2, 'verificacion-tenant-2');
      ok('sembrados dos salones, uno por inquilino');

      const cuenta = async (tenantId) => conContexto(cli, tenantId, async () => {
        const r = await cli.query(
          'SELECT count(*)::int AS n FROM salones WHERE nombre_salon LIKE $1',
          ['verificacion-tenant-%']
        );
        return r.rows[0].n;
      });

      const soloT1 = await conContexto(cli, T1, async () => {
        const r = await cli.query(
          "SELECT count(*)::int AS n FROM salones WHERE nombre_salon = 'verificacion-tenant-2'"
        );
        return r.rows[0].n;
      });
      if (soloT1 === 0) ok('con contexto del inquilino 1 NO se ve el salón del inquilino 2');
      else mal(`con contexto del inquilino 1 se ven ${soloT1} filas del inquilino 2: FUGA CROSS-TENANT`);

      const sinContexto = await conContexto(cli, null, async () => {
        const r = await cli.query(
          "SELECT count(*)::int AS n FROM salones WHERE nombre_salon LIKE 'verificacion-tenant-%'"
        );
        return r.rows[0].n;
      });
      if (sinContexto === 0) ok('sin contexto de inquilino se ven 0 filas (falla cerrado, no lanza error)');
      else mal(`sin contexto se ven ${sinContexto} filas: el aislamiento falla ABIERTO`);

      const propias = await cuenta(T1);
      if (propias >= 1) ok(`con contexto del inquilino 1 sÍ se ve su propio salón (${propias} fila/s)`);
      else mal(`con contexto del inquilino 1 no se ve su propio salón: el aislamiento bloquea de más`);

      // Escritura cruzada: debe ser rechazada por el WITH CHECK.
      let rechazada = false;
      try {
        await conContexto(cli, T1, async () => {
          await cli.query(
            'INSERT INTO salones (nombre_salon, id_dueno, tenant_id) VALUES ($1, $2, $3)',
            ['verificacion-cruzada', duenoId, T2]
          );
        });
      } catch (err) {
        // Es el MISMO predicado que usa el handler de errores de index.js para
        // responder 403 (y no 500) cuando la petición tocó otro inquilino: si
        // aquí no aparece el código 42501, el handler no se activaría.
        rechazada = err.code === '42501' && /row-level security/i.test(err.message);
        if (!rechazada) console.log(`     (motivo observado: code=${err.code} · ${err.message})`);
      }
      if (rechazada) ok('escribir en el inquilino ajeno es RECHAZADO (WITH CHECK en vigor, error 42501 → el handler lo convierte en 403)');
      else mal('se pudo escribir una fila en el inquilino ajeno: falta WITH CHECK en la política');

      // Relleno automático: sin tenant_id explícito el trigger debe ponerlo.
      const rellenado = await conContexto(cli, T1, async () => {
        await cli.query(
          'INSERT INTO salones (nombre_salon, id_dueno) VALUES ($1, $2)',
          ['verificacion-trigger', duenoId]
        );
        const r = await cli.query(
          "SELECT tenant_id FROM salones WHERE nombre_salon = 'verificacion-trigger'"
        );
        return r.rows[0] ? r.rows[0].tenant_id : null;
      });
      if (rellenado === T1) ok(`el trigger rellenó tenant_id=${rellenado} desde el contexto`);
      else mal(`el trigger no rellenó tenant_id (quedó ${rellenado}): los INSERT sin tenant_id `
        + 'fallarán y FORCE romperá la aplicación');

      // ── 2b. PII de `usuarios` (hallazgo P0 t_fix_tenant_07) ───────────────
      // Con RLS DESACTIVADO en `usuarios`, cualquier inquilino leía a TODOS los
      // usuarios (email, teléfono, hash de contraseña...). Debe ver sólo su
      // propia fila y las de su inquilino, y el arranque de identidad sin
      // contexto debe seguir funcionando por las funciones SECURITY DEFINER.
      const sembrarUsuario = (uid, tenantId, email, nombre) => conContexto(cli, tenantId, async () => {
        // Sin ON CONFLICT (ver asegurarUsuarioDueno): SAVEPOINT absorbe el 23505
        // si la fila ya existia de una corrida anterior.
        await cli.query('SAVEPOINT seed_user');
        try {
          await cli.query(
            `INSERT INTO usuarios (id, email, nombre, auth_provider, provider_id, rol, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [uid, email, nombre, 'LOCAL', `verif-${uid}`, 'CLIENTE', tenantId]
          );
        } catch (e) {
          if (e.code !== '23505') throw e;
          await cli.query('ROLLBACK TO SAVEPOINT seed_user');
        }
      }, { commit: true });

      await sembrarUsuario(900011, T1, 'pii-t1@verif.test', 'PII Inquilino 1');
      await sembrarUsuario(900012, T2, 'pii-t2@verif.test', 'PII Inquilino 2');
      ok('sembrados dos usuarios con PII, uno por inquilino');

      const piiAjena = await conContexto(cli, T1, async () => {
        const r = await cli.query(
          "SELECT count(*)::int AS n FROM usuarios WHERE email = 'pii-t2@verif.test'"
        );
        return r.rows[0].n;
      });
      if (piiAjena === 0) ok('con contexto del inquilino 1 NO se ve la PII del usuario del inquilino 2');
      else mal(`con contexto del inquilino 1 se ve la PII del inquilino 2 (${piiAjena} fila/s): FUGA CROSS-TENANT en usuarios`);

      const piiPropia = await conContexto(cli, T1, async () => {
        const r = await cli.query(
          "SELECT count(*)::int AS n FROM usuarios WHERE email = 'pii-t1@verif.test'"
        );
        return r.rows[0].n;
      });
      if (piiPropia >= 1) ok('con contexto del inquilino 1 SÍ se ve su propio usuario');
      else mal('con contexto del inquilino 1 no se ve su propio usuario: el aislamiento bloquea de más');

      // El arranque de identidad (auth.js: SELECT rol, tenant_id ... WHERE id=$1)
      // ocurre ANTES de fijar contexto: debe resolverse sin sujeto ni inquilino.
      const identidad = await conContexto(cli, null, async () => {
        const r = await cli.query('SELECT rol, tenant_id FROM app_usuario_identidad($1::integer)', [900011]);
        return r.rows[0];
      });
      if (identidad && identidad.tenant_id === T1) ok('app_usuario_identidad devuelve la identidad SIN contexto (arranque preservado)');
      else mal('app_usuario_identidad no devolvió la identidad sin contexto: el arranque de auth quedaría roto (401)');

      // Sin contexto y sin sujeto, la lectura directa debe ser CERO (falla cerrado).
      const usuariosSinContexto = await conContexto(cli, null, async () => {
        const r = await cli.query(
          "SELECT count(*)::int AS n FROM usuarios WHERE email LIKE 'pii-%@verif.test'"
        );
        return r.rows[0].n;
      });
      if (usuariosSinContexto === 0) ok('sin contexto, la lectura directa de usuarios ve 0 filas (falla cerrado)');
      else mal(`sin contexto se ven ${usuariosSinContexto} filas de usuarios: el aislamiento falla ABIERTO`);

      // Limpieza: también con commit, o los datos de prueba se quedan.
      for (const t of [T1, T2]) {
        await conContexto(cli, t, async () => {
          await cli.query("DELETE FROM salones WHERE nombre_salon LIKE 'verificacion-%'");
          await cli.query("DELETE FROM usuarios WHERE email LIKE 'pii-%@verif.test'");
        }, { commit: true });
      }
      ok('datos de prueba eliminados');
    }

    // ── 3. Veredicto ───────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(68));
    if (fallos === 0) {
      console.log('✅ AISLAMIENTO MULTI-TENANT VERIFICADO');
      process.exit(0);
    }
    console.log(`❌ AISLAMIENTO NO VERIFICADO — ${fallos} problema(s)`);
    process.exit(1);

  } catch (err) {
    console.error(`\n❌ Error inesperado durante la verificación: ${err.message}`);
    console.error(err.stack);
    process.exit(2);
  } finally {
    await cli.end().catch(() => {});
  }
}

main();
