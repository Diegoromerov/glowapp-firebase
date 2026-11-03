// backend/src/config/migrationRunner.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('./db');

/**
 * Filtro único de migraciones aplicables.
 * Los archivos `.down.sql` son ROLLBACKS y jamás deben ejecutarse en un arranque
 * ni en una migración automática: solo a mano y a propósito. El rollback de la 035
 * hace `ALTER TABLE beauty_knowledge_embeddings DROP COLUMN IF EXISTS embedding`, así
 * que al ordenar alfabéticamente se ejecutaba ANTES del `up` y destruía los embeddings
 * del RAG en cada arranque (A360-2026-09-22/C-01).
 */
const esMigracionAplicable = (f) => f.endsWith('.sql') && !f.endsWith('.down.sql');

async function runMigrations() {
  console.log('🔄 [MIGRATION RUNNER] Iniciando verificación de migraciones...');
  const migrationsDir = path.join(__dirname, '../../migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.log('⚠️ No se encontró la carpeta de migraciones.');
    return;
  }

  // Ensure pgvector extension is available before running vector-dependent migrations
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('✅ Extensión pgvector verificada/disponible');
  } catch (extErr) {
    console.warn('⚠️ No se pudo crear extensión pgvector (requiere superusuario):', extErr.message);
  }

  const files = fs.readdirSync(migrationsDir).filter(esMigracionAplicable).sort();
  console.log(`🔍 Encontradas ${files.length} migraciones SQL aplicables en ${migrationsDir}`);

  // Asegurar tabla de control de migraciones
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;');

  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);

    // Sin transacción explícita: hay migraciones (CREATE INDEX CONCURRENTLY,
    // ALTER TYPE ... ADD VALUE en PG < 12) que no pueden convivir con una, y el
    // BEGIN/COMMIT anterior sobre `pool.query` ni siquiera cubría la migración
    // (cada llamada podía usar una conexión distinta del pool). Si una migración
    // falla parcialmente NO se registra, así que se reintenta sin mentir sobre el estado.
    const client = await pool.connect();
    try {
      const checkRes = await client.query('SELECT checksum FROM schema_migrations WHERE filename = $1', [file]);
      if (checkRes.rows.length > 0) {
        if (checkRes.rows[0].checksum && checkRes.rows[0].checksum !== checksum) {
          console.warn(`⚠️ [DRIFT] ${file} cambió después de aplicarse (${checkRes.rows[0].checksum} → ${checksum}). No se re-aplica.`);
        }
        skippedCount++;
        continue;
      }

      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING',
        [file, checksum]
      );

      console.log(`✅ [MIGRACIÓN APLICADA] ${file}`);
      appliedCount++;
    } catch (err) {
      console.warn(`ℹ️ Migración ${file} no aplicada (ya existía o error idempotente): ${err.message}`);
    } finally {
      client.release();
    }
  }

  console.log(`🎉 [MIGRATION RUNNER] Proceso completado. ${appliedCount} nuevas migraciones aplicadas, ${skippedCount} ya registradas.\n`);
}

// Permitir ejecución directa vía CLI: node src/config/migrationRunner.js
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error en el runner de migraciones:', err);
      process.exit(1);
    });
}

module.exports = runMigrations;
module.exports.esMigracionAplicable = esMigracionAplicable;
