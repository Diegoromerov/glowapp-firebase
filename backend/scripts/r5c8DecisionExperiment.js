#!/usr/bin/env node
/**
 * backend/scripts/r5c8DecisionExperiment.js
 * CICLO 20 — R5-C8: Consolidación de decisión causal (read-only)
 *
 * NO ejecuta retrieval nuevo: lee los artefactos R5-C6/R5-C7 y produce
 * la matriz causal + decisión R5-C9 como artefacto JSON.
 *
 * Verifica integridad de BD local (SELECT COUNT/NULL/dims) y guarda anti-producción.
 *
 * Uso: node scripts/r5c8DecisionExperiment.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');

const EVAL_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

async function main() {
  const args = process.argv.slice(2);
  const run = (args.find(a => a.startsWith('--run=')) || '--run=A').split('=')[1];

  // ── GUARDA ANTI-PRODUCCIÓN ──
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO.');
    process.exit(1);
  }

  // ── Integridad BD (SELECT only) ──
  const count = await ragPool.query('SELECT COUNT(*)::int AS n FROM beauty_knowledge_embeddings');
  const nulls = await ragPool.query('SELECT COUNT(*)::int AS n FROM beauty_knowledge_embeddings WHERE embedding IS NULL');
  const dims = await ragPool.query('SELECT vector_dims(embedding) AS d FROM beauty_knowledge_embeddings LIMIT 1');
  console.log(`BD: ${count.rows[0].n} filas | ${nulls.rows[0].n} NULL | ${dims.rows[0].d}d`);

  // ── Leer evidencia ──
  const c7 = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'r5c7_corpus_coverage_experiment.json'), 'utf8'));
  const c6 = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'r5c6_query_corpus_coverage_a.json'), 'utf8'));
  const audit = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'r5c7_corpus_coverage_audit_a.json'), 'utf8'));
  const qAudit = Object.fromEntries(audit.per_query.map(q => [q.query_id, q]));
  const q6 = Object.fromEntries(c6.per_query.map(q => [q.query_id, q]));

  const cov = { 'skincare_003':'FULL','skincare_005':'FULL','skincare_006':'FULL','skincare_007':'PART','skincare_008':'FULL','skincare_009':'FULL','skincare_010':'FULL','cabello_002':'FULL','cabello_004':'NO','cabello_006':'PART','cabello_008':'FULL','cejas_001':'PART','cejas_002':'NO','cejas_003':'NO','cejas_004':'PART','cejas_005':'FULL','cejas_007':'FULL','cejas_008':'PART' };
  const gtMis = new Set(['skincare_005','skincare_006','skincare_009','skincare_010','cabello_002','cabello_008','cejas_001','cejas_005','cejas_007']);

  // Matriz causal por query
  const per_query = [];
  for (const q of audit.per_query) {
    const qid = q.query_id;
    const paraM0 = q6[qid].q0.metrics_official.mrr;
    const paraM2 = q6[qid].q2.metrics_official.mrr;
    const para = paraM2 > paraM0 ? 'MEJORA' : (paraM2 < paraM0 ? 'EMPEORA' : 'NEUTRA');
    const h5 = q.expected_in_hnsw_top5 > 0;
    const h20 = q.expected_in_hnsw_top20 > 0;
    const e20 = q.expected_in_exact_top20 > 0;
    // Causa primaria
    let primary;
    if (cov[qid] === 'NO') primary = 'CORPUS';
    else if (gtMis.has(qid) && (h20 || e20)) primary = 'GROUND_TRUTH';
    else if (gtMis.has(qid) && !h20 && !e20) primary = 'GROUND_TRUTH+RETRIEVAL';
    else if (h5) primary = 'OK';
    else if (h20) primary = 'RANKING';
    else primary = 'RETRIEVAL/EMBEDDING';
    per_query.push({
      query_id: qid, domain: q.category, coverage: cov[qid],
      gt_misaligned: gtMis.has(qid),
      hnsw_top5: h5, hnsw_top20: h20, exact_top20: e20,
      best_expected_rank: q.best_expected_rank_hnsw,
      paraphrase_effect: para,
      primary_cause: primary,
    });
  }

  // Grupos FASE 3
  const groups = { g1: [], g2: [], g3: [], g4: [], g5: [] };
  for (const p of per_query) {
    if (p.coverage === 'NO') groups.g5.push(p.query_id);
    else if (p.hnsw_top5) groups.g1.push(p.query_id);
    else if (p.hnsw_top20) groups.g2.push(p.query_id);
    else if (p.exact_top20) groups.g3.push(p.query_id);
    else groups.g4.push(p.query_id);
  }

  const out = {
    cycle: '20', experiment: 'R5-C8', database: 'LOCAL_ONLY', production_contacted: false,
    official_baseline_unchanged: true, queries_valid: 18,
    generated_at: new Date().toISOString(), run,
    bd_integrity: { rows: count.rows[0].n, nulls: nulls.rows[0].n, dims: dims.rows[0].d },
    evidence_sources: ['r5c7_corpus_coverage_experiment.json', 'r5c7_corpus_coverage_audit_a.json', 'r5c6_query_corpus_coverage_a.json'],
    matrix_causal: per_query,
    groups: {
      G1_corpus_evidence_hnsw_top5: { n: groups.g1.length, queries: groups.g1, interpretation: 'retrieval satisfactorio' },
      G2_hnsw_top20_no_top5: { n: groups.g2.length, queries: groups.g2, interpretation: 'ranking/profundidad contribuye' },
      G3_exact_si_hnsw_no: { n: groups.g3.length, queries: groups.g3, interpretation: 'posible limitación HNSW' },
      G4_expected_ni_exact_top20: { n: groups.g4.length, queries: groups.g4, interpretation: 'embedding/query o GT incorrecto' },
      G5_sin_cobertura: { n: groups.g5.length, queries: groups.g5, interpretation: 'corpus sin evidencia' },
    },
    causal_counts: {
      GROUND_TRUTH: per_query.filter(p => p.primary_cause.startsWith('GROUND_TRUTH')).length,
      CORPUS: per_query.filter(p => p.primary_cause === 'CORPUS').length,
      RANKING: per_query.filter(p => p.primary_cause === 'RANKING').length,
      RETRIEVAL_EMBEDDING: per_query.filter(p => p.primary_cause === 'RETRIEVAL/EMBEDDING').length,
      OK: per_query.filter(p => p.primary_cause === 'OK').length,
    },
    cejas_analysis: per_query.filter(p => p.domain === 'cejas'),
    query_rewriting_decision: {
      global_q0_mrr: c6.metrics.q0.mrr,
      global_q2_mrr: c6.metrics.q2.mrr,
      improved_by_q2: per_query.filter(p => p.paraphrase_effect === 'MEJORA').map(p => p.query_id),
      worsened_by_q2: per_query.filter(p => p.paraphrase_effect === 'EMPEORA').map(p => p.query_id),
      verdict: 'QUERY REWRITING global NO justificado (efecto ~neutro: Q2 MRR 0.218 vs Q0 0.222); solo beneficia 4 queries de cejas',
    },
    decision_r5c9: {
      option: 'A — CORREGIR BENCHMARK OFICIAL (con G: combinar re-clasificación UNSUPPORTED)',
      rationale: '9/18 queries GT misaligned (50%) con evidencia E3 recuperada; candidate R5-C2 R@5=0.50 sin tocar motor; HNSW 0 misses; reranking descartado; query rewriting global no justificado',
      evidence: 'R5-C2 candidate R@5 0.50 / MRR 0.37; R5-C6 8-9/18 GT misaligned; R5-C7 G4=5 (2 GT + 3 embedding/query)',
      impact_esperado: 'R@5 0.17→0.50, MRR 0.22→0.37 [EXPERIMENTAL — NO OFICIAL]',
      riesgo: 'bajo (solo benchmark; requiere validación de cada expected corregido)',
      coste: 'bajo (revisión manual de 18 queries con evidencia acumulada)',
      confianza: 'ALTA',
    },
    rejected_options: {
      B_ampliar_corpus: { verdict: 'DIFERIDO', reason: '3/18 NO_COVERAGE reales; ampliar corpus para 3 queries no justifica el coste antes de corregir benchmark' },
      C_query_rewriting: { verdict: 'NO GLOBAL', reason: 'Q2 MRR 0.218 vs 0.222; solo cejas_002/004/007/008 mejoran; se puede probar acotado a cejas en R5-C9' },
      D_retrieval: { verdict: 'NO', reason: 'HNSW 0 misses; retrieval recupera evidencia E3 en FULL_COVERAGE; el fallo es del benchmark' },
      E_embeddings: { verdict: 'NO AUTORIZAR', reason: 'gap -0.0116 mezclado con GT desalineado; sin modelo candidato local; falta prueba controlada' },
      F_hnsw: { verdict: 'DESCARTADO', reason: '0 misses vs exact en top-20 (R5-C7)' },
    },
  };
  const outPath = path.join(EVAL_DIR, `r5c8_decision_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
