#!/usr/bin/env node
/**
 * backend/scripts/evalRankingGoldV5.js
 * FASE 2 — benchmark de ranking sobre GOLD-V5.
 *
 * Mide, para cada modo de retrieval, R@k, MRR y misses contra el gold del dataset.
 * No escribe en la base: solo lee y llama a la API de embeddings.
 *
 *   node scripts/evalRankingGoldV5.js --modes=vector,hybrid --topks=5,50
 *
 * Salida: tabla por consola + JSON en src/data/eval/r7_ranking_goldv5.json
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BASE = fs.existsSync('/app/src') ? '/app' : path.join(__dirname, '..');
const { searchBeautyKnowledge } = require(path.join(BASE, 'src', 'services', 'ragService'));
const { RAG_SIMILARITY_THRESHOLD } = require(path.join(BASE, 'src', 'config', 'ragConfig'));

const DATASET = path.join(BASE, 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const OUT = path.join(BASE, 'src', 'data', 'eval', 'r7_ranking_goldv5.json');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
}

const MODES = arg('modes', 'vector,hybrid').split(',').map((m) => m.trim()).filter(Boolean);
const WEIGHTS = arg('weights', null);
const RRF_K_ARG = arg('k', null);
const LW = arg('lw', null);
const TOPKS = arg('topks', '5,50').split(',').map((n) => parseInt(n, 10)).filter((n) => n > 0);

async function measure(queries, mode, topK) {
  const rowsPerQuery = [];
  for (const q of queries) {
    const core = new Set(q.expected_chunks?.core || []);
    const supporting = new Set(q.expected_chunks?.supporting || []);
    const gold = new Set([...core, ...supporting]);
    const trace = {};
    let rows = [];
    let error = null;
    try {
      rows = await searchBeautyKnowledge(q.query, { topK, threshold: RAG_SIMILARITY_THRESHOLD, mode, trace, rerankWeights: WEIGHTS ? WEIGHTS.split(',').map(Number) : undefined, rrfK: RRF_K_ARG ? Number(RRF_K_ARG) : undefined, lexicalWeight: LW ? Number(LW) : undefined });
    } catch (e) {
      error = e.message;
    }
    const ids = rows.map((r) => r.chunk_id);
    const goldHits = ids.filter((id) => gold.has(id));
    const coreHits = ids.filter((id) => core.has(id));
    const rank = ids.findIndex((id) => gold.has(id));
    rowsPerQuery.push({
      query_id: q.query_id,
      returned: ids.length,
      gold_total: gold.size,
      gold_hits: goldHits.length,
      recall_all: gold.size ? goldHits.length / gold.size : 0,
      recall_core: core.size ? coreHits.length / core.size : null,
      mrr: rank >= 0 ? 1 / (rank + 1) : 0,
      miss: goldHits.length === 0,
      mode_used: trace.mode || null,
      error,
    });
  }

  const avg = (key) => {
    const vals = rowsPerQuery.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
    if (!vals.length) return 0;
    return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4));
  };
  const cores = rowsPerQuery.filter((r) => r.recall_core !== null);

  return {
    mode,
    topK,
    queries: rowsPerQuery.length,
    empty: rowsPerQuery.filter((r) => r.returned === 0).length,
    misses: rowsPerQuery.filter((r) => r.miss).length,
    recall_all: avg('recall_all'),
    recall_core: Number((cores.reduce((a, b) => a + b.recall_core, 0) / (cores.length || 1)).toFixed(4)),
    mrr: avg('mrr'),
    avg_returned: Number((rowsPerQuery.reduce((a, b) => a + b.returned, 0) / rowsPerQuery.length).toFixed(2)),
    errors: rowsPerQuery.filter((r) => r.error).length,
    detail: rowsPerQuery,
  };
}

(async () => {
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  const queries = dataset.queries || [];
  console.log(`GOLD-V5 · ${queries.length} consultas · umbral ${RAG_SIMILARITY_THRESHOLD} · modos ${MODES.join(',')} · topK ${TOPKS.join(',')}`);

  const results = [];
  for (const mode of MODES) {
    for (const topK of TOPKS) {
      const r = await measure(queries, mode, topK);
      results.push(r);
      console.log(
        `  ${mode.padEnd(7)} @${String(topK).padStart(2)} | R@${topK} ${r.recall_all} (core ${r.recall_core}) | MRR ${r.mrr} | misses ${r.misses}/${r.queries} | vacías ${r.empty} | media ${r.avg_returned}`
      );
    }
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify({ dataset: path.basename(DATASET), generated_at: new Date().toISOString(), threshold: RAG_SIMILARITY_THRESHOLD, results }, null, 2),
    'utf8'
  );
  console.log(`JSON: ${OUT}`);
  process.exit(0);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
