#!/usr/bin/env node
/**
 * backend/scripts/r5c25EvidenceAggregatorExperiment.js
 * CICLO 37 — R5-C25: Evidence Aggregator Experiment (read-only, determinista, sin LLM)
 *
 * Arquitectura validada:
 *   QUERY → RETRIEVAL (sin tocar) → CANDIDATE POOL → EVIDENCE UNITS →
 *   COMPLEMENTARITY → EVIDENCE GROUPS → REDUNDANCY CONTROL →
 *   EVIDENCE SUFFICIENCY → FINAL EVIDENCE SET
 *
 * CONTROLES:
 *   A = baseline retrieval (top-5, sin agregación)          — referencia R@5
 *   B = reproducción R5-C24 (cobertura expected ≥50%)       — control experimental inmediato
 *   C = ORACLE_ONLY (usa gold solo para techo; marcado)     — NO cuenta como éxito
 *   D = REAL EVIDENCE AGGREGATOR (solo query + pool + metadata; SIN gold)
 *
 * Agregador (mecanismo mínimo, sin gold leakage):
 *  - Evidence units: top-100 pool, con función (señales léxicas) + cobertura de query
 *  - Complementariedad: pares REDUNDANT (overlap léxico ≥0.3) vs COMPLEMENTARY
 *    (cubren términos DISTINTOS de la query) — NO suma ciega de scores
 *  - Grupos greedy: semilla = mejor chunk; incorpora complementarios; descarta redundantes
 *  - Sufficiency (sin gold): cobertura de query ≥0.5 y ≥2 chunks → SUFFICIENT;
 *    0.2-0.5 → PARTIAL; <0.2 → INSUFFICIENT; dominado por no-query → CONTAMINATED;
 *    sin evidencia top-100 → VECTOR_MISS
 *  - Evaluación post-hoc (solo métrica, no selección): evidence recall, precision,
 *    contamination rate, query success contra GOLD-V5
 *
 * READ-ONLY. Guarda anti-producción. Uso: node scripts/r5c25EvidenceAggregatorExperiment.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V5 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const TOPK = 100;
const SUFF_COVERAGE = 0.5;   // cobertura de query para SUFFICIENT
const PARTIAL_COVERAGE = 0.2; // cobertura mínima para PARTIAL
const REDUNDANCY_OVERLAP = 0.3; // overlap léxico → REDUNDANT
const MISSES = ['cabello_002', 'cejas_004', 'cejas_008'];

const STOP = new Set('de la el en y a los del se las por un para con no una su al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mis tu tus suyas esas esos'.split(/\s+/));

function tokenize(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,:;()"'«»]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}

// Señales de función informativa (mismo criterio que R5-C24; NO keywords simples como único criterio)
const FUNCTION_SIGNALS = {
  CONDITION: ['contraindicac', 'condición', 'enfermedad', 'diabetes', 'autoinmun', 'embarazo', 'alergia', 'sensibil', 'medicaci'],
  CONTRAINDICATION: ['contraindicac', 'no debe', 'evitar', 'riesgo de', 'peligro', 'prohibid'],
  EXCEPTION: ['excepci', 'sin embargo', 'aunque', 'pero', 'caso especial', 'salvo'],
  PROCEDURE: ['procedimiento', 'técnica', 'paso', 'aplicación', 'método', 'cómo', 'protocolo'],
  SECONDARY: ['también', 'adicional', 'además', 'complement', 'apoyo', 'relacionad'],
};

function classifyFunction(title, content) {
  const text = `${title || ''} ${content || ''}`.toLowerCase();
  const found = [];
  for (const [fn, sigs] of Object.entries(FUNCTION_SIGNALS)) {
    if (sigs.some(s => text.includes(s))) found.push(fn);
  }
  return found[0] || 'CONTEXT';
}

function metricsClassic(rankedIds, expSet) {
  const out = { p1: 0, p3: 0, p5: 0, r5: 0, r10: 0, mrr: 0 };
  for (let i = 0; i < Math.min(10, rankedIds.length); i++) {
    if (expSet.has(rankedIds[i])) { out.mrr = 1 / (i + 1); break; }
  }
  const hits5 = rankedIds.slice(0, 5).filter(id => expSet.has(id));
  out.p5 = hits5.length / 5;
  out.r5 = hits5.length / Math.max(1, expSet.size);
  out.r10 = rankedIds.slice(0, 10).filter(id => expSet.has(id)).length / Math.max(1, expSet.size);
  out.p3 = rankedIds.slice(0, 3).filter(id => expSet.has(id)).length / 3;
  out.p1 = expSet.has(rankedIds[0]) ? 1 : 0;
  return { p1: +out.p1.toFixed(4), p3: +out.p3.toFixed(4), p5: +out.p5.toFixed(4), r5: +out.r5.toFixed(4), r10: +out.r10.toFixed(4), mrr: +out.mrr.toFixed(4) };
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
    const qTokens = tokenize(q.query);
    const qTokSet = new Set(qTokens);

    // ── RETRIEVAL (pool top-100, sin modificar nada) ──
    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + qEmb.join(',') + ']']);
    const pool = res.rows.map((r, i) => ({
      chunk_id: r.chunk_id, document_id: r.document_id || '', title: r.title || '', content: r.content || '',
      vector_score: +r.sim.toFixed(4), rank: i + 1,
    }));

    // ── EVIDENCE UNITS: función + cobertura de query ──
    const units = pool.map(u => {
      const tokens = tokenize(u.content);
      const tSet = new Set(tokens);
      const cov = qTokens.length ? qTokens.filter(t => tSet.has(t)).length / qTokens.length : 0;
      return { ...u, tokens: tSet, coverage: +cov.toFixed(4), fn: classifyFunction(u.title, u.content) };
    });

    // ── CONTROL A: baseline (top-5 sin agregación) ──
    const rankA = pool.slice(0, 5).map(u => u.chunk_id);
    const ctlA = metricsClassic(rankA, goldSet);
    const ctlA_gold_rank = (() => { const i = pool.findIndex(u => goldSet.has(u.chunk_id)); return i === -1 ? -1 : i + 1; })();

    // ── CONTROL B: reproducción R5-C24 (cobertura expected ≥50% en top-50) ──
    const in50 = pool.slice(0, 50).filter(u => goldSet.has(u.chunk_id)).length;
    const ev50 = in50 / Math.max(1, goldAll.length);
    const ctlB_sufficient = ev50 >= SUFF_COVERAGE;

    // ── CONTROL C: ORACLE_ONLY (techo: evidencia suficiente si expected ≥50% en top-100) ──
    const in100 = pool.filter(u => goldSet.has(u.chunk_id)).length;
    const ev100 = in100 / Math.max(1, goldAll.length);
    const oracleSufficient = ev100 >= SUFF_COVERAGE;

    // ── EXPERIMENTO D: REAL EVIDENCE AGGREGATOR (sin gold) ──
    // D1. Seleccionar candidatos: cobertura de query > 0 Y score ≥ 0.45 (threshold productivo)
    const candidates = units.filter(u => u.coverage > 0 && u.vector_score >= 0.45);
    // D2. Greedy group desde el mejor chunk
    const group = [];
    const coveredTokens = new Set();
    let contaminated = [];
    for (const u of [...candidates].sort((a, b) => b.vector_score - a.vector_score)) {
      // complementariedad: aporta términos de query NO cubiertos por el grupo
      const newCov = [...u.tokens].filter(t => qTokSet.has(t) && !coveredTokens.has(t));
      if (newCov.length > 0) {
        group.push(u);
        newCov.forEach(t => coveredTokens.add(t));
      } else {
        // redundante o tangencial dentro del grupo
        const overlapWithGroup = group.some(g => {
          const inter = [...g.tokens].filter(t => u.tokens.has(t)).length;
          const minSize = Math.min(g.tokens.size, u.tokens.size);
          return minSize > 0 && inter / minSize >= REDUNDANCY_OVERLAP;
        });
        if (!overlapWithGroup) contaminated.push(u); // score alto sin aporte de query → riesgo de contaminación
      }
      if (group.length >= 8) break; // límite de evidencia por query
    }
    // D3. Sufficiency (sin gold): cobertura de query del grupo + tamaño
    const groupCoverage = qTokens.length ? [...coveredTokens].filter(t => qTokSet.has(t)).length / qTokens.length : 0;
    const hardNegInGroup = group.filter(u => u.coverage === 0).length;
    let aggClass;
    if (group.length === 0) aggClass = 'INSUFFICIENT';
    else if (groupCoverage >= SUFF_COVERAGE && group.length >= 2 && hardNegInGroup === 0) aggClass = 'SUFFICIENT';
    else if (groupCoverage >= PARTIAL_COVERAGE) aggClass = 'PARTIAL';
    else if (hardNegInGroup > group.length / 2) aggClass = 'CONTAMINATED';
    else aggClass = 'INSUFFICIENT';
    // Si no hay nada en top-100 con cobertura → VECTOR_MISS (control negativo cejas_004)
    if (units.every(u => u.coverage === 0)) aggClass = 'VECTOR_MISS';

    // D4. Evaluación post-hoc (solo métrica, no selección): precision/recall/contaminación
    const selectedIds = group.map(u => u.chunk_id);
    const selGold = selectedIds.filter(id => goldSet.has(id)).length;
    const evPrecision = selectedIds.length ? +(selGold / selectedIds.length).toFixed(4) : 0;
    const evRecall = goldAll.length ? +(selGold / goldAll.length).toFixed(4) : 0;
    const hardNegSelected = group.filter(u => !goldSet.has(u.chunk_id) && u.coverage === 0).length;
    const contaminationRate = selectedIds.length ? +(hardNegSelected / selectedIds.length).toFixed(4) : 0;
    const redundantSelected = group.filter(u => !goldSet.has(u.chunk_id) && u.coverage > 0).length;
    // query success: agregador SUFFICIENT Y al menos 1 gold en el grupo
    const querySuccess = aggClass === 'SUFFICIENT' && selGold >= 1;

    perQuery.push({
      query_id: q.query_id,
      domain: q.query_id.split('_')[0],
      was_miss: MISSES.includes(q.query_id),
      candidate_pool_size: pool.length,
      control_A: { metrics: ctlA, best_gold_rank: ctlA_gold_rank },
      control_B: { evidence_recall_50: +ev50.toFixed(4), sufficient: ctlB_sufficient },
      control_C: { oracle_only: true, evidence_recall_100: +ev100.toFixed(4), oracle_sufficient: oracleSufficient },
      aggregator: {
        class: aggClass,
        group_size: group.length,
        group_coverage: +groupCoverage.toFixed(4),
        selected_evidence: selectedIds,
        evidence_precision: evPrecision,
        evidence_recall: evRecall,
        contamination_rate: contaminationRate,
        redundant_selected: redundantSelected,
        query_success: querySuccess,
        contaminated_candidates: contaminated.map(u => u.chunk_id).slice(0, 5),
      },
      gold_counts: { core: goldCore.length, supporting: goldSup.length, total: goldAll.length },
    });
    console.log(`✅ ${q.query_id}: A R@5=${ctlA.r5} | B(50)=${ev50.toFixed(2)}${ctlB_sufficient ? '✓' : ''} | agg=[${aggClass}] size=${group.length} cov=${groupCoverage.toFixed(2)} prec=${evPrecision}${querySuccess ? ' ✓Q' : ''}`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── AGREGADOS ──
  const avg = (fn, list) => { const vals = list.map(fn); return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4); };
  const all = perQuery;
  const aggClasses = {};
  for (const q of all) aggClasses[q.aggregator.class] = (aggClasses[q.aggregator.class] || 0) + 1;
  const querySuccessRate = avg(q => q.aggregator.query_success ? 1 : 0, all);
  const avgPrecision = avg(q => q.aggregator.evidence_precision, all);
  const avgContamination = avg(q => q.aggregator.contamination_rate, all);
  const controlBsufficient = all.filter(q => q.control_B.sufficient).length;
  const oracleSufficientCount = all.filter(q => q.control_C.oracle_sufficient).length;

  const out = {
    experiment: 'R5-C25',
    cycle: 37,
    hypothesis: 'Un mecanismo general de agrupación, complementariedad, deduplicación y scoring de evidencia puede transformar candidatos recuperados en evidencia suficiente para responder, sin contaminación significativa ni regresiones.',
    timestamp: new Date().toISOString(),
    database_guard: 'LOCAL_ONLY (beauty_db @ localhost:5435)',
    production_guard: 'active — aborta si URL no contiene localhost; Railway NO contactada',
    dataset: 'GOLD-V5 (18 queries; 15 no-UNSUPPORTED evaluadas; 55 chunk IDs únicos)',
    baseline: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    configuration: {
      top_k: TOPK,
      suff_coverage: SUFF_COVERAGE,
      partial_coverage: PARTIAL_COVERAGE,
      redundancy_overlap: REDUNDANCY_OVERLAP,
      min_score: 0.45,
      max_evidence_per_query: 8,
      aggregator_inputs: ['query', 'candidate_pool', 'metadata (title/content/document_id)', 'contenido de chunks'],
      aggregator_forbidden: ['gold IDs', 'answer labels', 'información derivada de misses', 'LLM externo'],
    },
    controls: {
      A_baseline: { note: 'retrieval top-5 sin agregación', r5: avg(q => q.control_A.metrics.r5, all), mrr: avg(q => q.control_A.metrics.mrr, all) },
      B_r5c24_reproduction: { note: 'cobertura expected ≥50% en top-50', queries_sufficient: `${controlBsufficient}/${all.length}` },
      C_oracle_only: { note: 'techo con gold (NO cuenta como éxito del agregador)', queries_sufficient: `${oracleSufficientCount}/${all.length}` },
    },
    metrics: {
      aggregator_query_success_rate: querySuccessRate,
      aggregator_evidence_precision_avg: avgPrecision,
      aggregator_contamination_rate_avg: avgContamination,
      aggregator_class_summary: aggClasses,
      aggregator_sufficient_or_partial: (aggClasses.SUFFICIENT || 0) + (aggClasses.PARTIAL || 0),
      controlB_sufficient_count: controlBsufficient,
      oracle_sufficient_count: oracleSufficientCount,
    },
    per_query_results: perQuery.map(q => ({
      query_id: q.query_id, aggregator_class: q.aggregator.class, group_size: q.aggregator.group_size,
      group_coverage: q.aggregator.group_coverage, evidence_precision: q.aggregator.evidence_precision,
      query_success: q.aggregator.query_success, A_r5: q.control_A.metrics.r5,
    })),
    miss_analysis: perQuery.filter(q => q.was_miss).map(q => ({
      query_id: q.query_id,
      aggregator_class: q.aggregator.class,
      query_success: q.aggregator.query_success,
      evidence_precision: q.aggregator.evidence_precision,
      evidence_recall: q.aggregator.evidence_recall,
      group_size: q.aggregator.group_size,
      selected: q.aggregator.selected_evidence,
      contamination_rate: q.aggregator.contamination_rate,
    })),
    contamination_analysis: {
      note: 'contamination_rate = chunks seleccionados sin cobertura de query y no-gold / total seleccionados',
      avg_contamination: avgContamination,
      most_contaminated: perQuery.map(q => ({ query_id: q.query_id, rate: q.aggregator.contamination_rate })).sort((a, b) => b.rate - a.rate).slice(0, 3),
    },
    negative_control: {
      cejas_004: perQuery.find(q => q.query_id === 'cejas_004'),
      expected: 'VECTOR_MISS — el agregador NO debe fabricar evidencia ausente del pool',
    },
    reproducibility: 'RUN A ≡ RUN B (verificar en segunda corrida)',
    verdict: null,
  };
  const outPath = path.join(OUT_DIR, `r5c25_evidence_aggregator_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  Query success (agregador): ${querySuccessRate} | Precision: ${avgPrecision} | Contaminación: ${avgContamination}`);
  console.log(`  Clases: ${JSON.stringify(aggClasses)}`);
  console.log(`  Control B (R5-C24): ${controlBsufficient}/${all.length} | Oracle: ${oracleSufficientCount}/${all.length}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
