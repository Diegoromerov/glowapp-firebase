#!/usr/bin/env node
// Verifica en PostgreSQL real que las métricas logísticas fallan cerrado para
// app_rls_user y siguen disponibles para tareas explícitas de app_system.
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL_ADMIN;
if (!connectionString) {
  console.error('[ERROR] DATABASE_URL_ADMIN es obligatoria para verificar RLS logística.');
  process.exit(2);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  const carrier = `rls_${process.pid}_${Date.now()}`;
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO logistica_metricas_diarias (fecha, carrier)
       VALUES (CURRENT_DATE, $1)`,
      [carrier]
    );

    await client.query('SET LOCAL ROLE app_rls_user');
    await client.query("SELECT set_config('app.tenant_id', '1', true)");
    const deniedRead = await client.query(
      'SELECT count(*)::int AS n FROM logistica_metricas_diarias WHERE carrier = $1',
      [carrier]
    );
    if (deniedRead.rows[0].n !== 0) {
      throw new Error('app_rls_user pudo leer una fila de métricas sin vínculo tenant/zona');
    }

    await client.query('SAVEPOINT denied_write');
    let deniedWrite = false;
    try {
      await client.query(
        `INSERT INTO logistica_metricas_diarias (fecha, carrier)
         VALUES (CURRENT_DATE, $1)`,
        [`${carrier}_write`]
      );
    } catch (error) {
      if (error.code !== '42501') throw error;
      deniedWrite = true;
      await client.query('ROLLBACK TO SAVEPOINT denied_write');
    }
    if (!deniedWrite) throw new Error('app_rls_user pudo insertar métricas sin vínculo tenant/zona');

    await client.query('RESET ROLE');
    await client.query('SET LOCAL ROLE app_system');
    const systemRead = await client.query(
      'SELECT count(*)::int AS n FROM logistica_metricas_diarias WHERE carrier = $1',
      [carrier]
    );
    if (systemRead.rows[0].n !== 1) {
      throw new Error('app_system no pudo leer la fila de verificación');
    }

    await client.query('ROLLBACK');
    console.log('[OK] app_rls_user no lee ni escribe métricas; app_system sí las lee.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[ERROR] Verificación RLS logística: ${error.message}`);
  process.exit(1);
});
