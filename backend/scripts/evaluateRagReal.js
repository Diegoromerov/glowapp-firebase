#!/usr/bin/env node
/**
 * backend/scripts/evaluateRagReal.js
 * R5-B — Evaluación REAL del RAG contra BD local + corpus canónico + dataset v2
 * Ejecuta SOLO las queries VALID del dataset v2 (18) contra la BD local.
 * Genera: reporte JSON + baseline real (R5-B/REAL/LOCAL)
 *
 * Uso: node scripts/evaluateRagReal.js [--output=path] [--verbose]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { searchBeautyKnowledge } = require('../src/services/ragService');
const { runEvaluationSuite } = require('../src/services/ragEvaluator');
const { checkQualityGates, generateQualityGatesReport } = require('../src/config/qualityGates');

const DATASET_PATH = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const CORPUS_PATH = path.join(__dirname, '..', 'src', 'data', 'corpus_canonico', 'corpus_canonico.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    output: path.join(__dirname, '..', 'src', 'data', 'eval', `evaluation_real_${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    verbose: args.includes('--verbose'),
    topK: 5,
  };
  const outIdx = args.indexOf('--output');
  if (outIdx >= 0 && args[outIdx + 1]) opts.output = path.resolve(args[outIdx + 1]);
  const topIdx = args.indexOf('--topK');
  if (topIdx >= 0 && args[topIdx + 1]) opts.topK = parseInt(args[topIdx + 1], 10);
  return opts;
}

async function main() {
  const opts = parseArgs();

  // ── Verificación de seguridad: BD debe ser local ──
  const url = process.env.RAG_DATABASE_URL || '';
  const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
  if (!isLocal) {
    console.error('🚫 RAG_DATABASE_URL NO apunta a BD local. Abortando evaluación (seguridad).');
    process.exit(1);
  }
  console.log('✅ RAG_DATABASE_URL LOCAL verificada');
  const dbInfo = await ragPool.query('SELECT current_database() AS db, current_user AS usr');
  console.log(`   BD: ${dbInfo.rows[0].db} | user: ${dbInfo.rows[0].usr}`);

  // ── Cargar dataset v2 + corpus ──
  const ds = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));

  const validQueries = ds.queries.filter(q => q.status === 'VALID');
  console.log(`\n📋 Dataset v2: ${ds.queries.length} queries | VALID: ${validQueries.length} | UNSUPPORTED: ${ds.queries.length - validQueries.length}`);

  // Verificar que expected_chunks existen en BD (corpus ingerido)
  const expectedAll = validQueries.flatMap(q => q.expected_chunks);
  const bdRes = await ragPool.query('SELECT chunk_id FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [expectedAll]);
  const bdIds = new Set(bdRes.rows.map(r => r.chunk_id));
  const missingInBd = expectedAll.filter(e => !bdIds.has(e));
  console.log(`   Expected chunks en BD: ${expectedAll.length - missingInBd.length}/${expectedAll.length}`);
  if (missingInBd.length > 0) {
    console.log(`   ⚠️ Faltan en BD: ${missingInBd.length} (${missingInBd.slice(0, 5).join(', ')}...)`);
  }

  // ── Ejecutar suite de evaluación (solo queries VALID) ──
  const evalDataset = { ...ds, queries: validQueries };
  const result = await runEvaluationSuite(evalDataset, {
    topK: opts.topK,
    generateAnswers: false, // R5-B: solo retrieval (la generación es simulación, no RAGAS)
    verbose: opts.verbose,
  });

  // ── Quality gates ──
  const gates = checkQualityGates(result);
  const gatesReport = generateQualityGatesReport ? generateQualityGatesReport(gates) : null;

  // ── Baseline real ──
  const baseline = {
    dataset_version: ds.version,
    corpus_version: corpus.corpus_version,
    timestamp: new Date().toISOString(),
    label: 'R5-B / REAL / LOCAL',
    total_queries: validQueries.length,
    total_expected_chunks: expectedAll.length,
    retrieval: result.summary.retrieval,
    context: result.summary.context,
    latency: result.summary.latency,
    quality_gates: gates,
  };
  const baselinePath = path.join(__dirname, '..', 'src', 'data', 'eval', 'baseline_real_r5b.json');
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));

  // ── Reporte completo ──
  const report = {
    ...result,
    dataset_version: ds.version,
    corpus_version: corpus.corpus_version,
    queries_valid: validQueries.length,
    queries_unsupported: ds.queries.length - validQueries.length,
    expected_chunks_total: expectedAll.length,
    expected_chunks_in_bd: expectedAll.length - missingInBd.length,
    baseline_path: baselinePath,
  };
  fs.writeFileSync(opts.output, JSON.stringify(report, null, 2));

  // ── Output resumen ──
  console.log('\n' + '='.repeat(60));
  console.log('📊 EVALUACIÓN REAL R5-B — RESUMEN');
  console.log('='.repeat(60));
  const r = result.summary.retrieval;
  console.log(`   Precision@1: ${r.precision_at_1} | @3: ${r.precision_at_3} | @5: ${r.precision_at_5}`);
  console.log(`   Recall@1:    ${r.recall_at_1} | @3: ${r.recall_at_3} | @5: ${r.recall_at_5}`);
  console.log(`   MRR:         ${r.mrr}`);
  console.log(`   Top-K Acc:   ${r.top_k_accuracy}`);
  console.log(`   Context P:   ${result.summary.context.precision} | R: ${result.summary.context.recall}`);
  console.log(`   Latencia avg: ${result.summary.latency.avg_ms}ms | p95: ${result.summary.latency.p95_ms}ms`);
  console.log(`   Quality gates: ${gates.passed ? 'PASS' : 'FAIL'}`);
  console.log(`📁 Reporte: ${opts.output}`);
  console.log(`📁 Baseline: ${baselinePath}`);
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
