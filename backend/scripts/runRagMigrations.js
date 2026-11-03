#!/usr/bin/env node
'use strict';

/**
 * backend/scripts/runRagMigrations.js
 *
 * Runner de las migraciones del RAG (pgvector). Se separa del arranque del
 * backend a propósito: `index.js` aplica `migrations/*.sql` contra DATABASE_URL,
 * y estas migraciones viven en OTRA base (RAG_DATABASE_URL). Ejecutarlas contra
 * la base principal fallaba con errores que parecían del código:
 *   - "could not access file $libdir/vector"      → la principal no tiene pgvector
 *   - 'column "metadata" does not exist'          → la tabla real está en la RAG
 *
 *   npm run rag:migrate            # aplica pendientes
 *   npm run rag:migrate -- --dry   # muestra qué haría, sin escribir
 *
 * Registra en la tabla schema_migrations de la propia base RAG.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry');
const ragDir = path.join(__dirname, '..', 'migrations', 'rag');

function checksumOf(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 16);
}

async function main() {
  const connectionString = process.env.RAG_DATABASE_URL;
  if (!connectionString) {
    console.error('❌ RAG_DATABASE_URL no está definida: no se pueden aplicar migraciones del RAG.');
    process.exit(1);
  }
  if (!fs.existsSync(ragDir)) {
    console.log('ℹ️  No existe migrations/rag — nada que hacer.');
    return;
  }

  const files = fs
    .readdirSync(ragDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  const pool = new Pool({ connectionString, ssl: false });
  const failed = [];
  let applied = 0;
  let skipped = 0;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // La tabla ya existía en la base RAG sin `checksum` (la creó un runner anterior).
    await pool.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;');
    const { rows } = await pool.query('SELECT filename, checksum FROM schema_migrations');
    const already = new Map(rows.map((r) => [r.filename, r.checksum]));

    console.log(`🔍 ${files.length} migraciones RAG en disco · ${already.size} ya registradas.`);

    for (const file of files) {
      const filePath = path.join(ragDir, file);
      const checksum = checksumOf(filePath);

      if (already.has(file)) {
        if (already.get(file) && already.get(file) !== checksum) {
          console.warn(`⚠️  Deriva: ${file} cambió después de aplicarse (${already.get(file)} → ${checksum}).`);
        }
        skipped++;
        continue;
      }

      if (DRY) {
        console.log(`· pendiente: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(filePath, 'utf8');
      try {
        await pool.query('BEGIN');
        await pool.query(sql);
        await pool.query(
          `INSERT INTO schema_migrations (filename, checksum)
           VALUES ($1, $2)
           ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW()`,
          [file, checksum]
        );
        await pool.query('COMMIT');
        applied++;
        console.log(`✅ ${file}`);
      } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        failed.push({ file, error: err.message });
        console.error(`❌ ${file}: ${err.message}`);
      }
    }

    console.log(`\nResumen: ${applied} aplicadas · ${skipped} ya registradas · ${failed.length} con error.`);
    if (failed.length > 0) {
      console.log('Las que fallaron NO quedaron registradas; corregirlas y volver a ejecutar.');
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Error inesperado:', err.message);
  process.exit(1);
});
