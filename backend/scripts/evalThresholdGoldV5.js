#!/usr/bin/env node
/**
 * backend/scripts/evalThresholdGoldV5.js
 * Cierre FASE 0 — calibración del umbral de similitud sobre GOLD-V5.
 *
 * Corre la MISMA ruta que producción (`searchBeautyKnowledge`) para cada umbral
 * candidato y mide recall@5, MRR, consultas sin resultados y caídas a full-text.
 * No modifica nada: solo lee y llama a la API de embeddings.
 *
 *   node scripts/evalThresholdGoldV5.js [--thresholds=0.45,0.40,0.35,0.30] [--topK=5]
 *
 * Salida: resumen por consola + JSON en src/data/eval/.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
// Funciona tanto en el repo como copiado a /tmp dentro del contenedor.
const BASE = fs.existsSync('/app/src') ? '/app' : path.join(__dirname, '..');
const { searchBeautyKnowledge } = require(path.join(BASE, 'src', 'services', 'ragService'));

const DATASET = path.join(BASE, 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const OUT = path.join(BASE, 'src', 'data', 'eval', 'r7_threshold_calibration_goldv5.json');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
}

const THRESHOLDS = arg('thresholds', '0.45,0.40,0.35,0.30')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0 && n <= 1)
  .sort((a, b) => b - a);
const TOP_K = parseInt(arg('topK', '5'), 10);

const goldOf = (q) => ({
  core: new Set(q.expected_chunks?.core || []),
  supporting: new Set(q.expected_chunks?.supporting || []),
});

async function runOneThreshold(queries, threshold) {
  const perQuery = [];
  for (const q of queries) {
    const { core, supporting } = goldOf(q);
    const trace = {};
    let rows = [];
    let error = null;
    try {
      rows = await searchBeautyKnowledge(q.query, { topK: TOP_K, threshold, trace });
    } catch (e) {
      error = e.message;
    }
    const ids = rows.map((r) => r.chunk_id);
    const coreHits = ids.filter((id) => core.has(id));
    const supportHits = ids.filter((id) => supporting.has(id));
    const allGold = new Set([...core, ...supporting]);
    const anyGold = ids.filter((id) => allGold.has(id));

    const firstRank = ids.findIndex((id) => allGold.has(id));
    const mrr = firstRank >= 0 ? 1 / (firstRank + 1) : 0;

    perQuery.push({
      query_id: q.query_id,
      query: q.query,
      returned: ids.length,
      core_recall: core.size ? coreHits.length / core.size : null,
      support_recall: supporting.size ? supportHits.length / supporting.size : null,
      precision_gold: ids.length ? anyGold.length / ids.length : 0,
      mrr,
      mode: trace.mode || null,
      fallback: trace.fallback_triggered === true,
      top_similarity: rows.length ? Number(rows[0].similarity ?? 0) : null,
      error,
    });
  }

  const withResults = perQuery.filter((r) => r.returned > 0);
  const coreQueries = perQuery.filter((r) => r.core_recall !== null);
  const avg = (arr, k) => (arr.length ? arr.reduce((s, r) => s + (r[k] || 0), 0) / arr.length : 0);

  return {
    threshold,
    queries: perQuery.length,
    queries_with_results: withResults.length,
    queries_empty: perQuery.length - withResults.length,
    fallback_count: perQuery.filter((r) => r.fallback).length,
    errors: perQuery.filter((r) => r.error).length,
    recall_core_at_k: Number(avg(coreQueries, 'core_recall').toFixed(4)),
    recall_support_at_k: Number(avg(perQuery, 'support_recall').toFixed(4)),
    precision_gold_at_k: Number(avg(perQuery, 'precision_gold').toFixed(4)),
    mrr: Number(avg(perQuery, 'mrr').toFixed(4)),
    avg_results: Number(avg(perQuery, 'returned').toFixed(2)),
    detail: perQuery,
  };
}

(async () => {
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  const queries = dataset.queries || [];
  console.log(`GOLD-V5: ${queries.length} consultas · topK=${TOP_K} · umbrales ${THRESHOLDS.join(', ')}`);

  const results = [];
  for (const t of THRESHOLDS) {
    const r = await runOneThreshold(queries, t);
    results.push(r);
    console.log(
      `\n== umbral ${t} ==\n` +
        `  con resultados: ${r.queries_with_results}/${r.queries} · vacías: ${r.queries_empty} · fallback fts: ${r.fallback_count} · errores: ${r.errors}\n` +
        `  recall@${TOP_K} (core): ${r.recall_core_at_k} · recall (support): ${r.recall_support_at_k}\n` +
        `  precision gold: ${r.precision_gold_at_k} · MRR: ${r.mrr} · media resultados: ${r.avg_results}`
    );
  }

  const payload = {
    dataset: path.basename(DATASET),
    dataset_version: dataset.dataset_version,
    generated_at: new Date().toISOString(),
    top_k: TOP_K,
    thresholds: THRESHOLDS,
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\nJSON escrito en ${path.relative(path.join(__dirname, '..'), OUT)}`);
  process.exit(0);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
