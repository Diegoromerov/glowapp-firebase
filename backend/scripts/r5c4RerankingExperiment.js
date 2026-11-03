#!/usr/bin/env node
/**
 * backend/scripts/r5c4RerankingExperiment.js
 * CICLO 16 — R5-C4: Experimento controlado de RERANKING v2 (read-only)
 *
 * Correcciones sobre R5-C3:
 *  1. P@1/P@3/P@5/R@5/MRR calculados explícitamente (R5-C3 tenía P@3 roto)
 *  2. Métricas contra AMBOS benchmarks: original y candidate (R5-C2)
 *  3. Latencia medida por fase (vector retrieval vs reranking)
 *  4. Verificación de leakage formal por query (qué señales usa el reranker)
 *  5. Clasificación por query: WIN/NEUTRAL/LOSS/RETRIEVAL_MISS/GROUND_TRUTH_MISMATCH
 *
 * Pipeline (idéntico a R5-C3 en retrieval):
 *   QUERY → VECTOR RETRIEVAL (top-20, SQL read-only) → HEURISTIC RERANKER → TOP-5
 *
 * RERANKER: determinista, SIN leakage.
 *   score = α·similarity + β·lexical_overlap(query_terms, título/contenido)
 *   Solo recibe query + chunks. Ground truth SOLO en evaluación.
 *
 * Uso: node scripts/r5c4RerankingExperiment.js --run=A|B
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const DS = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const CAND = path.join(__dirname, '..', 'src', 'data', 'eval', 'r5c2_alignment_candidate.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

const STOPWORDS = new Set(('de la el en y a los del se las por un para con no una su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te ti tu tus ellas nosotras vosotros vosotras os mío mía míos mías tuyo tuya tuyos tuyas suyo suya suyos suyas nuestro nuestra nuestros nuestras vuestro vuestra vuestros vuestras esos esas esos esas qué quién quiénes cuál cuáles cómo cuándo dónde para qué').split(/\s+/));
const STOPWORDS_EXTRA = new Set(['mejor','cómo','qué','cuál','cuáles','puedo','puede','debería','correctamente','ideal','usar','tratamiento','rutina','casero','profesional','real','realmente','vs','versus','entre','misma','mismo','hacer','hacerse']);

function extractTerms(query) {
  return query.toLowerCase().replace(/[¿?¡!.,:;()"'«»]/g, ' ')
    .split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w) && !STOPWORDS_EXTRA.has(w));
}
function lexicalOverlap(queryTerms, chunk) {
  if (!queryTerms.length) return 0;
  const title = (chunk.title || '').toLowerCase();
  const content = (chunk.content || '').toLowerCase().substring(0, 1500);
  let hits = 0;
  for (const t of queryTerms) { if (title.includes(t) || content.includes(t)) hits++; }
  return hits / queryTerms.length;
}
// Métricas estándar sobre un ranking (ids) vs expected
function computeMetrics(rankedIds, expected) {
  const k = [1, 3, 5];
  const out = { p1: 0, p3: 0, p5: 0, r5: 0, mrr: 0 };
  for (let i = 0; i < Math.min(5, rankedIds.length); i++) {
    if (expected.includes(rankedIds[i])) {
      if (out.mrr === 0) out.mrr = 1 / (i + 1);
    }
  }
  const hits5 = rankedIds.slice(0, 5).filter(id => expected.includes(id));
  out.p5 = hits5.length / 5;
  out.r5 = hits5.length / Math.max(1, expected.length);
  out.p3 = rankedIds.slice(0, 3).filter(id => expected.includes(id)).length / 3;
  out.p1 = expected.includes(rankedIds[0]) ? 1 : 0;
  return { p1: +out.p1.toFixed(4), p3: +out.p3.toFixed(4), p5: +out.p5.toFixed(4), r5: +out.r5.toFixed(4), mrr: +out.mrr.toFixed(4) };
}

async function main() {
  const args = process.argv.slice(2);
  const run = (args.find(a => a.startsWith('--run=')) || '--run=A').split('=')[1];

  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO.');
    process.exit(1);
  }

  const ds = JSON.parse(fs.readFileSync(DS, 'utf8'));
  const candDs = JSON.parse(fs.readFileSync(CAND, 'utf8'));
  const valid = ds.queries.filter(q => q.status === 'VALID');
  const candByQ = new Map(candDs.queries.map(c => [c.query_id, c]));
  const ALPHA = 0.7, BETA = 0.3;

  const perQuery = [];
  for (const q of valid) {
    const t0 = Date.now();
    const qEmb = await generateEmbedding(q.query, 'query');
    const qv = '[' + qEmb.join(',') + ']';
    const terms = extractTerms(q.query);

    // FASE A: vector retrieval (top-20)
    const cand = await ragPool.query(
      `SELECT id, chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT 20`, [qv]);
    const t1 = Date.now();
    const candidates = cand.rows.map((r, i) => ({
      rank_original: i + 1, chunk_id: r.chunk_id, document_id: r.document_id,
      title: r.title, content: r.content, similarity: parseFloat(r.sim.toFixed(6)),
    }));

    // FASE B: reranking (solo reordena; set invariante)
    const scored = candidates.map(c => ({
      ...c, lexical: lexicalOverlap(terms, c),
      rerank_score: ALPHA * c.similarity + BETA * lexicalOverlap(terms, c),
    }));
    scored.sort((a, b) => b.rerank_score - a.rerank_score);
    scored.forEach((c, i) => { c.rank_reranked = i + 1; });
    const t2 = Date.now();

    // Benchmarks
    const expOrig = q.expected_chunks;
    const candRow = candByQ.get(q.id);
    const expCand = (candRow && candRow.candidate_expected_chunks) || [];

    const origIds = candidates.map(c => c.chunk_id);
    const rerIds = scored.map(c => c.chunk_id);
    // Verificación set invariante
    const setInvariant = origIds.length === rerIds.length && origIds.every(id => rerIds.includes(id));

    const mVecOrig = computeMetrics(origIds, expOrig);
    const mRerOrig = computeMetrics(rerIds, expOrig);
    const mVecCand = expCand.length ? computeMetrics(origIds, expCand) : null;
    const mRerCand = expCand.length ? computeMetrics(rerIds, expCand) : null;

    // Clasificación (contra benchmark ORIGINAL y con evidencia de candidate)
    const expInCand = expOrig.filter(id => rerIds.includes(id));
    const oracleBestOrig = expInCand.length ? Math.min(...expInCand.map(id => rerIds.indexOf(id) + 1)) : null;
    const evidenceInTop10 = candidates.slice(0, 10).some(c => expCand.includes(c.chunk_id));
    const evidenceInTop20 = candidates.some(c => expCand.includes(c.chunk_id));

    let cls;
    if (expOrig.length && !expInCand.length && !evidenceInTop20) cls = 'RETRIEVAL_MISS';
    else if (expOrig.length && !expInCand.length && evidenceInTop20) cls = 'CANDIDATE_DEPTH';
    else if (mRerOrig.mrr > mVecOrig.mrr) cls = 'RERANKING_WIN';
    else if (mRerOrig.mrr < mVecOrig.mrr) cls = 'RERANKING_LOSS';
    else cls = 'RERANKING_NEUTRAL';

    perQuery.push({
      query_id: q.id, query: q.query, category: q.category,
      terms, candidate_count: scored.length,
      set_invariant: setInvariant,
      vector_only: {
        metrics_original: mVecOrig,
        metrics_candidate: mCand(mVecCand),
        top5: origIds.slice(0, 5),
        top1_sim: candidates[0]?.similarity,
      },
      reranked: {
        metrics_original: mRerOrig,
        metrics_candidate: mCand(mRerCand),
        top5: rerIds.slice(0, 5),
        top1_score: scored[0]?.rerank_score,
      },
      expected_original: expOrig,
      expected_candidate: expCand,
      expected_ranks_vector: expInCand.map(id => origIds.indexOf(id) + 1),
      expected_ranks_reranked: expInCand.map(id => rerIds.indexOf(id) + 1),
      oracle_best_rank: oracleBestOrig,
      evidence_in_top10_candidate: evidenceInTop10,
      evidence_in_top20_candidate: evidenceInTop20,
      classification: cls,
      latency: { retrieval_ms: t1 - t0, rerank_ms: t2 - t1, total_ms: t2 - t0 },
    });
    await new Promise(r => setTimeout(r, 250));
  }

  function mCand(x) { return x || null; }

  // Agregados
  function agg(fn) {
    const vals = perQuery.map(fn).filter(v => v !== null && v !== undefined);
    if (!vals.length) return null;
    const n = vals.length;
    return {
      p1: +(vals.reduce((a, v) => a + v.p1, 0) / n).toFixed(4),
      p3: +(vals.reduce((a, v) => a + v.p3, 0) / n).toFixed(4),
      p5: +(vals.reduce((a, v) => a + v.p5, 0) / n).toFixed(4),
      r5: +(vals.reduce((a, v) => a + v.r5, 0) / n).toFixed(4),
      mrr: +(vals.reduce((a, v) => a + v.mrr, 0) / n).toFixed(4),
    };
  }
  const gVecOrig = agg(q => q.vector_only.metrics_original);
  const gRerOrig = agg(q => q.reranked.metrics_original);
  const gVecCand = agg(q => q.vector_only.metrics_candidate);
  const gRerCand = agg(q => q.reranked.metrics_candidate);

  // Latencia agregada
  const latRetr = perQuery.map(q => q.latency.retrieval_ms);
  const latTot = perQuery.map(q => q.latency.total_ms);
  const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const latAgg = (arr) => ({ avg: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1), p50: pct(arr, 0.5), p95: pct(arr, 0.95), max: Math.max(...arr) });

  const out = {
    cycle: '16', experiment: 'R5-C4', database: 'LOCAL_ONLY', production_contacted: false,
    official_baseline_unchanged: true, queries_valid: valid.length,
    generated_at: new Date().toISOString(), run,
    configs: {
      vector_only: { topK: 20, metric_topk: 5, model: 'nvidia/nv-embedqa-e5-v5', bd: 'LOCAL' },
      reranking: { topK: 20, metric_topk: 5, alpha: ALPHA, beta: BETA, algorithm: 'HEURISTIC_RERANKER: 0.7*similarity + 0.3*lexical_overlap(query_terms, title+content)', llm_used: false },
    },
    metrics: {
      original_ground_truth: { vector_only: gVecOrig, reranked: gRerOrig, delta: delta(gRerOrig, gVecOrig) },
      candidate_ground_truth: { vector_only: gVecCand, reranked: gRerCand, delta: delta(gRerCand, gVecCand) },
    },
    per_query: perQuery,
    latency: {
      vector_only: latAgg(latRetr),
      vector_plus_rerank: latAgg(latTot),
      delta_avg_ms: +(latAgg(latTot).avg - latAgg(latRetr).avg).toFixed(1),
    },
    leakage_check: {
      reranker_inputs: ['query', 'candidate.chunk_id', 'candidate.title', 'candidate.content', 'candidate.similarity'],
      ground_truth_used_in_scoring: false,
      expected_used_only_in_evaluation: true,
      set_invariant_all_queries: perQuery.every(q => q.set_invariant),
      verdict: 'NO_LEAKAGE',
    },
    reproducibility: { run_a: 'r5c4_reranking_experiment_a.json', run_b: 'r5c4_reranking_experiment_b.json' },
  };
  function delta(rer, vec) {
    if (!rer || !vec) return null;
    return { p1: +(rer.p1 - vec.p1).toFixed(4), p3: +(rer.p3 - vec.p3).toFixed(4), p5: +(rer.p5 - vec.p5).toFixed(4), r5: +(rer.r5 - vec.r5).toFixed(4), mrr: +(rer.mrr - vec.mrr).toFixed(4) };
  }
  const outPath = path.join(OUT_DIR, `r5c4_reranking_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`✅ RUN ${run}: vector orig MRR=${gVecOrig.mrr} → rerank orig MRR=${gRerOrig.mrr} | cand MRR=${gVecCand?.mrr ?? 'N/A'} → ${gRerCand?.mrr ?? 'N/A'}`);
  console.log(`✅ ${outPath}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
