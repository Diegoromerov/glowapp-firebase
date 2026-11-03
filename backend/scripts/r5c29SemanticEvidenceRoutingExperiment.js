#!/usr/bin/env node
/**
 * backend/scripts/r5c29SemanticEvidenceRoutingExperiment.js
 * CICLO 41 — R5-C29: Semantic Evidence Routing (read-only, determinista, sin gold)
 *
 * H29: las señales SEMÁNTICAS del retrieval vectorial actual pueden identificar
 * cuándo una query tiene evidencia incompleta y necesita composición multi-chunk,
 * mejor que las señales léxicas (C28), sin gold leakage y sin reordenar candidatos.
 *
 * CONTROLES:
 *  A = baseline (sin routing, sin aggregation)
 *  B = LEXICAL routing (regla C28 reproducida: cov5<0.6 AND comp>=2 AND top1>=0.45)
 *  C = SEMANTIC routing (regla nueva, PRE-REGISTRADA)
 *
 * SEÑALES SEMÁNTICAS (calculadas después del retrieval; sin gold):
 *  score_top1/2/3, margin12, margin13, score_drop_12, score_mean_top5,
 *  score_std_top5, density_top3 (nº de top-20 con score>=top1-0.05),
 *  diversity_top5 (dominios distintos en top-5), concentration (top1/mean_top5)
 *
 * REGLA SEMÁNTICA PRE-REGISTRADA (declarada antes de ejecutar):
 *  ACTIVATE si margin12 < 0.02 AND density_top3 >= 3 AND score_top1 >= 0.45
 *  (competición estrecha + múltiples candidatos cercanos + evidencia real)
 *
 * GATE anti-falso-SUFFICIENT (heredado C28, hallazgo reutilizable):
 *  SUFFICIENT requiere cobertura>=0.5 Y >=2 chunks Y >=1 chunk con score>=0.55
 *
 * READ-ONLY. Guarda anti-producción. Uso: node scripts/r5c29SemanticEvidenceRoutingExperiment.js --run=A
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

// ── Parámetros PRE-REGISTRADOS (declarados antes de evaluar) ──
const SEMANTIC_ROUTER = {
  margin12_activation: 0.02,   // competición estrecha entre top1 y top2
  density_min: 3,              // mínimo de candidatos en banda top1-0.05
  min_top1_score: 0.45,        // umbral productivo
  strong_score: 0.55,          // gate anti-falso-SUFFICIENT (C28)
  suff_coverage: 0.5,
  max_evidence: 8,
};
const LEXICAL_ROUTER = { // control B = regla C28 exacta
  coverage_activation: 0.6,
  min_complement: 2,
  min_top1_score: 0.45,
  strong_score: 0.55,
  suff_coverage: 0.5,
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

// Composición (compartida por B y C): greedy desde el mejor chunk con score>=0.45 y cobertura>0
function compose(withCov, qTokSet, qTokens, cfg) {
  const group = [];
  const covered = new Set();
  for (const u of withCov.filter(x => x.vector_score >= cfg.min_top1_score && x.coverage > 0)) {
    const newT = [...u.tokens].filter(t => qTokSet.has(t) && !covered.has(t));
    if (newT.length > 0) { group.push(u); newT.forEach(t => covered.add(t)); }
    if (group.length >= cfg.max_evidence) break;
  }
  const cov = qTokens.length ? [...covered].filter(t => qTokSet.has(t)).length / qTokens.length : 0;
  const strong = group.some(u => u.vector_score >= cfg.strong_score);
  const cls = group.length === 0 ? 'VECTOR_MISS'
    : (cov >= cfg.suff_coverage && group.length >= 2 && strong) ? 'SUFFICIENT'
    : (cov >= cfg.suff_coverage * 0.5) ? 'PARTIAL' : 'INSUFFICIENT';
  return { group, cls, cov };
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
    const withCov = pool.map(u => {
      const tSet = new Set(tokenize(u.content));
      const cov = qTokens.length ? qTokens.filter(t => tSet.has(t)).length / qTokens.length : 0;
      return { ...u, tokens: tSet, coverage: +cov.toFixed(4) };
    });

    // ── SEÑALES SEMÁNTICAS (sin gold, sin reordenar) ──
    const s = withCov.map(u => u.vector_score);
    const scoreTop1 = s[0] || 0, scoreTop2 = s[1] || 0, scoreTop3 = s[2] || 0;
    const margin12 = +(scoreTop1 - scoreTop2).toFixed(4);
    const margin13 = +(scoreTop1 - scoreTop3).toFixed(4);
    const drop12 = scoreTop1 > 0 ? +((scoreTop1 - scoreTop2) / scoreTop1).toFixed(4) : 0;
    const meanTop5 = +(s.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, s.length)).toFixed(4);
    const stdTop5 = +stddev(s.slice(0, 5)).toFixed(4);
    const densityTop3 = withCov.slice(0, 20).filter(u => u.vector_score >= scoreTop1 - 0.05).length;
    const diversityTop5 = new Set(withCov.slice(0, 5).map(u => (u.document_id || '?').split('-')[0])).size;
    const concentration = meanTop5 > 0 ? +(scoreTop1 / meanTop5).toFixed(4) : 0;

    const signals = { score_top1: scoreTop1, score_top2: scoreTop2, score_top3: scoreTop3, margin12, margin13, score_drop_12: drop12, score_mean_top5: meanTop5, score_std_top5: stdTop5, density_top3: densityTop3, diversity_top5: diversityTop5, concentration };

    // ── CONTROL A: baseline top-5 ──
    const rankA = withCov.slice(0, 5).map(u => u.chunk_id);
    const hitsA = rankA.filter(id => goldSet.has(id)).length;
    const ctlA = { r5: +(hitsA / Math.max(1, goldAll.length)).toFixed(4), mrr: (() => { for (let i = 0; i < 5; i++) if (goldSet.has(rankA[i])) return +(1 / (i + 1)).toFixed(4); return 0; })() };

    // ── CONTROL B: LEXICAL routing (regla C28 exacta) ──
    const top5union = new Set();
    withCov.slice(0, 5).forEach(u => tokenize(u.content).forEach(t => { if (qTokSet.has(t)) top5union.add(t); }));
    const queryCoverageTop5 = qTokens.length ? top5union.size / qTokens.length : 0;
    const bestChunkTokens = withCov[0] ? withCov[0].tokens : new Set();
    const complementCount = withCov.slice(0, 20).filter(u =>
      u.vector_score >= LEXICAL_ROUTER.min_top1_score && [...u.tokens].some(t => qTokSet.has(t) && !bestChunkTokens.has(t))).length;
    const activateLexical = queryCoverageTop5 < LEXICAL_ROUTER.coverage_activation && complementCount >= LEXICAL_ROUTER.min_complement && scoreTop1 >= LEXICAL_ROUTER.min_top1_score;

    let clsB, qSuccessB, precB, groupB;
    if (!activateLexical) {
      clsB = 'NORMAL_PATH'; groupB = withCov.slice(0, 5);
      const g = groupB.filter(u => goldSet.has(u.chunk_id)).length;
      precB = +(g / 5).toFixed(4); qSuccessB = g >= 1;
    } else {
      const c = compose(withCov, qTokSet, qTokens, LEXICAL_ROUTER);
      groupB = c.group; clsB = c.cls;
      const g = groupB.filter(u => goldSet.has(u.chunk_id)).length;
      precB = groupB.length ? +(g / groupB.length).toFixed(4) : 0;
      qSuccessB = clsB === 'SUFFICIENT' && g >= 1;
    }

    // ── CONTROL C: SEMANTIC routing (regla nueva pre-registrada) ──
    const activateSemantic = margin12 < SEMANTIC_ROUTER.margin12_activation && densityTop3 >= SEMANTIC_ROUTER.density_min && scoreTop1 >= SEMANTIC_ROUTER.min_top1_score;

    let clsC, qSuccessC, precC, groupC;
    if (!activateSemantic) {
      clsC = 'NORMAL_PATH'; groupC = withCov.slice(0, 5);
      const g = groupC.filter(u => goldSet.has(u.chunk_id)).length;
      precC = +(g / 5).toFixed(4); qSuccessC = g >= 1;
    } else {
      const c = compose(withCov, qTokSet, qTokens, SEMANTIC_ROUTER);
      groupC = c.group; clsC = c.cls;
      const g = groupC.filter(u => goldSet.has(u.chunk_id)).length;
      precC = groupC.length ? +(g / groupC.length).toFixed(4) : 0;
      qSuccessC = clsC === 'SUFFICIENT' && g >= 1;
    }

    perQuery.push({
      query_id: q.query_id,
      domain: q.query_id.split('_')[0],
      was_miss: MISSES.includes(q.query_id),
      semantic_signals: signals,
      routing_decision: { lexical: activateLexical ? 'COMPOSE' : 'NORMAL', semantic: activateSemantic ? 'COMPOSE' : 'NORMAL' },
      control_A: { r5: ctlA.r5, mrr: ctlA.mrr, top5: rankA },
      control_B: { class: clsB, group_size: groupB.length, precision: precB, query_success: qSuccessB, false_sufficient: clsB === 'SUFFICIENT' && groupB.filter(u => goldSet.has(u.chunk_id)).length === 0 },
      control_C: { class: clsC, group_size: groupC.length, precision: precC, query_success: qSuccessC, false_sufficient: clsC === 'SUFFICIENT' && groupC.filter(u => goldSet.has(u.chunk_id)).length === 0, selected: groupC.map(u => u.chunk_id).slice(0, 8) },
    });
    console.log(`✅ ${q.query_id}: sem(act=${activateSemantic ? 'COMPOSE' : 'NORMAL'}, m12=${margin12}, d=${densityTop3}) vs lex(act=${activateLexical ? 'COMPOSE' : 'NORMAL'}) | A r5=${ctlA.r5} | C=[${clsC}]${qSuccessC ? ' ✓Q' : ''}`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── AGREGADOS ──
  const avg = (fn, list) => { const vals = list.map(fn); return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4); };
  const all = perQuery;

  // Matriz de confusión del router semántico: REAL COMPOSE = queries con evidencia multi-chunk recuperable
  // (B_MULTI_CHUNK de C27: cabello_002, cejas_008) + cejas_004 (retrieval miss — NO composable)
  const realCompose = new Set(['cabello_002', 'cejas_008']);
  const conf = { TP: 0, FP: 0, FN: 0, TN: 0 };
  for (const q of all) {
    const routed = q.routing_decision.semantic === 'COMPOSE';
    const real = realCompose.has(q.query_id);
    if (routed && real) conf.TP++;
    else if (routed && !real) conf.FP++;
    else if (!routed && real) conf.FN++;
    else conf.TN++;
  }
  // Matriz para el router léxico
  const confL = { TP: 0, FP: 0, FN: 0, TN: 0 };
  for (const q of all) {
    const routed = q.routing_decision.lexical === 'COMPOSE';
    const real = realCompose.has(q.query_id);
    if (routed && real) confL.TP++;
    else if (routed && !real) confL.FP++;
    else if (!routed && real) confL.FN++;
    else confL.TN++;
  }

  const classC = {};
  for (const q of all) classC[q.control_C.class] = (classC[q.control_C.class] || 0) + 1;
  const classB = {};
  for (const q of all) classB[q.control_B.class] = (classB[q.control_B.class] || 0) + 1;

  // Estadísticas de señales: media por grupo (multi-chunk vs resto) — DESCRIPTIVO, sin tuning
  const mc = all.filter(q => realCompose.has(q.query_id));
  const rest = all.filter(q => !realCompose.has(q.query_id));
  const signalStats = {};
  for (const sig of ['margin12', 'score_drop_12', 'density_top3', 'score_std_top5', 'concentration', 'diversity_top5', 'score_top1']) {
    signalStats[sig] = {
      multi_chunk_avg: +mc.reduce((a, q) => a + q.semantic_signals[sig], 0) / mc.length,
      resto_avg: +rest.reduce((a, q) => a + q.semantic_signals[sig], 0) / rest.length,
    };
  }

  const out = {
    experiment: 'R5-C29',
    cycle: 41,
    hypothesis: 'H29: las señales SEMÁNTICAS del retrieval actual pueden identificar cuándo una query necesita composición multi-chunk, mejor que las señales léxicas, sin gold leakage ni reordenamiento.',
    timestamp: new Date().toISOString(),
    database_guard: 'LOCAL_ONLY (beauty_db @ localhost:5435)',
    production_guard: 'active — aborta si URL no contiene localhost; Railway NO contactada',
    dataset: 'GOLD-V5 (15 queries no-UNSUPPORTED; 55 chunk IDs)',
    baseline: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    semantic_signals: {
      score_top1: 'similitud máxima',
      score_top2: 'segunda mejor similitud',
      score_top3: 'tercera mejor similitud',
      margin12: 'top1 - top2',
      margin13: 'top1 - top3',
      score_drop_12: '(top1-top2)/top1 — caída relativa',
      score_mean_top5: 'media de top-5',
      score_std_top5: 'desviación estándar de top-5',
      density_top3: 'candidatos top-20 con score ≥ top1-0.05',
      diversity_top5: 'dominios distintos en top-5',
      concentration: 'top1 / media top-5',
    },
    router_configuration: {
      semantic: SEMANTIC_ROUTER,
      lexical_control: LEXICAL_ROUTER,
      note: 'Reglas PRE-REGISTRADAS antes de ejecutar. Análisis de señales DESCRIPTIVO (sin tuning sobre Gold).',
    },
    signal_statistics: signalStats,
    controls: {
      A: 'baseline top-5 sin routing',
      B: 'LEXICAL routing (regla C28 exacta, control)',
      C: 'SEMANTIC routing (regla nueva)',
    },
    metrics: {
      activation: { semantic: avg(q => q.routing_decision.semantic === 'COMPOSE' ? 1 : 0, all), lexical: avg(q => q.routing_decision.lexical === 'COMPOSE' ? 1 : 0, all) },
      query_success: { A: avg(q => q.control_A.r5 > 0 ? 1 : 0, all), B: avg(q => q.control_B.query_success ? 1 : 0, all), C: avg(q => q.control_C.query_success ? 1 : 0, all) },
      precision: { B: avg(q => q.control_B.precision, all), C: avg(q => q.control_C.precision, all) },
      false_sufficient: { B: all.filter(q => q.control_B.false_sufficient).map(q => q.query_id), C: all.filter(q => q.control_C.false_sufficient).map(q => q.query_id) },
      class_B_summary: classB,
      class_C_summary: classC,
    },
    routing_decisions: perQuery.map(q => ({ query_id: q.query_id, semantic: q.routing_decision.semantic, lexical: q.routing_decision.lexical, signals: q.semantic_signals })),
    confusion_matrix: {
      real_compose_definition: 'cabello_002 + cejas_008 (B_MULTI_CHUNK de C27)',
      semantic: conf,
      lexical: confL,
      semantic_precision: conf.TP + conf.FP > 0 ? +(conf.TP / (conf.TP + conf.FP)).toFixed(4) : 0,
      semantic_recall: conf.TP + conf.FN > 0 ? +(conf.TP / (conf.TP + conf.FN)).toFixed(4) : 0,
    },
    critical_cases: {
      cejas_004: perQuery.find(q => q.query_id === 'cejas_004') ? { routing: perQuery.find(q => q.query_id === 'cejas_004').routing_decision, C: perQuery.find(q => q.query_id === 'cejas_004').control_C, gate: perQuery.find(q => q.query_id === 'cejas_004').control_C.class !== 'SUFFICIENT' ? 'GATE OK' : 'FALSO SUFFICIENT' } : null,
      cabello_002: perQuery.find(q => q.query_id === 'cabello_002') ? { routing: perQuery.find(q => q.query_id === 'cabello_002').routing_decision, C: perQuery.find(q => q.query_id === 'cabello_002').control_C } : null,
      cejas_008: perQuery.find(q => q.query_id === 'cejas_008') ? { routing: perQuery.find(q => q.query_id === 'cejas_008').routing_decision, C: perQuery.find(q => q.query_id === 'cejas_008').control_C } : null,
    },
    per_query_results: perQuery,
    regressions: all.filter(q => q.control_A.r5 > 0 && !q.control_C.query_success && q.control_C.class !== 'NORMAL_PATH').map(q => q.query_id),
    reproducibility: 'RUN A ≡ RUN B (verificar en segunda corrida)',
    verdict: null,
  };
  const outPath = path.join(OUT_DIR, `r5c29_semantic_evidence_routing_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  Confusión SEMÁNTICA: ${JSON.stringify(conf)} | LÉXICA: ${JSON.stringify(confL)}`);
  console.log(`  Activación: sem=${out.metrics.activation.semantic} lex=${out.metrics.activation.lexical}`);
  console.log(`  Q_success: A=${out.metrics.query_success.A} B=${out.metrics.query_success.B} C=${out.metrics.query_success.C}`);
  console.log(`  cejas_004 C=[${perQuery.find(q => q.query_id === 'cejas_004').control_C.class}]`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
