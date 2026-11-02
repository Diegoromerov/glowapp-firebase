#!/usr/bin/env node
/**
 * backend/scripts/purgeRagKnowledge.js
 * Script de rollback/limpieza de ingesta RAG
 * Elimina chunks por source metadata (no borra toda la tabla)
 * 
 * Uso:
 *   node scripts/purgeRagKnowledge.js --source=corpus --dry-run
 *   node scripts/purgeRagKnowledge.js --source=corpus --confirm
 *   node scripts/purgeRagKnowledge.js --source=all --confirm
 *   npm run purge:rag -- --source=corpus --dry-run
 */

const { pool } = require('../src/config/db');
const { sanitizeForLog } = require('../src/utils/piiSanitizer');
require('dotenv').config();

/**
 * Parsing de argumentos CLI
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    source: null,
    dryRun: true,
    confirm: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source':
        parsed.source = args[++i];
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--confirm':
        parsed.dryRun = false;
        parsed.confirm = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
    }
  }

  return parsed;
}

/**
 * Muestra ayuda
 */
function showHelp() {
  console.log(`
Uso: node scripts/purgeRagKnowledge.js --source=<fuente> [opciones]

OBLIGATORIO:
  --source <corpus|sql|all>  Fuente a eliminar (corpus, sql, o 'all' para todo)

OPCIONES:
  --dry-run                  Simula sin borrar (DEFAULT)
  --confirm                  Ejecuta eliminación REAL (requerido para borrar)
  --help, -h                 Mostrar esta ayuda

EJEMPLOS:
  # Ver qué se borraría (seguro)
  node scripts/purgeRagKnowledge.js --source=corpus --dry-run
  npm run purge:rag -- --source=corpus --dry-run

  # Borrar realmente (requiere --confirm)
  node scripts/purgeRagKnowledge.js --source=corpus --confirm
  npm run purge:rag -- --source=corpus --confirm

  # Borrar TODO (peligroso)
  node scripts/purgeRagKnowledge.js --source=all --confirm

NOTA: 
  - Por defecto es DRY-RUN (no borra nada)
  - Para borrar de verdad DEBES usar --confirm
  - 'source' se refiere al campo metadata->source en la tabla
`);
}

/**
 * Valida argumentos
 */
function validateArgs(args) {
  if (args.help) return { valid: false, help: true };
  
  if (!args.source) {
    return { valid: false, error: 'Falta --source. Use: corpus, sql, o all' };
  }
  
  if (!['corpus', 'sql', 'all'].includes(args.source)) {
    return { valid: false, error: 'Source inválido. Use: corpus, sql, o all' };
  }
  
  if (!args.dryRun && !args.confirm) {
    return { valid: false, error: 'Para borrar de verdad use --confirm. Por defecto es dry-run.' };
  }
  
  return { valid: true };
}

/**
 * Cuenta chunks a eliminar
 */
async function countChunksToDelete(source) {
  let query, params;
  
  if (source === 'all') {
    query = `SELECT COUNT(*) as total FROM beauty_knowledge_embeddings`;
    params = [];
  } else {
    query = `
      SELECT COUNT(*) as total 
      FROM beauty_knowledge_embeddings 
      WHERE metadata->>'source' = $1
    `;
    params = [source];
  }
  
  const res = await pool.query(query, params);
  return parseInt(res.rows[0].total, 10);
}

/**
 * Obtiene muestra de chunks a eliminar (para dry-run)
 */
