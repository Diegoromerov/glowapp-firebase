#!/usr/bin/env node
// Verifica en PostgreSQL real la frontera de acceso de la ubicación móvil:
// cada proveedor solo ve/modifica su fila; app_system conserva acceso operativo.
'use strict';

const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL_ADMIN;
if (!connectionString) {
  console.error('[ERROR] DATABASE_URL_ADMIN es obligatoria para verificar RLS de ubicación móvil.');
  process.exit(2);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');

    const { rows: tenantRows } = await client.query(
      'SELECT id FROM tenants WHERE es_plataforma = true ORDER BY id LIMIT 1'
    );
    if (!tenantRows.length) throw new Error('No existe el tenant de plataforma para el fixture.');

    const { rows: idRows } = await client.query(
      'SELECT COALESCE(MAX(id), 0)::integer + 100 AS first_id FROM usuarios'
    );
    const providerA = idRows[0].first_id;
    const providerB = providerA + 1;
    const tenantId = tenantRows[0].id;
    const suffix = `${process.pid}_${Date.now()}`;

    for (const [id, suffixId] of [[providerA, 'a'], [providerB, 'b']]) {
      await client.query(
        `INSERT INTO usuarios
           (id, email, nombre, auth_provider, provider_id, password_hash,
            rol, is_active, onboarding_completo, tenant_id)
         VALUES ($1, $2, $3, 'LOCAL', $4, 'x', 'PRESTADOR', true, true, $5)`,
        [id, `provider-live-rls-${suffix}-${suffixId}@test.local`, `RLS ${suffixId}`, `rls-${suffix}-${suffixId}`, tenantId]
      );
      await client.query(
        `INSERT INTO perfiles_prestador
           (id, business_name, is_active, estatus_verificacion, ubicacion, tenant_id)
         VALUES ($1, $2, true, 'APROBADO',
           ST_SetSRID(ST_MakePoint(-74.1, 4.7), 4326)::geography, $3)`,
        [id, `RLS ${suffixId}`, tenantId]
      );
      await client.query(
        `INSERT INTO provider_live_locations
           (provider_id, location, accuracy_meters, captured_at)
         VALUES ($1, ST_SetSRID(ST_MakePoint(-74.1, 4.7), 4326)::geography, 8, NOW())`,
        [id]
      );
    }

    await client.query('SET LOCAL ROLE app_rls_user');
    await client.query("SELECT set_config('app.user_id', $1, true)", [String(providerA)]);

    const ownRead = await client.query(
      'SELECT provider_id FROM provider_live_locations ORDER BY provider_id'
    );
    if (ownRead.rowCount !== 1 || Number(ownRead.rows[0].provider_id) !== providerA) {
      throw new Error('app_rls_user pudo leer ubicaciones ajenas o no pudo leer la ubicación propia.');
    }

    const ownUpdate = await client.query(
      `UPDATE provider_live_locations SET captured_at = NOW()
        WHERE provider_id = $1 RETURNING provider_id`,
      [providerA]
    );
    if (ownUpdate.rowCount !== 1) throw new Error('El proveedor no pudo actualizar su ubicación.');

    const foreignUpdate = await client.query(
      `UPDATE provider_live_locations SET captured_at = NOW()
        WHERE provider_id = $1 RETURNING provider_id`,
      [providerB]
    );
    if (foreignUpdate.rowCount !== 0) throw new Error('El proveedor pudo actualizar una ubicación ajena.');

    await client.query('SAVEPOINT unauthorized_insert');
    let foreignInsertDenied = false;
    try {
      await client.query(
        `INSERT INTO provider_live_locations
           (provider_id, location, accuracy_meters, captured_at)
         VALUES ($1, ST_SetSRID(ST_MakePoint(-74.1, 4.7), 4326)::geography, 8, NOW())`,
        [providerB]
      );
    } catch (error) {
      if (error.code !== '42501') throw error;
      foreignInsertDenied = true;
      await client.query('ROLLBACK TO SAVEPOINT unauthorized_insert');
    }
    if (!foreignInsertDenied) throw new Error('El proveedor pudo insertar una ubicación ajena.');

    const foreignDelete = await client.query(
      'DELETE FROM provider_live_locations WHERE provider_id = $1 RETURNING provider_id',
      [providerB]
    );
    if (foreignDelete.rowCount !== 0) throw new Error('El proveedor pudo eliminar una ubicación ajena.');

    const ownDelete = await client.query(
      'DELETE FROM provider_live_locations WHERE provider_id = $1 RETURNING provider_id',
      [providerA]
    );
    if (ownDelete.rowCount !== 1) throw new Error('El proveedor no pudo eliminar su ubicación.');

    await client.query('SET LOCAL ROLE app_system');
    const systemRead = await client.query('SELECT provider_id FROM provider_live_locations ORDER BY provider_id');
    if (systemRead.rowCount !== 2) throw new Error('app_system no pudo leer el directorio cross-tenant.');

    const systemDelete = await client.query(
      'DELETE FROM provider_live_locations WHERE provider_id = $1 RETURNING provider_id',
      [providerB]
    );
    if (systemDelete.rowCount !== 1) throw new Error('app_system no pudo purgar una ubicación.');

    await client.query('ROLLBACK');
    console.log('[OK] RLS de ubicación: propietario aislado; app_system puede leer y purgar.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[ERROR] Verificación RLS de ubicación móvil: ${error.message}`);
  process.exit(1);
});
