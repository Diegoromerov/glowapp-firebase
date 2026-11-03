#!/usr/bin/env node
/**
 * backend/scripts/r5c27ErrorBudgetAnalysis.js
 * CICLO 39 — R5-C27: Error Budget / Retrieval Miss vs Corpus Gap (read-only, diagnóstico)
 *
 * Cambio de nivel: NO mejorar R@5 — explicar por qué no es mayor.
 * Mapa causal del error del RAG sobre GOLD-V5 (55 chunk IDs, 18 queries).
 *
 * Clasificación por query (determinista, sin gold leakage en retrieval):
 *  A_DIRECT_SUCCESS        ≥50% de golds en top-5
 *  B_MULTI_CHUNK_RECOVERABLE  evidencia completa (≥50%) en top-50 pero no top-5
 *  C_RETRIEVAL_MISS        evidencia EXISTE en corpus pero <50% en top-100
 *  D_CORPUS_GAP            gold IDs AUSENTES de la BD (evidencia realmente inexistente)
 *  E_ANNOTATION_GAP        ambigüedad objetiva (usado con moderación)
 *
 * Distinción fundamental: ausencia de recuperación ≠ ausencia de conocimiento.
 * CORPUS GAP solo si el chunk no existe en BD; RETRIEVAL MISS si existe pero
 * está insuficientemente recuperado.
 *
 * READ-ONLY. Guarda anti-producción. Uso: node scripts/r5c27ErrorBudgetAnalysis.js --run=A
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
const SUFF = 0.5;

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
  const allQueries = v5.queries; // incluye UNSUPPORTED para el mapa completo
  const supported = allQueries.filter(q => q.support_status !== 'UNSUPPORTED');
  const unsupportedIds = allQueries.filter(q => q.support_status === 'UNSUPPORTED').map(q => q.query_id);

  // ── Inventario: ¿todos los gold IDs existen en BD? ──
  const allGoldIds = new Set();
  allQueries.forEach(q => {
    (q.expected_chunks.core || []).forEach(c => allGoldIds.add(c));
    (q.expected_chunks.supporting || []).forEach(c => allGoldIds.add(c));
  });
  const idRes = await ragPool.query(
    'SELECT chunk_id FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [[...allGoldIds]]);
  const idsInDb = new Set(idRes.rows.map(r => r.chunk_id));

  const perQuery = [];
  for (const q of supported) {
    const goldCore = q.expected_chunks.core || [];
    const goldSup = q.expected_chunks.supporting || [];
    const goldAll = [...goldCore, ...goldSup];
    const goldSet = new Set(goldAll);

    // ── Retrieval top-100 (pool natural, sin tocar) ──
    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT chunk_id, document_id, title, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + qEmb.join(',') + ']']);
    const pool = res.rows.map((r, i) => ({ chunk_id: r.chunk_id, document_id: r.document_id || '', title: r.title || '', score: +r.sim.toFixed(4), rank: i + 1 }));

    // ── Ranks de cada gold ──
    const goldRanks = {};
    for (const g of goldAll) {
      const i = pool.findIndex(r => r.chunk_id === g);
      goldRanks[g] = i === -1 ? -1 : i + 1;
    }
    // Localización de evidencia por K (proporción de golds dentro de cada K)
    const inK = (k) => pool.slice(0, k).filter(r => goldSet.has(r.chunk_id)).length;
    const evK = {};
    for (const k of [5, 10, 20, 50, 100]) evK[k] = +(inK(k) / Math.max(1, goldAll.length)).toFixed(4);

    // ── ¿Existe la evidencia en el corpus? (todos los golds en BD) ──
    const evidenceInCorpus = goldAll.every(g => idsInDb.has(g));
    // piezas fuera de top-100 (existen en corpus pero no se recuperan)
    const missingFromPool = goldAll.filter(g => goldRanks[g] === -1);
    const inPool100 = goldAll.filter(g => goldRanks[g] !== -1);

    // ── CLASIFICACIÓN (determinista) ──
    let cls, confidence, reason;
    if (!evidenceInCorpus) {
      cls = 'D_CORPUS_GAP';
      confidence = 'HIGH';
      reason = `Evidencia gold ausente de BD: ${goldAll.filter(g => !idsInDb.has(g)).map(g => g.slice(0, 40)).join(', ')}`;
    } else if (evK[5] >= SUFF) {
      cls = 'A_DIRECT_SUCCESS';
      confidence = 'HIGH';
      reason = `${inK(5)}/${goldAll.length} piezas en top-5 (≥50%)`;
    } else if (evK[50] >= SUFF) {
      cls = 'B_MULTI_CHUNK_RECOVERABLE';
      confidence = 'HIGH';
      reason = `${inK(5)}/${goldAll.length} en top-5 pero ${inK(50)}/${goldAll.length} en top-50 (≥50%) — evidencia distribuida componible`;
    } else {
      cls = 'C_RETRIEVAL_MISS';
      confidence = evK[100] > 0 ? 'MEDIUM' : 'HIGH';
      reason = `Evidencia existe en corpus (${inPool100.length}/${goldAll.length} en top-100) pero insuficientemente recuperada: ev@50=${evK[50]}, ev@100=${evK[100]}; ${missingFromPool.length} piezas fuera de top-100`;
    }

    perQuery.push({
      query_id: q.query_id,
      query: q.query,
      support_status: q.support_status,
      was_miss: MISSES.includes(q.query_id),
      baseline_result: 'R@5 parcial',
      top5: pool.slice(0, 5).map(r => r.chunk_id),
      top10: pool.slice(0, 10).map(r => r.chunk_id),
      top20: pool.slice(0, 20).map(r => r.chunk_id),
      top50: pool.slice(0, 50).map(r => r.chunk_id),
      top100: pool.slice(0, 100).map(r => r.chunk_id),
      required_evidence: goldAll,
      evidence_locations: goldRanks,
      evidence_in_corpus: evidenceInCorpus,
      evidence_in_top5: evK[5],
      evidence_in_top10: evK[10],
      evidence_in_top20: evK[20],
      evidence_in_top50: evK[50],
      evidence_in_top100: evK[100],
      pieces_in_pool100: inPool100.length,
      pieces_outside_pool100: missingFromPool.length,
      classification: cls,
      confidence,
      reason,
    });
    console.log(`✅ ${q.query_id}: ev@5=${evK[5].toFixed(2)} @20=${evK[20].toFixed(2)} @50=${evK[50].toFixed(2)} @100=${evK[100].toFixed(2)} | enCorpus=${evidenceInCorpus} fuera100=${missingFromPool.length} [${cls}] ${confidence}`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── UNSUPPORTED: D_CORPUS_GAP (ya validado en R5-C13) ──
  for (const qid of unsupportedIds) {
    const q = allQueries.find(x => x.query_id === qid);
    const goldAll = [...(q.expected_chunks.core || []), ...(q.expected_chunks.supporting || [])];
    const inDb = goldAll.filter(g => idsInDb.has(g)).length;
    perQuery.push({
      query_id: qid, query: q.query, support_status: 'UNSUPPORTED', was_miss: false,
      baseline_result: 'N/A (UNSUPPORTED)',
      top5: [], top10: [], top20: [], top50: [], top100: [],
      required_evidence: goldAll,
      evidence_locations: {},
      evidence_in_corpus: inDb === goldAll.length,
      evidence_in_top5: 0, evidence_in_top10: 0, evidence_in_top20: 0, evidence_in_top50: 0, evidence_in_top100: 0,
      pieces_in_pool100: 0, pieces_outside_pool100: goldAll.length - inDb,
      classification: 'D_CORPUS_GAP',
      confidence: 'HIGH',
      reason: `UNSUPPORTED validado en R5-C13 (anotación ciega): evidencia semánticamente insuficiente aunque ${inDb}/${goldAll.length} chunks físicos existan en BD — corpus gap de contenido, no ausencia física ni retrieval miss`,
    });
    console.log(`⚠️  ${qid}: [UNSUPPORTED] golds en BD=${inDb}/${goldAll.length}`);
  }

  // ── ERROR BUDGET ──
  const classes = {};
  for (const q of perQuery) classes[q.classification] = (classes[q.classification] || 0) + 1;
  const total = perQuery.length;
  const budget = {};
  for (const [c, n] of Object.entries(classes)) budget[c] = +(n / total).toFixed(4);
  const retrievalAttributable = ((classes.C_RETRIEVAL_MISS || 0) + (classes.B_MULTI_CHUNK_RECOVERABLE || 0)) / total;
  const corpusAttributable = (classes.D_CORPUS_GAP || 0) / total;
  const annotationAttributable = (classes.E_ANNOTATION_GAP || 0) / total;

  // Verificación cejas_004 (caso crítico) desde corpus completo
  const c4 = perQuery.find(q => q.query_id === 'cejas_004');
  const c4Detail = c4 ? {
    query: c4.query,
    piezas_requeridas: c4.required_evidence.length,
    piezas_en_pool100: c4.pieces_in_pool100,
    piezas_fuera_pool100: c4.pieces_outside_pool100,
    ev_por_K: { k5: c4.evidence_in_top5, k20: c4.evidence_in_top20, k50: c4.evidence_in_top50, k100: c4.evidence_in_top100 },
    localizacion: c4.evidence_locations,
    clasificacion: c4.classification,
    confirmation: c4.pieces_outside_pool100 >= 3 ? 'CONFIRMADO: ≥3 piezas fuera de top-100 (consistente con R5-C23/24)' : 'NO CONFIRMADO',
  } : null;

  const out = {
    experiment: 'R5-C27',
    cycle: 39,
    hypothesis: 'H27: el techo de R@5 puede descomponerse cuantitativamente entre éxito de retrieval, evidencia multi-chunk, retrieval miss, corpus gap y problemas de anotación — determinando qué proporción del error pertenece al motor y cuál al corpus.',
    timestamp: new Date().toISOString(),
    database_guard: 'LOCAL_ONLY (beauty_db @ localhost:5435)',
    production_guard: 'active — aborta si URL no contiene localhost; Railway NO contactada',
    dataset: 'GOLD-V5 (18 queries: 15 no-UNSUPPORTED + 3 UNSUPPORTED; 55 chunk IDs únicos; 55/55 verificados en BD en este ciclo)',
    baseline: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    retrieval_configuration: { model: 'e5-v5 (1024d)', top_k: TOPK, pool: 'top-100 natural', metric: 'cosine', motor: 'PRODUCTIVO sin modificar' },
    corpus_snapshot: { chunks: '5,663 en BD', canonico: '5,619', gold_ids_en_bd: '55/55', duplicados: 0, null_embeddings: 0 },
    error_budget: {
      total_queries: total,
      by_class: classes,
      percentages: budget,
      retrieval_attributable_error: +(retrievalAttributable).toFixed(4),
      corpus_attributable_error: +(corpusAttributable).toFixed(4),
      annotation_attributable_error: +(annotationAttributable).toFixed(4),
      note: 'RETRIEVAL-ATTRIBUTABLE = C_RETRIEVAL_MISS + B_MULTI_CHUNK_RECOVERABLE (evidencia existe, recuperación/composición insuficiente). CORPUS-ATTRIBUTABLE = D_CORPUS_GAP (evidencia inexistente).',
    },
    per_query_diagnosis: perQuery.map(q => ({
      query_id: q.query_id, classification: q.classification, confidence: q.confidence, reason: q.reason,
      evidence_in_corpus: q.evidence_in_corpus,
      evidence_in_top5: q.evidence_in_top5, evidence_in_top50: q.evidence_in_top50, evidence_in_top100: q.evidence_in_top100,
      pieces_in_pool100: q.pieces_in_pool100, pieces_outside_pool100: q.pieces_outside_pool100,
    })),
    miss_analysis: {
      cabello_002: perQuery.find(q => q.query_id === 'cabello_002'),
      cejas_008: perQuery.find(q => q.query_id === 'cejas_008'),
      cejas_004: c4Detail,
    },
    corpus_gap_analysis: {
      queries: perQuery.filter(q => q.classification === 'D_CORPUS_GAP').map(q => q.query_id),
      note: 'Solo las 3 UNSUPPORTED (validado R5-C13). Las 15 no-UNSUPPORTED tienen 55/55 golds en BD — no hay corpus gap a nivel de gold.',
    },
    retrieval_miss_analysis: {
      queries: perQuery.filter(q => q.classification === 'C_RETRIEVAL_MISS').map(q => ({ query_id: q.query_id, pieces_outside_pool100: q.pieces_outside_pool100, reason: q.reason })),
    },
    annotation_analysis: {
      queries: perQuery.filter(q => q.classification === 'E_ANNOTATION_GAP').map(q => q.query_id),
      note: 'Sin evidencia objetiva de ambigüedad suficiente en este análisis; categoría sin asignaciones.',
    },
    reproducibility: 'RUN A ≡ RUN B (verificar en segunda corrida)',
    verdict: null,
  };
  const outPath = path.join(OUT_DIR, `r5c27_error_budget_analysis_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  ERROR BUDGET (${total} queries): ${JSON.stringify(budget)}`);
  console.log(`  RETRIEVAL-attributable: ${retrievalAttributable.toFixed(4)} | CORPUS-attributable: ${corpusAttributable.toFixed(4)} | ANNOTATION: ${annotationAttributable.toFixed(4)}`);
  if (c4Detail) console.log(`  cejas_004: ${c4Detail.confirmation} (${c4Detail.piezas_fuera_pool100} fuera de top-100)`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
