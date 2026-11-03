#!/usr/bin/env node
/**
 * backend/scripts/prepareRlsDatabase.js
 *
 * Deja una base de datos lista para PROBAR el aislamiento multi-tenant:
 * aplica el esquema, crea los roles RLS y transfiere la propiedad de las tablas
 * multi-tenant al rol no superusuario que lo demuestra.
 */

const { Client } = require('pg');

const ADMIN_URL = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
const PASSWORD = process.env.RLS_ROLE_PASSWORD;
if (!PASSWORD) {
  console.error('[ERROR] RLS_ROLE_PASSWORD environment variable is required but not set');
  process.exit(2);
}

// Migrations are read from backend/migrations (copied into the image by Dockerfile).
// The previous "embedded constants" approach silently corrupted some literals
// (058 evaluated to NaN), so file-based loading is the only reliable option.
// OJO: esta lista se aplica en cada arranque y el entrypoint ABORTA si alguna
// falla (el contenedor queda en Crashed). Antes de agregar una migración hay que
// comprobar que todas sus dependencias ya estén en la base: 071, por ejemplo,
// hace ALTER TABLE sobre scan_product_matches (creada por 029) y tumba el
// servicio si esa tabla no existe.
const MIGRACIONES = [
  'init.sql',
  '054_create_core_tables.sql',
  '055_create_tenants_table.sql',
  '056_add_tenant_id_to_core_tables.sql',
  '057_backfill_tenant_id.sql',
  '058_enable_rls_policies.sql',
  '065_multi_tenant_hardening.sql',
  '067_create_multi_salon_ddl.sql',
  '068_force_rls_strict_isolation.sql',
  '107_rls_politicas_sin_contexto.sql',
  '012_business_engine.sql',
  '062_optimize_business_saas_postgres.sql',
  '082_memberships.sql',
  '114_memberships_sub_rol.sql',
  '118_drop_salon_miembros.sql',
  '119_force_rls_retention_policies.sql',
  '120_force_rls_all_tenant_tables.sql',
  // GlowShop: crea las tablas de precios que la 071 nunca pudo crear (depende de
  // scan_product_matches, inexistente) y siembra las listas base. Da el 200 a
  // GET /api/products. Va al final a propósito: después de 120, para que el
  // forzado de RLS de esa migración la cubra en el siguiente arranque.
  '121_glowshop_precios_minimas.sql',
  // Catálogo: `createProduct`/`updateProduct` exigen costo y sku (L21), columnas
  // que introduce la 071 y que nunca se aplicaron. Sin ellas el panel de
  // productos responde 500 al crear o editar.
  '122_catalogo_costo_sku.sql',
  // Checkout de la tienda: `createOrder` necesita app_platform_tenant_id() y las
  // columnas tenant_id, ambas de la 071. Sin ellas todo pedido muere con 500 y
  // el ciclo de pago de Wompi no puede empezar.
  '123_checkout_tenant_wompi.sql',
];

const path = require('path');
const fs = require('fs');

let MIGRATIONS_DIR = null;

// The build context differs between local builds and Railway's remote build,
// so resolve the migrations directory by probing candidate locations.
const CANDIDATOS_MIGRACIONES = [
  path.join(__dirname, '..', 'migrations'),
  path.join(process.cwd(), 'migrations'),
  path.join(process.cwd(), 'backend', 'migrations'),
  '/app/backend/migrations',
  '/app/migrations',
];

function resolverDirMigraciones() {
  for (const dir of CANDIDATOS_MIGRACIONES) {
    try {
      const sqls = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
      if (sqls.length > 0) {
        console.log(`   📁 Migraciones: ${dir} (${sqls.length} archivos)`);
        return dir;
      }
    } catch (error) {
      /* candidato inexistente: se prueba el siguiente */
    }
  }
  return null;
}

function leerMigracion(nombre) {
  const candidatos = [path.join(MIGRATIONS_DIR, nombre)];
  if (nombre === 'init.sql') {
    candidatos.push(path.join(__dirname, '..', 'init.sql'));
    candidatos.push(path.join(process.cwd(), 'init.sql'));
    candidatos.push(path.join(process.cwd(), 'backend', 'init.sql'));
  }
  let ultimoError = null;
  for (const archivo of candidatos) {
    try {
      return fs.readFileSync(archivo, 'utf8');
    } catch (error) {
      ultimoError = error;
    }
  }
  throw ultimoError || new Error('no encontrado');
}

