#!/usr/bin/env node
/**
 * backend/scripts/r5c24EvidenceAggregationExperiment.js
 * CICLO 36 — R5-C24: Evidence aggregation (read-only, determinista, sin LLM)
 *
 * Pregunta: ¿la agregación de evidencia distribuida convierte chunks ya
 * recuperados en respuestas recuperables, o el techo ~0.80 es un problema
 * de candidate retrieval?
 *
 * FASE 1: reproducir baseline (top-5/10/20/50/100) — debe coincidir con R5-C23
 * FASE 2: evidence set por K (solo ranking vectorial, sin selección manual)
 * FASE 3: clasificación funcional por chunk (determinista, basada en contenido
 *         y en la relación con el gold: primary/supporting del GOLD-V5 + señales
 *         léxicas de condición/contraindicación/excepción)
 * FASE 4/8: composición — evidencia suficiente si cobertura de expected ≥50%
 *         en el pool K (mismo umbral que R5-C23) — separa RETRIEVED de COMPOSABLE
 * FASE 5/6: análisis de cabello_002/cejas_008 (multi-chunk) + cejas_004 (control
 *         negativo VECTOR_MISS: aggregation NO debe fabricar evidencia)
 * FASE 7: métricas EvidenceRecall@K + AggregationGain
 * FASE 9: clasificación DIRECT_SUCCESS / MULTI_CHUNK_RECOVERED /
 *         MULTI_CHUNK_PARTIAL / VECTOR_MISS / CORPUS_GAP
 *
 * READ-ONLY. Guarda anti-producción. Uso: node scripts/r5c24EvidenceAggregationExperiment.js --run=A
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
const EVIDENCE_THRESHOLD = 0.5; // mismo umbral que R5-C23

// Señales deterministas de función informativa (NO keywords simples como único
// criterio: se combinan con la relación gold core/supporting del GOLD-V5)
const FUNCTION_SIGNALS = {
  CONDITION: ['contraindicac', 'condición', 'enfermedad', 'diabetes', 'autoinmun', 'embarazo', 'alergia', 'sensibil'],
  CONTRAINDICATION: ['contraindicac', 'no debe', 'evitar', 'riesgo de', 'peligro', 'prohibid'],
  EXCEPTION: ['excepci', 'sin embargo', 'aunque', 'pero', 'caso especial', 'salvo'],
  PROCEDURE: ['procedimiento', 'técnica', 'paso', 'aplicación', 'método', 'cómo', 'protocolo'],
  SECONDARY: ['también', 'adicional', 'además', 'complement', 'apoyo', 'relacionad'],
};

function classifyFunction(title, content, isCore, isSupporting) {
  const text = `${title || ''} ${content || ''}`.toLowerCase();
  if (isCore) return 'PRIMARY';
  if (isSupporting) return 'SECONDARY';
  const found = [];
  for (const [fn, sigs] of Object.entries(FUNCTION_SIGNALS)) {
    if (sigs.some(s => text.includes(s))) found.push(fn);
  }
  if (found.length) return found[0];
  return 'CONTEXT';
}

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

    // ── FASE 1: pool top-100 (idéntico a R5-C22/23) ──
    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + qEmb.join(',') + ']']);
    const vecTop = res.rows.map(r => ({ chunk_id: r.chunk_id, document_id: r.document_id, title: r.title || '', content: r.content || '', score: +r.sim.toFixed(4) }));

    // gold ranks
    const goldRanks = {};
    for (const g of goldAll) {
      const i = vecTop.findIndex(r => r.chunk_id === g);
      goldRanks[g] = i === -1 ? -1 : i + 1;
    }
    const bestGoldRank = Math.min(...Object.values(goldRanks).filter(r => r !== -1), 999);

    // ── FASE 2/3: evidence set por K + clasificación funcional ──
    const ks = [5, 10, 20, 50, 100];
    const evidenceSets = {};
    for (const k of ks) {
      const inK = vecTop.slice(0, k);
      evidenceSets[k] = inK.map(r => ({
        chunk_id: r.chunk_id,
        function: classifyFunction(r.title, r.content, goldCore.includes(r.chunk_id), goldSup.includes(r.chunk_id)),
        is_gold: goldSet.has(r.chunk_id),
        score: r.score,
      }));
    }

    // ── FASE 4: composición — cobertura de expected en cada K ──
    const evidenceRecall = {};
    const sufficient = {};
    for (const k of ks) {
      const inK = vecTop.slice(0, k).filter(r => goldSet.has(r.chunk_id)).length;
      evidenceRecall[k] = +(inK / Math.max(1, goldAll.length)).toFixed(4);
      sufficient[k] = evidenceRecall[k] >= EVIDENCE_THRESHOLD;
    }
    const minPoolSufficient = ks.find(k => sufficient[k]) || 0;

    // ── FASE 9: clasificación final ──
    let finalClass;
    if (bestGoldRank !== 999 && bestGoldRank <= 5) finalClass = 'DIRECT_SUCCESS';
    else if (sufficient[50]) finalClass = 'MULTI_CHUNK_RECOVERED';
    else if (evidenceRecall[100] > 0) finalClass = 'MULTI_CHUNK_PARTIAL';
    else finalClass = 'VECTOR_MISS';

    // piezas presentes/ausentes en top-100
    const inPool100 = new Set(vecTop.map(r => r.chunk_id));
    const present = goldAll.filter(g => inPool100.has(g));
    const missing = goldAll.filter(g => !inPool100.has(g));

    perQuery.push({
      query_id: q.query_id,
      support_status: q.support_status,
      domain: q.query_id.split('_')[0],
      was_miss: MISSES.includes(q.query_id),
      best_gold_rank: bestGoldRank === 999 ? -1 : bestGoldRank,
      gold_counts: { core: goldCore.length, supporting: goldSup.length, total: goldAll.length },
      evidence_recall: evidenceRecall,
      sufficient,
      min_pool_sufficient: minPoolSufficient,
      present_chunks: present,
      missing_chunks: missing,
      final_class: finalClass,
    });
    console.log(`✅ ${q.query_id}: bestRank=${bestGoldRank === 999 ? '>100' : bestGoldRank} | ev@5=${evidenceRecall[5].toFixed(2)} ev@50=${evidenceRecall[50].toFixed(2)} | suficiente@${minPoolSufficient || '>100'} [${finalClass}]`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── FASE 7: métricas agregadas ──
  const avg = (fn, list) => { const vals = list.map(fn); return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4); };
  const evidenceRecallGlobal = { k5: avg(q => q.evidence_recall[5], perQuery), k10: avg(q => q.evidence_recall[10], perQuery), k20: avg(q => q.evidence_recall[20], perQuery), k50: avg(q => q.evidence_recall[50], perQuery), k100: avg(q => q.evidence_recall[100], perQuery) };
  // Direct recall por query: ≥1 gold en top-K (para AggregationGain)
  const directRecallGlobal = { k5: avg(q => (q.best_gold_rank !== -1 && q.best_gold_rank <= 5) ? 1 : 0, perQuery), k50: avg(q => (q.best_gold_rank !== -1 && q.best_gold_rank <= 50) ? 1 : 0, perQuery), k100: avg(q => q.best_gold_rank !== -1 ? 1 : 0, perQuery) };
  const aggregationGain = {
    k5: +(evidenceRecallGlobal.k5 - directRecallGlobal.k5).toFixed(4),
    k50: +(evidenceRecallGlobal.k50 - directRecallGlobal.k50).toFixed(4),
    k100: +(evidenceRecallGlobal.k100 - directRecallGlobal.k100).toFixed(4),
  };
  const multiChunkRecovered = perQuery.filter(q => q.final_class === 'MULTI_CHUNK_RECOVERED').length;
  const multiChunkPartial = perQuery.filter(q => q.final_class === 'MULTI_CHUNK_PARTIAL').length;
  const vectorMiss = perQuery.filter(q => q.final_class === 'VECTOR_MISS').length;
  const directSuccess = perQuery.filter(q => q.final_class === 'DIRECT_SUCCESS').length;

  const misses = perQuery.filter(q => q.was_miss);

  const out = {
    experiment: 'R5-C24',
    verdict: null,
    baseline: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    evidence_threshold: EVIDENCE_THRESHOLD,
    metrics: {
      evidence_recall_global: evidenceRecallGlobal,
      direct_recall_global: directRecallGlobal,
      aggregation_gain: aggregationGain,
      multi_chunk_recovered: multiChunkRecovered,
      multi_chunk_partial: multiChunkPartial,
      vector_miss: vectorMiss,
      direct_success: directSuccess,
      multi_chunk_recovery_rate: +(multiChunkRecovered / perQuery.length).toFixed(4),
    },
    evidence_ceiling: 0.9333,
    critical_misses: {
      cabello_002: misses.find(q => q.query_id === 'cabello_002') || {},
      cejas_008: misses.find(q => q.query_id === 'cejas_008') || {},
      cejas_004: misses.find(q => q.query_id === 'cejas_004') || {},
    },
    queries: perQuery.map(q => ({ query_id: q.query_id, final_class: q.final_class, min_pool_sufficient: q.min_pool_sufficient, evidence_recall: q.evidence_recall, present: q.present_chunks.length, missing: q.missing_chunks.length })),
    classification_summary: (() => { const c = {}; for (const q of perQuery) c[q.final_class] = (c[q.final_class] || 0) + 1; return c; })(),
    reproducibility: 'RUN A ≡ RUN B (verificar en segunda corrida)',
    production_modified: false,
    railway_contacted: false,
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c24_evidence_aggregation_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  EvidenceRecall global: @5=${evidenceRecallGlobal.k5} @50=${evidenceRecallGlobal.k50} @100=${evidenceRecallGlobal.k100}`);
  console.log(`  DirectRecall global: @5=${directRecallGlobal.k5} @50=${directRecallGlobal.k50} @100=${directRecallGlobal.k100}`);
  console.log(`  AggregationGain: @5=${aggregationGain.k5} @50=${aggregationGain.k50} @100=${aggregationGain.k100}`);
  console.log(`  Clasificación: ${JSON.stringify(out.classification_summary)}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
