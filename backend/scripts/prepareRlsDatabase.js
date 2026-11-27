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
const MIGRACIONES_BASE_NUEVA = [
'init.sql',
'000_create_usuarios.sql',
'001_payment_system.sql',
'003_habeas_data_and_config.sql',
'006_legal_architecture_pila_consignacion.sql',
'009_create_productos_table.sql',
'010_implement_glowstore_schema.sql',
// Completar columnas que producción tiene y esta cadena no creaba (005/012/015/016/027/060/086/087).
'005_add_terminos_acceptance.sql',
'002_ai_history.sql',
'012_skincare_planner_reengineering.sql',
'015_colorimetria_quota_and_palette.sql',
'016_glowstyle_wardrobe.sql',
'027_align_beauty_profiles_and_biometric_history.sql',
'059_create_tipo_trabajador_enum.sql',
'060_add_worker_type_to_usuarios.sql',
'086_add_iva_configuration.sql',
'087_add_provider_rut_responsibility.sql',
'020_biometric_consent_and_profiles.sql',
'037_create_biometric_consents.sql',
'079_definitive_fix_biometric_consents.sql',
'054_create_core_tables.sql',
'097_reglas_servicio_propina_y_creditos.sql',
'098_independencia_prestador.sql',
'099_add_productos_adicionales_to_bookings.sql',
'206_booking_reservation_fee.sql',
'055_create_tenants_table.sql',
'056_add_tenant_id_to_core_tables.sql',
'057_backfill_tenant_id.sql',
'058_enable_rls_policies.sql',
'065_multi_tenant_hardening.sql',
'067_create_multi_salon_ddl.sql',
'198_salon_business_hours.sql',
'068_force_rls_strict_isolation.sql',
'070_extend_tipo_rol_salon_admin.sql',
'107_rls_politicas_sin_contexto.sql',
'012_business_engine.sql',
  // SaaS team context reads business_profiles.saas_plan (109 is independent of billing tables).
  '109_saas_tenant_plan.sql',
  // Trial lifecycle integration tests need the production SaaS billing and audit schema.
  '108_saas_usage_schema.sql',
  '111_saas_billing_schema.sql',
  '110_saas_schema_fix_and_complete.sql',
  '202_saas_trial_lifecycle.sql',
  // Fresh CI DBs need to recognize the legacy entitlement value in fixtures.
  '203_saas_trial_legacy_entitlements.sql',
'062_optimize_business_saas_postgres.sql',
'082_memberships.sql',
// The membership service writes invite_token and status PENDING.
'112_memberships_invite_columns.sql',
'114_memberships_sub_rol.sql',
  // The commercial operations migration extends the cash ledger and inventory.
  '116_caja_movimientos.sql',
  // The real PostgreSQL resource quota test needs the resource tables and locks.
  '117_inventario_y_alquileres.sql',
  // SaaS inventory reads join reservation consumption; include the production
  // schema so authenticated inventory routes are exercised against real RLS.
  '194_fase5_operacion_comercial.sql',
'118_drop_salon_miembros.sql',
'119_force_rls_retention_policies.sql',
'121_glowshop_precios_minimas.sql',
'122_catalogo_costo_sku.sql',
'123_checkout_tenant_wompi.sql',
'120_force_rls_all_tenant_tables.sql',
'124_auth_lookup_security_definer.sql',
'008_social_integrations.sql',
// 138: el CHECK de platform de social_shares_log no admitía SISTEMA (hoja del
// sistema) y no había idempotencia por día; sin 008 la tabla no existía.
'138_social_shares.sql',
'139_referidos_atribucion.sql',
  '140_producto_compartido.sql',
  '141_referido_compra_puntos.sql',
  '142_puntos_libro.sql',
  '143_canje_puntos_pedido.sql',
  '144_referral_clicks_y_control.sql',
  '145_puntos_aviso_vencimiento.sql',
  '146_usuarios_huellas_antifraude.sql',
  '147_usuarios_sin_tenant.sql',
  '148_productos_sin_tenant.sql',
  '149_ai_usage_events.sql',
  '150_usuarios_referral_code.sql',
  '151_usuarios_nivel_notificado.sql',
  '152_usuarios_fecha_alta.sql',
  // D-GL-030 / D-GL-031: RUT obligatorio con revisión, estado operativo
  // (Modo Exploración) y slug de la vitrina. Todas son ADD COLUMN IF NOT EXISTS,
  // así que se aplican igual sobre una base vacía y sobre una ya poblada.
  '153_prestador_rut_revision.sql',
      '154_estado_operativo_proveedor.sql',
      '155_vitrina_publica_proveedor.sql',
      '125_usuario_lookup_sin_contexto.sql',
    '127_review_aspectos.sql',
    '128_usuario_fcm_token.sql',
    '129_otp_codigo_cifrado.sql',
    '130_completar_esquema_base_cliente.sql',
// 135: horario de atención del prestador. Sin ella /api/providers fallaba con
// «column p.active_start_hour does not exist» en toda base creada desde la cadena.
'135_horario_atencion_prestador.sql',
// 136: contrato de tipo de services.id (uuid como produccion). Solo verifica.
'136_services_uuid_contract.sql',
  // ── Logística Fase 1-4 (D-GL-029/030/033/035) ──────────────────────────
  // Orden obligatorio: 092 crea envios, 094 crea zonas_envio, 161 crea
  // carrier_accounts (160 le agrega la FK), 162 routing rules, 163 devoluciones
  // (FK a envios), 164 extiende webhook_events (tabla de 130), 167 DANE, 168 seeds.
  // Todas idempotentes: van también en MIGRACIONES_ARRANQUE para bases ya pobladas.
  '092_add_envios_and_estado_timestamps.sql',
  '094_create_zonas_envio.sql',
  '161_create_carrier_accounts.sql',
  '160_extend_envios_multi_carrier.sql',
  '162_create_shipping_routing_rules.sql',
  '163_create_devoluciones.sql',
  '164_extend_webhook_events_envia.sql',
  '166_seed_insumos_b2b.sql',
  '167_municipios_dane.sql',
  '168_seed_carrier_routing.sql',
  '169_saneamiento_seeds_logistica.sql',
  // ── Logística Fase 5 (D-GL-036) ────────────────────────────────────────
  // 170 prefs, 171 notificaciones y 172 devoluciones; 174 y 175 crean
  // los contratos que consume 173 (métricas diarias).
  '170_usuario_notificaciones_prefs.sql',
  '171_notificaciones_log.sql',
  '172_extend_devoluciones_retorno.sql',
  '174_glowshop_provider_fulfillment.sql',
  '175_glowshop_return_contract.sql',
  '173_logistica_metricas_diarias.sql',
  '177_fix_logistica_metrics_rls.sql',
  '178_refresh_municipios_dane_catalog.sql',
  '179_add_notification_prefs_metadata.sql',
  '180_fix_logistics_daily_metrics.sql',
  '182_fix_logistics_metrics_destination_schema.sql',
  // 183: suspend visibility without disabling account access.
  '183_user_public_visibility_suspension.sql',
  '189_explicit_salon_business_profile.sql',
  // SaaS salon scope and membership governance.
  '190_saas_membership_governance.sql',
  '191_booking_tenant_salon_scope.sql',
  '197_business_profiles_membership_read.sql',
  '199_service_provider_user_reference.sql',
  '200_saas_memberships_rls.sql',
  '204_direct_bookings_usage_metric.sql',
  '205_saas_api_key_lookup.sql',
  '207_aura_business_usage_metric.sql',
'208_provider_live_location.sql',
];