async function main() {
  if (!ADMIN_URL) {
    console.error('[ERROR] Falta DATABASE_URL_ADMIN (o DATABASE_URL): no se puede preparar la base.');
    process.exit(2);
  }

  const cliente = new Client({ connectionString: ADMIN_URL });
  try {
    await cliente.connect();
  } catch (error) {
    console.error(`[ERROR] No se pudo conectar a la base: ${error.message}`);
    process.exit(2);
  }

  try {
    const { rows: [estado] } = await cliente.query(
      `SELECT count(*)::int AS tablas
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('spatial_ref_sys')`
    );
    const baseVacia = estado.tablas === 0;

    console.log(
      baseVacia
        ? '📦 Base vacía: se aplica el esquema completo (init.sql incluido).'
        : `📦 Base ya inicializada (${estado.tablas} tablas): se aplican solo las migraciones idempotentes.`
    );

    MIGRATIONS_DIR = resolverDirMigraciones();
    if (!MIGRATIONS_DIR) {
      console.error(
        '[ERROR] No se encontró el directorio de migraciones. Candidatos probados: ' +
          CANDIDATOS_MIGRACIONES.join(' | ')
      );
      process.exit(1);
    }

    for (const nombre of MIGRACIONES) {
      if (nombre === 'init.sql' && !baseVacia) {
        console.log('   ⏭️  init.sql omitido — no es idempotente y el esquema ya existe.');
        continue;
      }
      let sql;
      try {
        sql = leerMigracion(nombre);
      } catch (error) {
        if (nombre === 'init.sql') {
          console.log('   ⏭️  init.sql no presente en el contenedor; se omite.');
          continue;
        }
        console.error(`[ERROR] Migración no encontrada: ${nombre} (${error.message})`);
        process.exit(1);
      }
      if (!sql || !sql.trim()) {
        console.error(`[ERROR] Migración vacía: ${nombre}`);
        process.exit(1);
      }
      try {
        await cliente.query(sql);
        console.log(`   [OK] ${nombre}`);
      } catch (error) {
        console.error(`   [ERROR] ${nombre}: ${error.message}`);
        process.exit(1);
      }
    }

    // ── 2. Roles RLS ───────────────────────────────────────────────────────
    console.log('\n👤 Creando los roles RLS:');
    const fs = require('fs');
    const path = require('path');
    const setupRlsPath = path.join(__dirname, 'setupRlsRole.sql');
    if (fs.existsSync(setupRlsPath)) {
      await cliente.query(fs.readFileSync(setupRlsPath, 'utf8'));
    } else {
      await cliente.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
            CREATE ROLE app_rls_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
            CREATE ROLE app_system LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
          END IF;
        END $$;
      `);
    }

    await cliente.query(`
      DO $$
      BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
           CREATE ROLE app_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
         END IF;
       END $$;
    `);
    for (const rol of ['app_rls_user', 'app_owner']) {
      await cliente.query(`ALTER ROLE ${rol} WITH LOGIN PASSWORD '${PASSWORD.replace(/'/g, "''")}'`);
    }
    console.log('   [OK] app_rls_user (aplicación), app_system (BYPASSRLS), app_owner (propietario de prueba)');

    // ── 3. Propiedad de las tablas multi-tenant ────────────────────────────
    const { rows: tablas } = await cliente.query(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM information_schema.columns i
                       WHERE i.table_schema = 'public' AND i.table_name = c.relname
                         AND i.column_name = 'tenant_id')
        ORDER BY c.relname`
    );
    console.log(`\n🔑 Transfiriendo la propiedad de ${tablas.length} tablas multi-tenant a app_owner:`);
    for (const { relname } of tablas) {
      await cliente.query(`ALTER TABLE public."${relname}" OWNER TO app_owner`);
    }
    await cliente.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_owner');
    await cliente.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_owner');
    await cliente.query('GRANT USAGE ON SCHEMA public TO app_owner');
    console.log(`   [OK] ${tablas.map((t) => t.relname).join(', ')}`);

    // ── 4. Resumen verificable ─────────────────────────────────────────────
    await cliente.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
           WHERE c.relname = 'business_requirements'
        ) THEN
          ALTER TABLE business_requirements ENABLE ROW LEVEL SECURITY;
          CREATE POLICY catalog_business_requirements ON business_requirements
            USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `);
    const EXENTAS_DE_FORCE = [];

    await cliente.query(`
      DO $$
      DECLARE t record;
      BEGIN
        FOR t IN
          SELECT c.relname
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'
             AND NOT c.relforcerowsecurity
             AND EXISTS (SELECT 1 FROM information_schema.columns i
                          WHERE i.table_schema = 'public' AND i.table_name = c.relname
                            AND i.column_name = 'tenant_id')
             AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
        LOOP
          EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.relname);
        END LOOP;
      END $$;
    `);

    const { rows: [resumen] } = await cliente.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE c.relforcerowsecurity)::int AS con_force,
              coalesce(array_agg(c.relname::text ORDER BY c.relname)
                       FILTER (WHERE NOT c.relforcerowsecurity), '{}'::text[]) AS sin_force,
              coalesce(array_agg(c.relname::text ORDER BY c.relname)
                       FILTER (WHERE NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)), '{}'::text[]) AS sin_politica
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM information_schema.columns i
                       WHERE i.table_schema = 'public' AND i.table_name = c.relname
                         AND i.column_name = 'tenant_id')`
    );
    console.log(`\n📊 Tablas con tenant_id: ${resumen.total} | con FORCE: ${resumen.con_force}`);
    console.log(`   exentas de FORCE (deliberado): ${EXENTAS_DE_FORCE.join(', ')}`);
    console.log(`   sin FORCE (catálogo)         : ${resumen.sin_force.join(', ') || '(ninguna)'}`);
    console.log(`   sin política                 : ${resumen.sin_politica.join(', ') || '(ninguna)'}`);

    const base = ADMIN_URL.replace(/\/\/[^@]*@/, '//');
    console.log('\n[OK] Base preparada. URLs para las pruebas:');
    console.log(`   app (DATABASE_URL)              postgres://app_rls_user:***@${base.split('//')[1]}`);
    console.log(`   propietario (TEST_DATABASE_URL) postgres://app_owner:***@${base.split('//')[1]}`);

    const sinForceInesperadas = resumen.sin_force.filter((t) => !EXENTAS_DE_FORCE.includes(t));
    const sinPoliticaInesperadas = resumen.sin_politica.filter((t) => !EXENTAS_DE_FORCE.includes(t));
    if (sinForceInesperadas.length || sinPoliticaInesperadas.length) {
      console.error(
        '[ERROR] Aislamiento incompleto. Sin FORCE: ' +
        `${sinForceInesperadas.join(', ') || '—'}. Sin política: ${sinPoliticaInesperadas.join(', ') || '—'}. Revisa 068.`
      );
      process.exit(1);
    }
    process.exit(0);
  } catch (error) {
    console.error(`\n[ERROR] Error preparando la base: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();
