#!/usr/bin/env node
/**
 * backend/scripts/r5c23MultiChunkEvidenceExperiment.js
 * CICLO 35 — R5-C23: Cobertura multi-chunk y evidencia compuesta (read-only)
 *
 * Pregunta: ¿los misses son de recuperación de chunks individuales, o el
 * conocimiento correcto ya está distribuido entre varios chunks y el RAG
 * simplemente no sabe reunirlo?
 *
 * FASE A: pools vectoriales top-5/10/20/50/100 (embedding almacenado, sin tocar nada)
 * FASE B/C: clasificar cada query: GOLD_DIRECT / COMPLEMENTARY_EVIDENCE /
 *           PARTIAL_EVIDENCE / NO_EVIDENCE + análisis de los 3 misses
 * FASE D: composición de evidencia determinista (sin LLM) — evidencia suficiente
 *         si ≥50% de los expected_chunks del gold están dentro del pool K
 * FASE E: Direct Recall vs Evidence Recall por K
 * FASE F: techos (baseline vs direct vs evidence)
 * FASE G: clasificación causal DIREC_SUCCESS / MULTI_CHUNK_RECOVERABLE /
 *         PARTIAL_EVIDENCE / VECTOR_MISS / CORPUS_GAP
 * FASE H: análisis por dominio (especialmente cejas)
 *
 * READ-ONLY. Guarda anti-producción. Uso: node scripts/r5c23MultiChunkEvidenceExperiment.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V5 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const TOPK = 100;
const MISSES = ['cabello_002', 'cejas_004', 'cejas_008'];
// Regla explícita de suficiencia de evidencia (documentada, sin LLM):
// una query tiene EVIDENCIA SUFICIENTE en el pool K si ≥50% de sus expected
// chunks (core + supporting) aparecen dentro del top-K.
const EVIDENCE_THRESHOLD = 0.5;

async function main() {
  const args = process.argv.slice(2);
  const run = (args.find(a => a.startsWith('--run=')) || '--run=A').split('=')[1];

  // ── GUARDA ANTI-PRODUCCIÓN ──
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO.');
    process.exit(1);
  }

  const v5 = JSON.parse(fs.readFileSync(V5, 'utf8'));
  const queries = v5.queries.filter(q => q.support_status !== 'UNSUPPORTED');

  const perQuery = [];
  for (const q of queries) {
    const goldCore = q.expected_chunks.core || [];
    const goldSup = q.expected_chunks.supporting || [];
    const goldAll = [...goldCore, ...goldSup];
    const goldSet = new Set(goldAll);
    const qTokens = null; // no se usa en este experimento

    // ── FASE A: pool vectorial top-100 ──
    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT chunk_id, document_id, title, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + qEmb.join(',') + ']']);
    const vecTop = res.rows.map(r => ({ chunk_id: r.chunk_id, document_id: r.document_id, title: r.title || '', score: +r.sim.toFixed(4) }));

    // Ranks de cada gold (para ver golds individuales y de soporte)
    const goldRanks = {};
    for (const g of goldAll) {
      const i = vecTop.findIndex(r => r.chunk_id === g);
      goldRanks[g] = i === -1 ? -1 : i + 1;
    }
    const bestGoldRank = Math.min(...Object.values(goldRanks).filter(r => r !== -1), 999);
    const bestGoldInTop = (k) => bestGoldRank !== 999 && bestGoldRank <= k;

    // ── FASE E: Direct Recall y Evidence Recall por K ──
    // Direct: ≥1 gold (core o supporting) en top-K
    const directAt = (k) => vecTop.slice(0, k).some(r => goldSet.has(r.chunk_id)) ? 1 : 0;
    // Evidence: proporción de expected chunks presentes en top-K
    const evidenceAt = (k) => {
      const inK = vecTop.slice(0, k).filter(r => goldSet.has(r.chunk_id)).length;
      return inK / Math.max(1, goldAll.length);
    };
    // Evidence suficiente: ≥50% de expected en top-K
    const sufficientAt = (k) => evidenceAt(k) >= EVIDENCE_THRESHOLD;

    const ks = [5, 10, 20, 50, 100];
    const direct = Object.fromEntries(ks.map(k => [k, +directAt(k).toFixed(4)]));
    const evidence = Object.fromEntries(ks.map(k => [k, +evidenceAt(k).toFixed(4)]));
    const sufficient = Object.fromEntries(ks.map(k => [k, sufficientAt(k)]));
    const minPoolSufficient = ks.find(k => sufficientAt(k)) || 0;

    // ── FASE G: clasificación causal ──
    let causalClass;
    if (bestGoldRank !== 999 && bestGoldRank <= 5) {
      causalClass = 'DIRECT_SUCCESS';
    } else if (sufficientAt(50)) {
      causalClass = 'MULTI_CHUNK_RECOVERABLE';
    } else if (evidenceAt(100) > 0) {
      causalClass = 'PARTIAL_EVIDENCE';
    } else {
      causalClass = 'VECTOR_MISS';
    }

    // ── FASE D: composición de evidencia (qué piezas están / faltan) ──
    const inPool100 = new Set(vecTop.map(r => r.chunk_id));
    const presentChunks = goldAll.filter(g => inPool100.has(g));
    const missingChunks = goldAll.filter(g => !inPool100.has(g));

    perQuery.push({
      query_id: q.query_id,
      support_status: q.support_status,
      domain: q.query_id.split('_')[0],
      was_miss: MISSES.includes(q.query_id),
      gold_counts: { core: goldCore.length, supporting: goldSup.length, total: goldAll.length },
      best_gold_rank: bestGoldRank === 999 ? -1 : bestGoldRank,
      gold_ranks: goldRanks,
      direct_recall: direct,
      evidence_recall: evidence,
      evidence_sufficient: sufficient,
      min_pool_sufficient: minPoolSufficient,
      present_chunks: presentChunks,
      missing_chunks: missingChunks,
      causal_class: causalClass,
    });
    console.log(`✅ ${q.query_id}: bestGoldRank=${bestGoldRank === 999 ? '>100' : bestGoldRank} | evidence@5=${evidence[5].toFixed(2)} @50=${evidence[50].toFixed(2)} @100=${evidence[100].toFixed(2)} | suficiente@${minPoolSufficient || '>100'} [${causalClass}]`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── FASE F: techos ──
  const avg = (fn, list) => { const vals = list.map(fn); return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4); };
  const directRecall = { k5: avg(q => q.direct_recall[5], perQuery), k100: avg(q => q.direct_recall[100], perQuery) };
  const evidenceRecall = { k5: avg(q => q.evidence_recall[5], perQuery), k50: avg(q => q.evidence_recall[50], perQuery), k100: avg(q => q.evidence_recall[100], perQuery) };
  const multiChunkRecoverable = perQuery.filter(q => q.causal_class === 'MULTI_CHUNK_RECOVERABLE').length;
  const directSuccess = perQuery.filter(q => q.causal_class === 'DIRECT_SUCCESS').length;
  const partialEvidence = perQuery.filter(q => q.causal_class === 'PARTIAL_EVIDENCE').length;
  const vectorMiss = perQuery.filter(q => q.causal_class === 'VECTOR_MISS').length;

  // techos:
  // baseline R5-C = 0.7885 (R@5 oficial, sobre gold core)
  // direct R@100 (≥1 gold en top-100)
  // evidence ceiling (≥50% de expected en top-100 = query "respondible" por composición)
  const evidenceCeiling = perQuery.filter(q => q.evidence_sufficient[100]).length / perQuery.length;

  // análisis cejas (FASE H)
  const cejas = perQuery.filter(q => q.domain === 'cejas');
  const cejasClasses = {};
  for (const q of cejas) cejasClasses[q.causal_class] = (cejasClasses[q.causal_class] || 0) + 1;

  const out = {
    experiment: 'R5-C23',
    run,
    database: 'LOCAL_ONLY',
    production_contacted: false,
    production_modified: false,
    baseline_r5c: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    evidence_threshold: { rule: 'evidencia suficiente si ≥50% de expected_chunks (core+supporting) dentro del top-K', value: EVIDENCE_THRESHOLD },
    metrics: {
      direct_recall: directRecall,
      evidence_recall: evidenceRecall,
      delta_evidence_minus_direct: { k100: +(evidenceRecall.k100 - directRecall.k100).toFixed(4) },
      multi_chunk_recoverable_pct: +(multiChunkRecoverable / perQuery.length).toFixed(4),
      direct_success_pct: +(directSuccess / perQuery.length).toFixed(4),
      partial_evidence_pct: +(partialEvidence / perQuery.length).toFixed(4),
      true_vector_miss_pct: +(vectorMiss / perQuery.length).toFixed(4),
    },
    vector_ceiling: { r100_direct: directRecall.k100, note: 'proporción de queries con ≥1 gold en top-100' },
    evidence_ceiling: { r100_sufficient: +evidenceCeiling.toFixed(4), note: 'proporción de queries con evidencia compuesta suficiente en top-100 (respondible si el sistema compusiera correctamente)' },
    three_real_misses: perQuery.filter(q => q.was_miss).map(q => ({
      query_id: q.query_id,
      best_gold_rank: q.best_gold_rank,
      gold_counts: q.gold_counts,
      evidence_recall: q.evidence_recall,
      evidence_sufficient: q.evidence_sufficient,
      min_pool_sufficient: q.min_pool_sufficient,
      present_chunks: q.present_chunks,
      missing_chunks: q.missing_chunks,
      causal_class: q.causal_class,
    })),
    causal_classification: {
      summary: (() => { const c = {}; for (const q of perQuery) c[q.causal_class] = (c[q.causal_class] || 0) + 1; return c; })(),
      per_query: perQuery.map(q => ({ query_id: q.query_id, class: q.causal_class, min_pool_sufficient: q.min_pool_sufficient, best_gold_rank: q.best_gold_rank })),
    },
    cejas_analysis: {
      per_query: cejas.map(q => ({ query_id: q.query_id, class: q.causal_class, min_pool_sufficient: q.min_pool_sufficient, missing_chunks: q.missing_chunks.length })),
      class_summary: cejasClasses,
    },
    reproducibility: 'RUN A ≡ RUN B (verificar en segunda corrida)',
    verdict: null,
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c23_multi_chunk_evidence_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  Direct R@100=${directRecall.k100} | Evidence R@100=${evidenceRecall.k100} | Δ=${out.metrics.delta_evidence_minus_direct.k100}`);
  console.log(`  Multi-chunk recoverable: ${multiChunkRecoverable}/${perQuery.length} | DIRECT_SUCCESS: ${directSuccess} | PARTIAL: ${partialEvidence} | VECTOR_MISS: ${vectorMiss}`);
  console.log(`  Evidence ceiling (respondible por composición @100): ${evidenceCeiling.toFixed(4)}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
