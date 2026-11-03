#!/usr/bin/env node
/**
 * backend/scripts/r5c28ControlledEvidenceRoutingExperiment.js
 * CICLO 40 — R5-C28: Controlled Evidence Routing / Selective Multi-Chunk
 *
 * H28: un mecanismo SELECTIVO de activación de multi-chunk evidence (aplicado
 * solo con señales objetivas de insuficiencia/distribución) puede recuperar los
 * casos multi-chunk sin degradar el retrieval normal ni producir falsos
 * SUFFICIENT (cejas_004).
 *
 * Arquitectura: RETRIEVE → ASSESS (señales) → ROUTE → NORMAL | COMPOSE → EVIDENCE
 *
 * CONTROL A: baseline top-5 sin agregación
 * CONTROL B: aggregation indiscriminada (equivalente R5-C25)
 * CONTROL C: selective routing (router pre-registrado)
 *
 * Señales del router (sin gold):
 *  - top1_score, margin12, query_coverage_top5, complement_count,
 *    score_concentration (σ top-10), domain_diversity (top-10)
 *
 * Regla de activación PRE-REGISTRADA (declarada antes de evaluar):
 *  ACTIVATE si query_coverage_top5 < 0.6 AND complement_count >= 2 AND top1_score >= 0.45
 *
 * GATE anti-falso-SUFFICIENT (lección R5-C26, umbral a priori):
 *  SUFFICIENT requiere cobertura >= 0.5 Y >=2 chunks Y >=1 chunk con score >= 0.55
 *  (0.55 = límite superior de la banda de colisión 0.50-0.58 documentada en C15)
 *
 * READ-ONLY. Guarda anti-producción. Uso: node scripts/r5c28ControlledEvidenceRoutingExperiment.js --run=A
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

// ── Parámetros PRE-REGISTRADOS (declarados antes de evaluar; sin tuning sobre Gold) ──
const ROUTER = {
  coverage_activation: 0.6,  // si top-5 cubre <60% de términos de query → sospecha de evidencia distribuida
  min_complement: 2,         // mínimo de candidatos complementarios para activar
  min_top1_score: 0.45,      // umbral productivo
  strong_score: 0.55,        // gate anti-falso-SUFFICIENT: ≥1 chunk con score ≥0.55
  suff_coverage: 0.5,        // cobertura de query para SUFFICIENT
  max_evidence: 8,
};

const STOP = new Set('de la el en y a los del se las por un para con no una su al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mis tu tus suyas esas esos'.split(/\s+/));

function tokenize(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,:;()"'«»]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}

function stddev(vals) {
  if (!vals.length) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
}

function metricsClassic(rankedIds, expSet, kMax = 5) {
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

    // ── RETRIEVAL (top-100 natural, sin tocar) ──
    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + qEmb.join(',') + ']']);
    const pool = res.rows.map((r, i) => ({
      chunk_id: r.chunk_id, document_id: r.document_id || '', title: r.title || '', content: r.content || '',
      vector_score: +r.sim.toFixed(4), rank: i + 1,
    }));

    // términos de query por chunk
    const withCov = pool.map(u => {
      const tSet = new Set(tokenize(u.content));
      const cov = qTokens.length ? qTokens.filter(t => tSet.has(t)).length / qTokens.length : 0;
      return { ...u, tokens: tSet, coverage: +cov.toFixed(4) };
    });

    // ── SEÑALES DEL ROUTER (observables, sin gold) ──
    const top5union = new Set();
    withCov.slice(0, 5).forEach(u => tokenize(u.content).forEach(t => { if (qTokSet.has(t)) top5union.add(t); }));
    const queryCoverageTop5 = qTokens.length ? top5union.size / qTokens.length : 0;
    // complementarios: chunks top-20 con score≥0.45 que aportan términos de query NO cubiertos por el mejor chunk
    const bestChunkTokens = withCov[0] ? withCov[0].tokens : new Set();
    const complementCount = withCov.slice(0, 20).filter(u =>
      u.vector_score >= ROUTER.min_top1_score && [...u.tokens].some(t => qTokSet.has(t) && !bestChunkTokens.has(t))).length;
    const top1Score = withCov[0] ? withCov[0].vector_score : 0;
    const margin12 = withCov.length > 1 ? +(withCov[0].vector_score - withCov[1].vector_score).toFixed(4) : 0;
    const scoreConc = +stddev(withCov.slice(0, 10).map(u => u.vector_score)).toFixed(4);
    const domainDiversity = new Set(withCov.slice(0, 10).map(u => (u.document_id || '?').split('-')[0])).size;

    const signals = { top1_score: top1Score, margin12, query_coverage_top5: +queryCoverageTop5.toFixed(4), complement_count: complementCount, score_concentration: scoreConc, domain_diversity: domainDiversity };

    // ── ROUTER DECISION (regla pre-registrada) ──
    const activate = queryCoverageTop5 < ROUTER.coverage_activation && complementCount >= ROUTER.min_complement && top1Score >= ROUTER.min_top1_score;

    // ── CONTROL A: baseline top-5 ──
    const rankA = withCov.slice(0, 5).map(u => u.chunk_id);
    const ctlA = metricsClassic(rankA, goldSet);

    // ── CONTROL B: aggregation indiscriminada (equivalente R5-C25) ──
    const groupB = [];
    const coveredB = new Set();
    for (const u of withCov.filter(x => x.vector_score >= ROUTER.min_top1_score && x.coverage > 0)) {
      const newT = [...u.tokens].filter(t => qTokSet.has(t) && !coveredB.has(t));
      if (newT.length > 0) { groupB.push(u); newT.forEach(t => coveredB.add(t)); }
      if (groupB.length >= ROUTER.max_evidence) break;
    }
    const covB = qTokens.length ? [...coveredB].filter(t => qTokSet.has(t)).length / qTokens.length : 0;
    const strongB = groupB.some(u => u.vector_score >= ROUTER.strong_score);
    const clsB = groupB.length === 0 ? 'VECTOR_MISS' : (covB >= ROUTER.suff_coverage && groupB.length >= 2 && strongB) ? 'SUFFICIENT' : (covB >= ROUTER.suff_coverage * 0.5) ? 'PARTIAL' : 'INSUFFICIENT';
    const selGoldB = groupB.filter(u => goldSet.has(u.chunk_id)).length;
    const precB = groupB.length ? +(selGoldB / groupB.length).toFixed(4) : 0;
    const qSuccessB = clsB === 'SUFFICIENT' && selGoldB >= 1;
    const falseSuffB = clsB === 'SUFFICIENT' && selGoldB === 0;

    // ── CONTROL C: selective routing ──
    let groupC, clsC, precC, qSuccessC, falseSuffC, selGoldC;
    if (!activate) {
      // NORMAL PATH: se mantiene el top-5 baseline (evidencia = ranking original)
      groupC = withCov.slice(0, 5);
      clsC = 'NORMAL_PATH';
      selGoldC = rankA.filter(id => goldSet.has(id)).length;
      precC = +(selGoldC / 5).toFixed(4);
      qSuccessC = selGoldC >= 1;
      falseSuffC = false;
    } else {
      // COMPOSE PATH: greedy desde el mejor chunk
      const group = [];
      const covered = new Set();
      for (const u of withCov.filter(x => x.vector_score >= ROUTER.min_top1_score && x.coverage > 0)) {
        const newT = [...u.tokens].filter(t => qTokSet.has(t) && !covered.has(t));
        if (newT.length > 0) { group.push(u); newT.forEach(t => covered.add(t)); }
        if (group.length >= ROUTER.max_evidence) break;
      }
      const covC = qTokens.length ? [...covered].filter(t => qTokSet.has(t)).length / qTokens.length : 0;
      const strongC = group.some(u => u.vector_score >= ROUTER.strong_score);
      groupC = group;
      clsC = group.length === 0 ? 'VECTOR_MISS' : (covC >= ROUTER.suff_coverage && group.length >= 2 && strongC) ? 'SUFFICIENT' : (covC >= ROUTER.suff_coverage * 0.5) ? 'PARTIAL' : 'INSUFFICIENT';
      selGoldC = group.filter(u => goldSet.has(u.chunk_id)).length;
      precC = group.length ? +(selGoldC / group.length).toFixed(4) : 0;
      qSuccessC = clsC === 'SUFFICIENT' && selGoldC >= 1;
      falseSuffC = clsC === 'SUFFICIENT' && selGoldC === 0;
    }

    perQuery.push({
      query_id: q.query_id,
      domain: q.query_id.split('_')[0],
      was_miss: MISSES.includes(q.query_id),
      router_signals: signals,
      router_decision: activate ? 'COMPOSE' : 'NORMAL',
      control_A: { metrics: ctlA },
      control_B: { class: clsB, group_size: groupB.length, precision: precB, query_success: qSuccessB, false_sufficient: falseSuffB },
      control_C: { class: clsC, group_size: groupC.length, precision: precC, query_success: qSuccessC, false_sufficient: falseSuffC, selected: groupC.map(u => u.chunk_id).slice(0, 8) },
    });
    console.log(`✅ ${q.query_id}: route=${activate ? 'COMPOSE' : 'NORMAL'} señales(cov5=${queryCoverageTop5.toFixed(2)},comp=${complementCount},top1=${top1Score.toFixed(2)}) | A R@5=${ctlA.r5} | B=[${clsB}] | C=[${clsC}]${qSuccessC ? ' ✓Q' : ''}`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── AGREGADOS ──
  const avg = (fn, list) => { const vals = list.map(fn); return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4); };
  const all = perQuery;
  const classC = {};
  for (const q of all) classC[q.control_C.class] = (classC[q.control_C.class] || 0) + 1;
  const activationRate = avg(q => q.router_decision === 'COMPOSE' ? 1 : 0, all);
  const qSuccessA = avg(q => q.control_A.metrics.r5 > 0 ? 1 : 0, all);
  const qSuccessB = avg(q => q.control_B.query_success ? 1 : 0, all);
  const qSuccessC = avg(q => q.control_C.query_success ? 1 : 0, all);
  const precB = avg(q => q.control_B.precision, all);
  const precC = avg(q => q.control_C.precision, all);
  const falseSuffB = all.filter(q => q.control_B.false_sufficient).length;
  const falseSuffC = all.filter(q => q.control_C.false_sufficient).length;
  // regresiones: queries con Q_success en A (gold en top-5) que pierden Q_success en C
  const regressions = all.filter(q => q.control_A.metrics.r5 > 0 && !q.control_C.query_success && q.control_C.class !== 'NORMAL_PATH').map(q => q.query_id);
  const activated = all.filter(q => q.router_decision === 'COMPOSE');
  const c4 = all.find(q => q.query_id === 'cejas_004');

  const out = {
    experiment: 'R5-C28',
    cycle: 40,
    hypothesis: 'H28: un mecanismo SELECTIVO de activación de multi-chunk evidence (solo con señales objetivas) recupera los casos multi-chunk sin degradar el retrieval normal ni producir falsos SUFFICIENT.',
    timestamp: new Date().toISOString(),
    database_guard: 'LOCAL_ONLY (beauty_db @ localhost:5435)',
    production_guard: 'active — aborta si URL no contiene localhost; Railway NO contactada',
    dataset: 'GOLD-V5 (15 queries no-UNSUPPORTED evaluadas; 55 chunk IDs)',
    baseline: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    router_configuration: ROUTER,
    router_signals_description: {
      top1_score: 'similitud máxima del mejor candidato',
      margin12: 'diferencia top1 - top2',
      query_coverage_top5: 'términos de query cubiertos por la unión de top-5',
      complement_count: 'chunks top-20 con score≥0.45 que aportan términos de query NO cubiertos por el mejor chunk',
      score_concentration: 'desviación estándar de scores top-10',
      domain_diversity: 'dominios distintos en top-10',
    },
    controls: {
      A: 'baseline top-5 sin agregación',
      B: 'aggregation indiscriminada (equivalente R5-C25, con gate strong_score)',
      C: 'selective routing (router pre-registrado; NORMAL_PATH si no activa)',
    },
    metrics: {
      activation_rate: activationRate,
      activated_queries: activated.map(q => q.query_id),
      query_success: { A: qSuccessA, B: qSuccessB, C: qSuccessC },
      evidence_precision: { B: precB, C: precC },
      false_sufficient: { B: falseSuffB, C: falseSuffC },
      regressions_C_vs_A: regressions,
      class_C_summary: classC,
    },
    activation_decisions: perQuery.map(q => ({ query_id: q.query_id, decision: q.router_decision, signals: q.router_signals })),
    evidence_sets: perQuery.map(q => ({ query_id: q.query_id, control_C_class: q.control_C.class, selected: q.control_C.selected })),
    per_query_results: perQuery,
    regressions,
    false_sufficient_cases: { B: all.filter(q => q.control_B.false_sufficient).map(q => q.query_id), C: all.filter(q => q.control_C.false_sufficient).map(q => q.query_id) },
    unsupported_cases: all.filter(q => q.control_C.class === 'VECTOR_MISS' || q.control_C.class === 'INSUFFICIENT').map(q => ({ query_id: q.query_id, class: q.control_C.class })),
    miss_analysis: {
      cabello_002: perQuery.find(q => q.query_id === 'cabello_002'),
      cejas_008: perQuery.find(q => q.query_id === 'cejas_008'),
      cejas_004: c4 ? { signals: c4.router_signals, decision: c4.router_decision, B: c4.control_B, C: c4.control_C, gate_check: c4.control_C.class !== 'SUFFICIENT' ? 'GATE OK — no falso SUFFICIENT' : 'REGRESIÓN — falso SUFFICIENT' } : null,
    },
    reproducibility: 'RUN A ≡ RUN B (verificar en segunda corrida)',
    verdict: null,
  };
  const outPath = path.join(OUT_DIR, `r5c28_controlled_evidence_routing_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  Activation rate: ${activationRate} | Q_success: A=${qSuccessA} B=${qSuccessB} C=${qSuccessC}`);
  console.log(`  Precision: B=${precB} C=${precC} | False-sufficient: B=${falseSuffB} C=${falseSuffC}`);
  console.log(`  Regresiones C vs A: ${regressions.length} (${regressions.join(', ') || 'ninguna'})`);
  console.log(`  cejas_004: C=[${c4 ? c4.control_C.class : '?'}]`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
