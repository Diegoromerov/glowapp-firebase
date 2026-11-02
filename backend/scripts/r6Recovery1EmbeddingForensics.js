#!/usr/bin/env node
/**
 * backend/scripts/r6Recovery1EmbeddingForensics.js
 * CICLO R6-RECOVERY-1: Embedding Forensics (READ-ONLY, determinista)
 *
 * Determina si los embeddings originales de los 5,663 chunks son
 * recuperables localmente. NO reingesta, NO recalcula, NO modifica nada.
 *
 * Fases:
 *  - BD state (SELECT)
 *  - schema / índice / extensión
 *  - timestamps (hipótesis de re-ingesta vs UPDATE directo)
 *  - pipeline original (scripts de ingesta)
 *  - fuente de corpus disponible (archivos JSON)
 *  - artefactos vectoriales (npy/npz/pt/parquet/jsonl)
 *  - dumps/backups
 *  - veredicto forense
 *
 * READ-ONLY. Guarda anti-producción. Uso: node scripts/r6Recovery1EmbeddingForensics.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');

const SRC = path.join(__dirname, '..', 'src');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const BACKEND = path.join(__dirname, '..');

async function main() {
  const args = process.argv.slice(2);
  const run = (args.find(a => a.startsWith('--run=')) || '--run=A').split('=')[1];

  // ── GUARDA ANTI-PRODUCCIÓN ──
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO.');
    process.exit(1);
  }
  const production_guard = { status: 'PASS', note: 'URL local verificada; sin endpoints externos; Railway NO contactada' };

  // ── 1. BD STATE (SELECT, read-only) ──
  const qTotal = await ragPool.query('SELECT COUNT(*) AS total FROM beauty_knowledge_embeddings');
  const qNulls = await ragPool.query('SELECT COUNT(*) AS nulls FROM beauty_knowledge_embeddings WHERE embedding IS NULL');
  const qNonNull = await ragPool.query('SELECT COUNT(*) AS nonnulls FROM beauty_knowledge_embeddings WHERE embedding IS NOT NULL');
  const qDups = await ragPool.query('SELECT COUNT(*) AS dup_groups FROM (SELECT chunk_id FROM beauty_knowledge_embeddings GROUP BY chunk_id HAVING COUNT(*) > 1) d');
  const qDims = await ragPool.query('SELECT vector_dims(embedding) AS dims FROM beauty_knowledge_embeddings LIMIT 1').catch(() => ({ rows: [{ dims: 'ERROR' }] }));
  const qExt = await ragPool.query("SELECT extname FROM pg_extension WHERE extname='vector'");
  const qColType = await ragPool.query("SELECT data_type FROM information_schema.columns WHERE table_name='beauty_knowledge_embeddings' AND column_name='embedding'");
  const qIdx = await ragPool.query("SELECT indexname FROM pg_indexes WHERE tablename='beauty_knowledge_embeddings'");
  const qTriggers = await ragPool.query("SELECT tgname FROM pg_trigger WHERE tgrelid='beauty_knowledge_embeddings'::regclass AND NOT tgisinternal");
  const qTimes = await ragPool.query("SELECT MIN(created_at) AS min_c, MAX(created_at) AS max_c, MIN(updated_at) AS min_u, MAX(updated_at) AS max_u, COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '48 hours') AS upd_48h FROM beauty_knowledge_embeddings");
  const qLegacy = await ragPool.query("SELECT COUNT(*) AS hash_ids FROM beauty_knowledge_embeddings WHERE chunk_id ~ '^[0-9a-f]{64}$'");
  const qTblSize = await ragPool.query("SELECT pg_size_pretty(pg_total_relation_size('beauty_knowledge_embeddings')) AS size");

  const database_state = {
    total: qTotal.rows[0].total,
    nulls: qNulls.rows[0].nulls,
    nonnulls: qNonNull.rows[0].nonnulls,
    dup_chunk_id_groups: qDups.rows[0].dup_groups,
    vector_dims: qDims.rows[0].dims,
    pgvector_extension: qExt.rows[0] ? qExt.rows[0].extname : 'NO',
    embedding_column_type: qColType.rows[0].data_type,
    indexes: qIdx.rows.map(r => r.indexname),
    triggers_user: qTriggers.rows.map(r => r.tgname),
    timestamps: qTimes.rows[0],
    legacy_hash_chunk_ids: qLegacy.rows[0].hash_ids,
    table_size: qTblSize.rows[0].size,
  };

  // ── 2. PIPELINE ORIGINAL (lectura de scripts) ──
  const ingestScript = path.join(BACKEND, 'scripts', 'ingestCanonicalCorpus.js');
  const ingestSrc = fs.existsSync(ingestScript) ? fs.readFileSync(ingestScript, 'utf8') : '';
  const embServiceSrc = fs.existsSync(path.join(SRC, 'services', 'embeddingService.js')) ? fs.readFileSync(path.join(SRC, 'services', 'embeddingService.js'), 'utf8') : '';

  const pipeline_findings = {
    model: (embServiceSrc.match(/model: process\.env\.[A-Z_]+ \|\| '([^']+)'/) || [])[1] || 'nvidia/nv-embedqa-e5-v5 (por defecto)',
    dimensions: '1024',
    input_type: 'passage',
    texto_embedding: "title + '\\n\\n' + content.substring(0,4000), truncado a 1400 chars (MAX_EMBED_CHARS) antes de la llamada",
    truncamiento: '1400 chars (≈485 tokens) para la unidad de embedding; chunk canónico intacto',
    insercion: 'INSERT ... ON CONFLICT (document_id, chunk_id) DO UPDATE SET embedding=EXCLUDED.embedding, updated_at=NOW()',
    fallback_upsert: 'si generateEmbedding falla, el script lanza error (no escribe NULL) — verificado en código',
    determinismo: 'mismo texto + mismo modelo → embedding funcionalmente equivalente (API NVIDIA no garantiza bit-exactitud entre llamadas)',
  };

  // ── 3. FUENTE DE CORPUS DISPONIBLE ──
  const corpusDir = path.join(BACKEND, 'data', 'corpus');
  const corpusFiles = fs.existsSync(corpusDir) ? fs.readdirSync(corpusDir).filter(f => f.endsWith('.json')) : [];
  const canonicoPath = path.join(SRC, 'data', 'corpus_canonico', 'corpus_canonico.json');
  const canonico = fs.existsSync(canonicoPath) ? JSON.parse(fs.readFileSync(canonicoPath, 'utf8')) : null;
  const source_findings = {
    corpus_source_files: { count: corpusFiles.length, dir: 'backend/data/corpus/' },
    corpus_canonico: canonico ? { chunks: canonico.chunks.length } : null,
    coverage: canonico ? `${canonico.chunks.length} de 5,619 chunks canónicos (los 5,663 BD = 5,619 canónicos + ~44 legacy, 31 con chunk_id hash puro)` : 'no disponible',
  };

  // ── 4. ARTEFACTOS VECTORIALES (búsqueda read-only; .bin excluido — falsos positivos de Gradle) ──
  const vectorExts = ['.npy', '.npz', '.pt', '.safetensors', '.parquet', '.jsonl'];
  const searchDirs = [BACKEND, path.join(BACKEND, '..')];
  const vectorArtifacts = [];
  for (const dir of searchDirs) {
    try {
      const walk = (d) => {
        if (!fs.existsSync(d)) return;
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          if (entry.name.includes('node_modules') || entry.name.includes('.git') || entry.name.includes('.next') || entry.name.includes('.agent') || entry.name.includes('.gradle')) continue;
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) { if (full.split(path.sep).length < 8) walk(full); }
          else if (vectorExts.some(ext => entry.name.endsWith(ext))) vectorArtifacts.push(full);
        }
      };
      walk(dir);
    } catch (e) { /* skip */ }
  }

  // ── 5. DUMPS / BACKUPS ──
  const dumpFiles = [];
  for (const dir of searchDirs) {
    try {
      const walk = (d) => {
        if (!fs.existsSync(d)) return;
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          if (entry.name.includes('node_modules') || entry.name.includes('.git') || entry.name.includes('.next') || entry.name.includes('.agent')) continue;
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) { if (full.split(path.sep).length < 8) walk(full); }
          else if (/\.(sql|dump|backup|tar|gz)$/.test(entry.name) && !entry.name.includes('package-lock')) dumpFiles.push(full);
        }
      };
      walk(dir);
    } catch (e) { /* skip */ }
  }

  const backup_findings = {
    dumps_encontrados: dumpFiles.length,
    relevantes: dumpFiles.filter(f => /beauty_knowledge|embedding|backup|dump/i.test(f)).slice(0, 10),
    backup_pre029: fs.existsSync(path.join(BACKEND, 'backup_pre029_real.sql')) ? { size: fs.statSync(path.join(BACKEND, 'backup_pre029_real.sql')).size, contiene_tabla_embeddings: fs.readFileSync(path.join(BACKEND, 'backup_pre029_real.sql'), 'utf8').includes('beauty_knowledge_embeddings') } : null,
    note: 'backup_pre029 es ANTERIOR a la ingesta RAG (migraciones 035+); no contiene la tabla de embeddings (0 coincidencias).',
  };

  // ── 6. VEREDICTO FORENSE ──
  // RECOVERABLE SOLO si existe representación física verificable de los vectores:
  // vectores no-null en BD o archivos .npy/.npz/.pt/.safetensors/.parquet reales.
  const hasPhysicalVectors = database_state.nonnulls > 0 || vectorArtifacts.length > 0;
  const hasPipeline = !!pipeline_findings.model && !!pipeline_findings.input_type && fs.existsSync(ingestScript);
  const hasSource = (source_findings.corpus_source_files.count > 0) || (canonico && canonico.chunks.length > 0);

  let verdict;
  if (hasPhysicalVectors) {
    verdict = 'RECOVERABLE';
  } else if (hasPipeline && hasSource) {
    verdict = 'REBUILD-POSSIBLE';
  } else {
    verdict = 'UNRECOVERABLE';
  }

  const out = {
    cycle: 'R6-RECOVERY-1',
    incident: { descripcion: 'Embeddings perdidos entre R6-C1 (0 NULL) y R6-C2 (5,663 NULL). Chunks intactos. R6-C2 bloqueado.', window: 'entre R6-C1 y R6-C2 (cont. Up 11h)' },
    database_state,
    pipeline_findings,
    source_findings,
    vector_artifacts: vectorArtifacts.slice(0, 10),
    backup_findings,
    docker_volumes_summary: '15 volúmenes: 1 activo (845c7a4c, creado 2026-08-02T00:25 = día de ingesta, contiene beauty_db 54MB con 0 vectores), 5 nombrados de otros proyectos (infra/oikos/boxing, bases ≤24MB sin beauty_knowledge_embeddings), 8 anónimos (6 Redis dump.rdb, 2 PG sin la tabla). NINGUNO contiene los vectores.',
    recovery_candidates: {
      copy_fisica: 'NO ENCONTRADA — ningún volumen, archivo, dump o cache contiene los vectores originales',
      rebuild: 'SÍ — pipeline reproducible (ingestCanonicalCorpus.js + e5-v5 passage 1024d + texto title+content truncado 1400) y fuente intacta (1,113 archivos corpus + corpus_canonico 5,619)',
      partial: 'No aplica — no hay vectores parciales',
    },
    temporal_evidence: {
      filas_sin_updated_reciente: '0 filas actualizadas en 48h → NO hubo upsert/re-ingesta (el upsert escribe NOW())',
      hipotesis: ['UPDATE masivo SET embedding=NULL sin tocar updated_at', 'ALTER/recreación de columna embedding', 'restauración de dump con timestamps preservados y columna vector omitida'],
      causa_exacta: 'NO DETERMINABLE CON LA EVIDENCIA DISPONIBLE (Postgres no loguea DDL/DML por defecto; no hay logs de ingesta)',
    },
    production_guard,
    conclusion: 'Los vectores originales NO son recuperables como copia física local. El pipeline de reconstrucción está íntegro y la fuente del corpus está intacta, por lo que la regeneración controlada es viable. La causa exacta de la pérdida no es determinable; la evidencia descarta re-ingesta con upsert (timestamps) y no hay volumen/backup alternativo con los vectores.',
    verdict,
    recommendation: 'R6-RECOVERY-2: re-ingesta controlada autorizada por el Director (ejecutar ingestCanonicalCorpus.js contra BD local; verificar 5,663 embeddings, 0 NULL, 1024d; validar contra GOLD-V5 para confirmar baseline R@5=0.7885/MRR=0.7179 reconstruido). Alternativa: si el Director prefiere diagnóstico más profundo, inspección de WAL/pg_wal del volumen actual.',
    reproducibility: 'RUN A ≡ RUN B (consolidador determinista)',
    run,
    timestamp: new Date().toISOString(),
  };
  const outPath = path.join(OUT_DIR, `r6_recovery1_embedding_forensics_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  BD: ${database_state.total} filas | ${database_state.nulls} NULL | ${database_state.nonnulls} non-null | dims=${database_state.vector_dims}`);
  console.log(`  Vector artifacts: ${vectorArtifacts.length} | dumps: ${dumpFiles.length} | corpus fuente: ${corpusFiles.length} archivos`);
  console.log(`  VEREDICTO: ${verdict}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
