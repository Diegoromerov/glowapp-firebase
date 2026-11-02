#!/usr/bin/env node
/**
 * backend/scripts/ingestBeautyKnowledge.js
 * Script principal de ingesta RAG para poblar beauty_knowledge_embeddings
 * Idempotente, rate-limited, con progreso y métricas
 * 
 * Uso:
 *   node scripts/ingestBeautyKnowledge.js --source=corpus
 *   node scripts/ingestBeautyKnowledge.js --source=sql
 *   node scripts/ingestBeautyKnowledge.js --source=corpus --dry-run
 *   node scripts/ingestBeautyKnowledge.js --source=corpus --limit=50
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');
const { chunkMarkdownDocument, processDocumentWithFrontmatter } = require('../src/services/chunkingService');
const { enrichChunkMetadata } = require('../src/services/metadataEnricher');
const { generateEmbedding, generateBatchEmbeddings } = require('../src/services/embeddingService');
const { sanitizeForLog } = require('../src/utils/piiSanitizer');
require('dotenv').config();

/**
 * Configuración del script
 */
const CONFIG = {
  batchSize: 10,           // chunks por lote para embeddings
  delayBetweenBatches: 100, // ms entre lotes (10 chunks/seg = 100ms)
  maxConcurrent: 1,        // concurrencia de embeddings
  defaultSource: 'corpus',
};

/**
 * Parsing de argumentos CLI
 * @returns {Object} Argumentos parseados
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    source: CONFIG.defaultSource,
    dryRun: false,
    limit: null,
    verbose: false,
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
      case '--limit':
        parsed.limit = parseInt(args[++i], 10);
        break;
      case '--verbose':
        parsed.verbose = true;
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
Uso: node scripts/ingestBeautyKnowledge.js [opciones]

Opciones:
  --source <corpus|sql>    Fuente de datos (default: corpus)
  --dry-run                Simula sin escribir en BD
  --limit <n>              Limitar número de documentos a procesar
  --verbose                Log detallado
  --help, -h               Mostrar esta ayuda

Ejemplos:
  node scripts/ingestBeautyKnowledge.js --source=corpus
  node scripts/ingestBeautyKnowledge.js --source=corpus --dry-run
  node scripts/ingestBeautyKnowledge.js --source=sql --limit=10
  npm run ingest:rag -- --source=corpus --dry-run
`);
}

/**
 * Lee y parsea un archivo markdown con frontmatter YAML
 * @param {string} filePath - Ruta al archivo
 * @returns {Object|null} Documento parseado o null si error
 */
function parseMarkdownFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Extraer frontmatter YAML
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    
    let metadata = {};
    let markdownContent = content;
    
    if (match) {
      const yamlContent = match[1];
      markdownContent = content.slice(match[0].length).trim();
      
      // Parse simple YAML (key: value)
      const lines = yamlContent.split('\n');
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.slice(0, colonIndex).trim();
          const value = line.slice(colonIndex + 1).trim();
          // Manejar arrays YAML simples
          if (value.startsWith('[') && value.endsWith(']')) {
            try {
              metadata[key] = JSON.parse(value.replace(/'/g, '"'));
            } catch {
              metadata[key] = value;
            }
          } else {
            metadata[key] = value.replace(/^['"]|['"]$/g, ''); // quitar comillas
          }
        }
      }
    }
    
    return {
      filePath,
      metadata,
      content: markdownContent,
    };
  } catch (error) {
    console.error(`❌ Error leyendo ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Lee todos los archivos markdown del corpus
 * @param {string} corpusDir - Directorio del corpus
 * @returns {Array<Object>} Documentos parseados
 */
function readCorpus(corpusDir) {
  const files = fs.readdirSync(corpusDir)
    .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
    .sort();
  
  const documents = [];
  
  for (const file of files) {
    const filePath = path.join(corpusDir, file);
    const doc = parseMarkdownFile(filePath);
    if (doc) {
      documents.push(doc);
    }
  }
  
  return documents;
}

/**
 * Lee documentos del seed SQL (para migración histórica)
 * @returns {Array<Object>} Documentos del SQL
 */
async function readSqlSeed() {
  // Leer del seed_beauty_knowledge.sql existente
  const sqlPath = path.join(__dirname, '..', 'sql', 'seed_beauty_knowledge.sql');
  if (!fs.existsSync(sqlPath)) {
    console.warn('⚠️ Archivo seed_beauty_knowledge.sql no encontrado');
    return [];
  }
  
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  
  // Parse simple de INSERTs - extraer title, category, content, metadata
  const insertRegex = /INSERT INTO beauty_knowledge_embeddings\s*\([^)]+\)\s*VALUES\s*\(([\s\S]*?)\)\s*ON CONFLICT/gi;
  const documents = [];
  
  let match;
  while ((match = insertRegex.exec(sqlContent)) !== null) {
    const values = match[1];
    // Parse simple de valores - esto es aproximado
    // En producción, mejor parsear el SQL original directamente
  }
  
  console.log('ℹ️ Parseo SQL no implementado completamente, usar corpus markdown');
  return [];
}

/**
 * Procesa un documento: chunking + metadata + embeddings
 * @param {Object} doc - Documento con metadata y content
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Array<Object>>} Chunks procesados listos para insertar
 */
async function processDocument(doc, options = {}) {
  const { dryRun, verbose } = options;
  const { content, filePath } = doc;
  // content aquí ya viene con frontmatter incluido (raw content del archivo)
  
  if (!content || content.trim().length < 50) {
    console.warn(`⚠️ Contenido muy corto en ${filePath}, omitiendo`);
    return [];
  }

  // 1. Chunking semántico + extracción metadata semántica (frontmatter + contenido)
  // Usar la nueva función unificada que maneja frontmatter + chunking + metadata semántica
  const { processDocumentWithFrontmatter } = require('../src/services/chunkingService');
  const chunks = processDocumentWithFrontmatter(content, {
    maxTokens: 600,
    overlapTokens: 50,
    respectSentences: true,
    respectParagraphs: true,
  });

  if (verbose) {
    console.log(`📄 ${path.basename(filePath)}: ${chunks.length} chunks generados`);
  }

  // 2. Generar embeddings (metadata ya viene enriquecida en chunk.metadata)
  const processedChunks = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    try {
      // Metadata ya viene enriquecida (frontmatter + semántica)
      const enrichedMetadata = chunk.metadata || {};

      // Identidad del chunk (046/048): document_id + chunk_id es la clave única aplicada
      // en beauty_knowledge_embeddings. content_hash se calcula si el chunker no lo trae.
      const contentHash = chunk.contentHash
        || require('crypto').createHash('sha256').update(chunk.content).digest('hex');

      // Generar embedding (input_type='passage' para indexar)
      const embedding = await require('../src/services/embeddingService').generateEmbedding(
        chunk.content,
        'passage'
      );

      processedChunks.push({
        title: `${enrichedMetadata.title || 'Sin título'} - Parte ${chunk.index + 1}`,
        category: enrichedMetadata.category || 'skincare',
        content: chunk.content,
        metadata: {
          ...enrichedMetadata,
          chunkIndex: chunk.index,
          totalChunks: chunk.totalChunks,
          sectionTitle: chunk.sectionTitle,
          sectionLevel: chunk.sectionLevel,
        },
        embedding,
        source: enrichedMetadata.source || 'corpus',
        sourceFile: filePath,
        contentHash,
        documentId: path.basename(filePath),
        documentVersion: String(enrichedMetadata.version || '1.0'),
        chunkId: contentHash,
        fuente: enrichedMetadata.source || 'corpus',
        seccion: chunk.sectionTitle || null,
        skinType: enrichedMetadata.skin_type,
        seasonStation: enrichedMetadata.season_station,
        ageRange: enrichedMetadata.age_range,
        ingredients: enrichedMetadata.ingredients,
        contraindications: enrichedMetadata.contraindications,
      });

      if (verbose) {
        console.log(`  ✅ Chunk ${i + 1}/${chunks.length}: ${require('../src/utils/piiSanitizer').sanitizeForLog(chunk.content.slice(0, 80))}`);
      }

    } catch (error) {
      console.error(`❌ Error procesando chunk ${i + 1} de ${filePath}:`, error.message);
      // Continuar con siguiente chunk
    }
  }

  return processedChunks;
}

/**
 * Upsert de chunks en BD (idempotente por content_hash)
 * @param {Array<Object>} chunks - Chunks a insertar
 * @param {boolean} dryRun - Si true, no escribe en BD
 * @returns {Promise<Object>} Resultado { inserted, updated, errors }
 */
async function upsertChunks(chunks, dryRun = false) {
  if (chunks.length === 0) return { inserted: 0, updated: 0, errors: 0 };
  
  let inserted = 0;
  let updated = 0;
  let errors = 0;
  
  for (const chunk of chunks) {
    try {
      // Identidad de upsert = (document_id, chunk_id): UK real de la tabla
      // (uk_beauty_knowledge_chunk_identity, 046 + 048). `ON CONFLICT (title)` no
      // coincidía con ninguna constraint -> cada re-ingesta duplicaba filas.
      const sql = `
        INSERT INTO beauty_knowledge_embeddings 
        (title, category, content, metadata, embedding, skin_type, season_station, age_range, ingredients, contraindications,
         document_id, document_version, chunk_id, content_hash, fuente, seccion)
        VALUES ($1, $2, $3, $4, $5::halfvec, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (document_id, chunk_id) DO UPDATE SET
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          content = EXCLUDED.content,
          metadata = EXCLUDED.metadata,
          embedding = EXCLUDED.embedding,
          skin_type = EXCLUDED.skin_type,
          season_station = EXCLUDED.season_station,
          age_range = EXCLUDED.age_range,
          ingredients = EXCLUDED.ingredients,
          contraindications = EXCLUDED.contraindications,
          document_version = EXCLUDED.document_version,
          content_hash = EXCLUDED.content_hash,
          fuente = EXCLUDED.fuente,
          seccion = EXCLUDED.seccion,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted;
      `;
      
      if (dryRun) {
        console.log(`[DRY-RUN] Upsert: ${require('../src/utils/piiSanitizer').sanitizeForLog(chunk.title)}`);
        continue;
      }
      
      const res = await pool.query(sql, [
        chunk.title,
        chunk.category,
        chunk.content,
        JSON.stringify(chunk.metadata),
        `[${chunk.embedding.join(',')}]`,
        chunk.skinType,
        chunk.seasonStation,
        chunk.ageRange,
        chunk.ingredients || null,
        chunk.contraindications || null,
        chunk.documentId,
        chunk.documentVersion,
        chunk.chunkId,
        chunk.contentHash,
        chunk.fuente,
        chunk.seccion,
      ]);
      
      if (res.rows[0]?.inserted) {
        inserted++;
      } else {
        updated++;
      }
      
    } catch (error) {
      console.error(`❌ Error upsert ${require('../src/utils/piiSanitizer').sanitizeForLog(chunk.title)}:`, error.message);
      errors++;
    }
  }
  
  return { inserted, updated, errors };
}

/**
 * Función principal de ingesta
 */
async function main() {
  const args = parseArgs();
  
  if (args.help) {
    showHelp();
    process.exit(0);
  }
  
  const startTime = Date.now();
  const stats = {
    documentsProcessed: 0,
    chunksGenerated: 0,
    chunksInserted: 0,
    chunksUpdated: 0,
    errors: 0,
  };
  
  console.log('🚀 Iniciando ingesta RAG...');
  console.log(`   Fuente: ${args.source}`);
  console.log(`   Dry-run: ${args.dryRun ? 'SÍ' : 'NO'}`);
  console.log(`   Límite: ${args.limit || 'sin límite'}`);
  console.log('');
  
  try {
    // 1. Leer documentos según fuente
    let documents = [];
    
    if (args.source === 'corpus') {
      const corpusDir = path.join(__dirname, '..', 'src', 'data', 'beauty_corpus');
      if (!fs.existsSync(corpusDir)) {
        console.error(`❌ Directorio corpus no existe: ${corpusDir}`);
        process.exit(1);
      }
      documents = readCorpus(corpusDir);
      console.log(`📚 Documentos encontrados en corpus: ${documents.length}`);
    } else if (args.source === 'sql') {
      documents = await readSqlSeed();
      console.log(`📚 Documentos desde SQL seed: ${documents.length}`);
    } else {
      console.error(`❌ Fuente desconocida: ${args.source}. Use 'corpus' o 'sql'`);
      process.exit(1);
    }
    
    if (args.limit) {
      documents = documents.slice(0, args.limit);
      console.log(`🔢 Limitado a ${documents.length} documentos`);
    }
    
    if (documents.length === 0) {
      console.log('⚠️ No hay documentos para procesar');
      return;
    }
    
    // 2. Procesar cada documento
    console.log('\n🔄 Procesando documentos...\n');
    
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const docName = path.basename(doc.filePath);
      
      console.log(`[${i + 1}/${documents.length}] Procesando: ${docName}`);
      
      const chunks = await processDocument(doc, { dryRun: args.dryRun, verbose: args.verbose });
      
      if (chunks.length === 0) {
        console.log(`  ⚠️ Sin chunks válidos`);
        continue;
      }
      
      stats.chunksGenerated += chunks.length;
      
      // Rate limiting: delay entre documentos
      if (i > 0 && !args.dryRun) {
        await new Promise(r => setTimeout(r, 100));
      }
      
      // 3. Upsert en BD
      const result = await upsertChunks(chunks, args.dryRun);
      stats.chunksInserted += result.inserted;
      stats.chunksUpdated += result.updated;
      stats.errors += result.errors;
      
      console.log(`  ✅ ${result.inserted} insertados, ${result.updated} actualizados, ${result.errors} errores`);
      stats.documentsProcessed++;
    }
    
  } catch (error) {
    console.error('❌ Error fatal:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
  
  // Resumen final
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(50));
  console.log('📊 RESUMEN DE INGESTA');
  console.log('='.repeat(50));
  console.log(`   Documentos procesados: ${stats.documentsProcessed}`);
  console.log(`   Chunks generados: ${stats.chunksGenerated}`);
  console.log(`   Chunks insertados: ${stats.chunksInserted}`);
  console.log(`   Chunks actualizados: ${stats.chunksUpdated}`);
  console.log(`   Errores: ${stats.errors}`);
  console.log(`   Duración: ${duration}s`);
  console.log(`   Dry-run: ${args.dryRun ? 'SÍ' : 'NO'}`);
  console.log('='.repeat(50));
  
  if (stats.errors > 0) {
    console.log('\n⚠️ Hubo errores durante la ingesta. Revisar logs.');
    process.exit(1);
  }
  
  console.log('\n✅ Ingesta completada exitosamente');
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
  readCorpus,
  parseMarkdownFile,
  processDocument,
  upsertChunks,
};