// ── Lista de ARRANQUE ───────────────────────────────────────────────────────
// Se aplica en CADA arranque, sobre una base que ya tiene datos. Solo puede
// contener migraciones reejecutables: se probaron una a una contra una base
// inicializada (33 candidatas, 31 aguantan; las 2 que no, quedan fuera).
//
// FUERA a propósito:
//  · 006 — ALTER TABLE ... ADD COLUMN sin IF NOT EXISTS. Rompió producción el
//    2026-11-05: el entrypoint abortó, el contenedor entró en bucle y la API
//    devolvió 502 hasta revertir.
//  · 020 — UPDATE ... SET active sobre una columna que ya no existe.
// Ambas siguen en MIGRACIONES_BASE_NUEVA, que solo corre con la base vacía.
//
// 125 va aquí porque completa la convergencia de app_usuario_por_email: 068,
// 084 y 125 empiezan con DROP FUNCTION, así que el arranque acaba siempre con
// la misma firma, venga de donde venga la base.
const MIGRACIONES_ARRANQUE = [

  'init.sql',

  '054_create_core_tables.sql',

  // These idempotent lifecycle migrations supply fields written by Booking.
  '097_reglas_servicio_propina_y_creditos.sql',
  '098_independencia_prestador.sql',

  // BookingController reads/writes this JSONB column in real booking flows.
  '099_add_productos_adicionales_to_bookings.sql',

  '206_booking_reservation_fee.sql',

  '055_create_tenants_table.sql',

  '056_add_tenant_id_to_core_tables.sql',

  '057_backfill_tenant_id.sql',

  '058_enable_rls_policies.sql',

  '065_multi_tenant_hardening.sql',

  '067_create_multi_salon_ddl.sql',

  // The booking controller selects salon hours even when a salon has none set.
  '198_salon_business_hours.sql',

  '068_force_rls_strict_isolation.sql',

  '070_extend_tipo_rol_salon_admin.sql',

  '107_rls_politicas_sin_contexto.sql',

  '012_business_engine.sql',
  // SaaS team context reads business_profiles.saas_plan (109 is independent of billing tables).
  '109_saas_tenant_plan.sql',
  // Keep PostgreSQL CI aligned with the SaaS schema used by production cron jobs.
  '108_saas_usage_schema.sql',
  '111_saas_billing_schema.sql',
  '110_saas_schema_fix_and_complete.sql',
  '202_saas_trial_lifecycle.sql',

  '062_optimize_business_saas_postgres.sql',

  '082_memberships.sql',

  // Keep existing test databases aligned with the membership service schema.
  '112_memberships_invite_columns.sql',

  '114_memberships_sub_rol.sql',

  // Keep operational resource tables available for quota integration coverage.
  '117_inventario_y_alquileres.sql',

  '118_drop_salon_miembros.sql',

  '119_force_rls_retention_policies.sql',

  '121_glowshop_precios_minimas.sql',

  '122_catalogo_costo_sku.sql',

  '123_checkout_tenant_wompi.sql',

  '120_force_rls_all_tenant_tables.sql',

  '124_auth_lookup_security_definer.sql',
  '008_social_integrations.sql',
  '138_social_shares.sql',
  '139_referidos_atribucion.sql',
  '140_producto_compartido.sql',
  '141_referido_compra_puntos.sql',
  '142_puntos_libro.sql',
  '143_canje_puntos_pedido.sql',
  '144_referral_clicks_y_control.sql',
  '145_puntos_aviso_vencimiento.sql',
  '146_usuarios_huellas_antifraude.sql',
  '147_usuarios_sin_tenant.sql',
  '148_productos_sin_tenant.sql',
  '149_ai_usage_events.sql',
  '150_usuarios_referral_code.sql',
  '151_usuarios_nivel_notificado.sql',
  '152_usuarios_fecha_alta.sql',
  // D-GL-030 / D-GL-031: RUT obligatorio con revisión, estado operativo
    // (Modo Exploración) y slug de la vitrina. Todas son ADD COLUMN IF NOT EXISTS,
    // así que se aplican igual sobre una base vacía y sobre una ya poblada.
    '153_prestador_rut_revision.sql',
      '154_estado_operativo_proveedor.sql',
      '155_vitrina_publica_proveedor.sql',

      '125_usuario_lookup_sin_contexto.sql',

    '127_review_aspectos.sql',

    '128_usuario_fcm_token.sql',

    '129_otp_codigo_cifrado.sql',

    // 135 cierra el drift de active_start_hour/active_end_hour/weekly_schedule:

  // producción las tenía por script manual, la cadena no las creaba.

  '135_horario_atencion_prestador.sql',

  // 136 solo verifica que services.id sea uuid (no convierte ni escribe).

  '136_services_uuid_contract.sql',
  // ── Logística Fase 1-4 (D-GL-029/030/033/035) ──────────────────────────
  // Orden obligatorio: 092 crea envios, 094 crea zonas_envio, 161 crea
  // carrier_accounts (160 le agrega la FK), 162 routing rules, 163 devoluciones
  // (FK a envios), 164 extiende webhook_events (tabla de 130), 167 DANE, 168 seeds.
  // Todas idempotentes: van también en MIGRACIONES_ARRANQUE para bases ya pobladas.
  '130_completar_esquema_base_cliente.sql',
  '092_add_envios_and_estado_timestamps.sql',
  '094_create_zonas_envio.sql',
  '161_create_carrier_accounts.sql',
  '160_extend_envios_multi_carrier.sql',
  '162_create_shipping_routing_rules.sql',
  '163_create_devoluciones.sql',
  '164_extend_webhook_events_envia.sql',
  '166_seed_insumos_b2b.sql',
    '167_municipios_dane.sql',
    '168_seed_carrier_routing.sql',
    '169_saneamiento_seeds_logistica.sql',

    // ── Logística Fase 5 (D-GL-036) ────────────────────────────────────────
    // 170 prefs, 171 notificaciones y 172 devoluciones; 174 y 175 crean
    // los contratos que consume 173 (métricas diarias).
    '170_usuario_notificaciones_prefs.sql',
    '171_notificaciones_log.sql',
    '172_extend_devoluciones_retorno.sql',
    '174_glowshop_provider_fulfillment.sql',
    '175_glowshop_return_contract.sql',
    '173_logistica_metricas_diarias.sql',
    '177_fix_logistica_metrics_rls.sql',
    '178_refresh_municipios_dane_catalog.sql',
    '179_add_notification_prefs_metadata.sql',
    '180_fix_logistics_daily_metrics.sql',
  '182_fix_logistics_metrics_destination_schema.sql',
  // Keep existing databases aligned with the public visibility checks.
  '183_user_public_visibility_suspension.sql',
  '189_explicit_salon_business_profile.sql',
  '190_saas_membership_governance.sql',
  '191_booking_tenant_salon_scope.sql',
  '197_business_profiles_membership_read.sql',
  '199_service_provider_user_reference.sql',
  '200_saas_memberships_rls.sql',
  '204_direct_bookings_usage_metric.sql',
  '205_saas_api_key_lookup.sql',
  '207_aura_business_usage_metric.sql',
  '208_provider_live_location.sql',
  ];
/// Lista que corresponde según el estado de la base.
function migracionesPara(baseVacia) {
  const lista = baseVacia ? MIGRACIONES_BASE_NUEVA : MIGRACIONES_ARRANQUE;
  return lista.filter((m) => !omitidas.includes(m));
}
const omitidas = (process.env.MIGRAR_OMITIR || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
// La lista se elige en main(), cuando se sabe si la base está vacía.

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

    // ── 1a. Roles RLS (ANTES de migrar) ────────────────────────────────────
    // Varias migraciones hacen CREATE POLICY ... TO app_rls_user, y PostgreSQL
    // exige que ese rol exista en el momento de la sentencia. El entrypoint los
    // crea con setupRlsRole.sql, pero el job de CI corre solo este script y una
    // base vacía no tiene roles: aquí se garantizan. Solo el rol: los GRANT
    // sobre tablas van en el paso 2, cuando las tablas ya existen.
    console.log('👤 Asegurando los roles RLS antes de migrar...');
    await cliente.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls_user') THEN
          CREATE ROLE app_rls_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
          CREATE ROLE app_system NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
          CREATE ROLE app_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
        END IF;
      END $$;
    `);

    for (const nombre of migracionesPara(baseVacia)) {
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
