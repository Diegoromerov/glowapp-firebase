#!/usr/bin/env node
/**
 * backend/scripts/generateBaselineR5b.js
 * CICLO 11 — Consolida RUN A + RUN B en baseline_real_r5b.json
 * (el evaluator sobrescribe el baseline por corrida; este script lo hace definitivo)
 * Uso: node scripts/generateBaselineR5b.js
 */
const fs = require('fs');
const path = require('path');

const EVAL_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'corpus_canonico', 'corpus_canonico.json'), 'utf8'));
const ds = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'evaluation_dataset_v2.json'), 'utf8'));

function loadLatest(prefix) {
  const files = fs.readdirSync(EVAL_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort();
  if (!files.length) throw new Error('No hay reporte para ' + prefix);
  return JSON.parse(fs.readFileSync(path.join(EVAL_DIR, files[files.length - 1]), 'utf8'));
}

const runA = loadLatest('evaluation_real_r5b_runA_');
const runB = loadLatest('evaluation_real_r5b_runB_');

// Verificar completitud
const completeA = runA.per_query_results.filter(q => 'retrieval' in q).length;
const completeB = runB.per_query_results.filter(q => 'retrieval' in q).length;
const errorsA = runA.per_query_results.length - completeA;
const errorsB = runB.per_query_results.length - completeB;

// Comparación por query
const qA = Object.fromEntries(runA.per_query_results.filter(q => 'retrieval' in q).map(q => [q.query_id, q.retrieval]));
const qB = Object.fromEntries(runB.per_query_results.filter(q => 'retrieval' in q).map(q => [q.query_id, q.retrieval]));
const comparison = {
  identical_queries: 0,
  queries_with_ranking_changes: 0,
  per_query: []
};
for (const qid of Object.keys(qA)) {
  const a = qA[qid], b = qB[qid];
  const identical = a.precision_at_5 === b.precision_at_5 && a.mrr === b.mrr && a.total_retrieved === b.total_retrieved;
  if (identical) comparison.identical_queries++;
  else comparison.queries_with_ranking_changes++;
  comparison.per_query.push({ query_id: qid, identical, p5_a: a.precision_at_5, p5_b: b.precision_at_5, mrr_a: a.mrr, mrr_b: b.mrr });
}

const git = require('child_process').execSync('git -C ' + path.join(__dirname, '..', '..') + ' rev-parse --short HEAD').toString().trim();

const baseline = {
  label: 'R5-B / REAL / LOCAL',
  corpus: { name: 'corpus_canonico.json', version: corpus.corpus_version, chunks: corpus.total_chunks },
  dataset: { name: 'evaluation_dataset_v2.json', version: ds.version, valid_queries: ds.queries.filter(q => q.status === 'VALID').length },
  timestamp: new Date().toISOString(),
  commit: git,
  config: { threshold: 0.45, topK: 5, delay_ms: 250, retrieval: 'vectorial NVIDIA nv-embedqa-e5-v5 (HNSW pgvector)', bd: 'LOCAL beauty_db' },
  run_a: { file: 'evaluation_real_r5b_runA_20260814T001721.json', complete: completeA, errors: errorsA, retrieval: runA.summary.retrieval, context: runA.summary.context, latency: runA.summary.latency, by_category: runA.summary.by_category },
  run_b: { file: 'evaluation_real_r5b_runB_20260814T002252.json', complete: completeB, errors: errorsB, retrieval: runB.summary.retrieval, context: runB.summary.context, latency: runB.summary.latency, by_category: runB.summary.by_category },
  comparison,
  quality_gates: runB.quality_gates || null,
  availability: {
    total: 18, completed_a: completeA, completed_b: completeB,
    error_rate: (errorsA + errorsB) / 36,
    availability_rate: (completeA + completeB) / 36
  }
};

fs.writeFileSync(path.join(EVAL_DIR, 'baseline_real_r5b.json'), JSON.stringify(baseline, null, 2));
console.log('✅ baseline_real_r5b.json generado');
console.log('   RUN A:', completeA + '/18 | RUN B:', completeB + '/18 | errores:', errorsA + errorsB);
console.log('   Queries idénticas A/B:', comparison.identical_queries + '/18');
console.log('   Quality gates PASS:', baseline.quality_gates ? baseline.quality_gates.passed : 'N/A');