async function getSampleChunks(source, limit = 10) {
  let query, params;
  
  if (source === 'all') {
    query = `
      SELECT id, title, category, metadata->>'source' as source, 
             left(content, 100) as preview
      FROM beauty_knowledge_embeddings
      ORDER BY created_at DESC
      LIMIT $1
    `;
    params = [limit];
  } else {
    query = `
      SELECT id, title, category, metadata->>'source' as source,
             left(content, 100) as preview
      FROM beauty_knowledge_embeddings
      WHERE metadata->>'source' = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    params = [source, limit];
  }
  
  const res = await pool.query(query, params);
  return res.rows;
}

/**
 * Elimina chunks por source
 */
async function deleteChunks(source) {
  let query, params;
  
  if (source === 'all') {
    query = `DELETE FROM beauty_knowledge_embeddings`;
    params = [];
  } else {
    query = `
      DELETE FROM beauty_knowledge_embeddings 
      WHERE metadata->>'source' = $1
    `;
    params = [source];
  }
  
  const res = await pool.query(query, params);
  return res.rowCount;
}

/**
 * Función principal
 */
async function main() {
  const args = parseCliArgs();
  
  if (args.help) {
    showHelp();
    process.exit(0);
  }
  
  const validation = validateArgs(args);
  if (!validation.valid) {
    if (validation.help) {
      showHelp();
      process.exit(0);
    }
    console.error('❌', validation.error);
    console.log('');
    showHelp();
    process.exit(1);
  }
  
  const { source, dryRun, confirm } = args;
  const mode = dryRun ? 'DRY-RUN (simulación)' : 'ELIMINACIÓN REAL';
  
  console.log('🗑️  PURGE RAG KNOWLEDGE');
  console.log('='.repeat(50));
  console.log(`   Fuente: ${source}`);
  console.log(`   Modo: ${mode}`);
  console.log('');
  
  try {
    // 1. Contar chunks a afectar
    console.log('🔍 Contando chunks afectados...');
    const totalCount = await countChunksToDelete(source);
    
    if (totalCount === 0) {
      console.log('✅ No hay chunks para eliminar');
      process.exit(0);
    }
    
    console.log(`   Total chunks a afectar: ${totalCount}`);
    
    // 2. Mostrar muestra
    console.log('\n📋 Muestra de chunks a eliminar:');
    const sample = await getSampleChunks(source, 10);
    for (const chunk of sample) {
      console.log(`   - [${chunk.category}] ${sanitizeForLog(chunk.title)} (source: ${chunk.source})`);
      console.log(`     "${sanitizeForLog(chunk.preview)}..."`);
    }
    
    if (sample.length < totalCount) {
      console.log(`   ... y ${totalCount - sample.length} más`);
    }
    
    // 3. Confirmación final para modo real
    if (!dryRun) {
      console.log('\n⚠️  ADVERTENCIA: Esto ELIMINARÁ permanentemente', totalCount, 'chunks');
      console.log('   Esta acción NO se puede deshacer.');
      console.log('   Se requiere confirmación explícita con --confirm');
      
      if (!confirm) {
        console.log('\n❌ Falta --confirm. Ejecuta con --confirm para proceder.');
        process.exit(1);
      }
      
      console.log('\n🗑️  Ejecutando eliminación...');
      const deleted = await deleteChunks(source);
      console.log(`✅ Eliminados ${deleted} chunks`);
    } else {
      console.log('\n🔍 DRY-RUN completado. No se eliminó nada.');
      console.log('   Para ejecutar realmente: añade --confirm');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Parsing simple de CLI
 */
function parseCliArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    source: null,
    dryRun: true,
    confirm: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source':
        parsed.source = args[++i];
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--confirm':
        parsed.dryRun = false;
        parsed.confirm = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
    }
  }

  return parsed;
}

/**
 * Muestra ayuda
 */
function showHelp() {
  console.log(`
Uso: node scripts/purgeRagKnowledge.js --source=<fuente> [opciones]

OBLIGATORIO:
  --source <corpus|sql|all>  Fuente a eliminar (corpus, sql, o 'all' para todo)

OPCIONES:
  --dry-run                  Simula sin borrar (DEFAULT)
  --confirm                  Ejecuta eliminación REAL (requerido para borrar)
  --help, -h                 Mostrar esta ayuda

EJEMPLOS:
  # Ver qué se borraría (seguro)
  node scripts/purgeRagKnowledge.js --source=corpus --dry-run
  npm run purge:rag -- --source=corpus --dry-run

  # Borrar realmente (requiere --confirm)
  node scripts/purgeRagKnowledge.js --source=corpus --confirm
  npm run purge:rag -- --source=corpus --confirm

  # Borrar TODO (peligroso)
  node scripts/purgeRagKnowledge.js --source=all --confirm

NOTA: 
  - Por defecto es DRY-RUN (no borra nada)
  - Para borrar de verdad DEBES usar --confirm
  - 'source' se refiere al campo metadata->source en la tabla
`);
  process.exit(0);
}

/**
 * Valida argumentos
 */
function validateArgs(args) {
  if (args.help) return { valid: false, help: true };
  
  if (!args.source) {
    return { valid: false, error: 'Falta --source. Use: corpus, sql, o all' };
  }
  
  if (!['corpus', 'sql', 'all'].includes(args.source)) {
    return { valid: false, error: 'Source inválido. Use: corpus, sql, o all' };
  }
  
  if (!args.dryRun && !args.confirm) {
    return { valid: false, error: 'Para borrar de verdad use --confirm. Por defecto es dry-run.' };
  }
  
  return { valid: true };
}

// Ejecutar si es script principal
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Error no capturado:', error);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  countChunksToDelete,
  getSampleChunks,
  deleteChunks,
};