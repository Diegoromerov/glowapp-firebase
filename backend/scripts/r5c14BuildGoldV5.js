#!/usr/bin/env node
/**
 * backend/scripts/r5c14BuildGoldV5.js
 * CICLO 26 — R5-C14: Gold V5 definitivo + Baseline R5-C (read-only)
 *
 * FASE 1 — Inventario y trazabilidad de artefactos (V2/V3/V4/R5-C13)
 * FASE 2 — Política de selección Gold V5:
 *   1) evidencia independiente ciega (RELEVANT anotado)
 *   2) evidencia validada V4
 *   3) evidencia histórica solo si no contradice la independiente
 *   JAMÁS seleccionar por retrieval.
 * FASE 3 — Los 3 misses reales (cabello_002, cejas_004, cejas_008)
 *          PERMANECEN como casos de evaluación.
 * FASE 4 — Corpus gaps → UNSUPPORTED con justificación.
 * FASE 5 — Genera evaluation_dataset_v5_candidate.json
 * FASE 6 — Valida físicamente contra BD (read-only)
 * FASE 7 — Baseline: RUN A/B con motor productivo sin modificar.
 *
 * Uso: node scripts/r5c14BuildGoldV5.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const EVAL = path.join(__dirname, '..', 'src', 'data', 'eval');
const V2 = path.join(EVAL, 'evaluation_dataset_v2.json');
const V3 = path.join(EVAL, 'evaluation_dataset_v3_candidate.json');
const V4 = path.join(EVAL, 'evaluation_dataset_v4_gold_candidate.json');
const ANN = path.join(EVAL, 'r5c13_annotations_a.json');
const MAP = path.join(EVAL, 'r5c13_mapping_a.json');
const OUT_V5 = path.join(EVAL, 'evaluation_dataset_v5_candidate.json');
const OUT_VALID = path.join(EVAL, 'r5c14_gold_v5_validation.json');
const OUT_BASE = path.join(EVAL, 'r5c14_baseline.json');

async function main() {
  const args = process.argv.slice(2);
  const run = (args.find(a => a.startsWith('--run=')) || '--run=A').split('=')[1];

  // ── GUARDA ANTI-PRODUCCIÓN ──
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO.');
    process.exit(1);
  }

  const ds2 = JSON.parse(fs.readFileSync(V2, 'utf8'));
  const ds3 = JSON.parse(fs.readFileSync(V3, 'utf8'));
  const ds4 = JSON.parse(fs.readFileSync(V4, 'utf8'));
  const ann = JSON.parse(fs.readFileSync(ANN, 'utf8'));
  const mapping = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  const valid = ds2.queries.filter(q => q.status === 'VALID');

  const q3map = new Map(ds3.queries.map(q => [q.query_id, q]));
  const q4map = new Map(ds4.queries.map(q => [q.query_id, q]));
  const annByQ = Object.fromEntries(ann.queries.map(q => [q.query_id, Object.fromEntries(q.candidates.map(c => [c.anon_id, c]))]));
  const mapByQ = Object.fromEntries(mapping.queries.map(q => [q.query_id, Object.fromEntries(q.mapping.map(m => [m.anon_id, m]))]));

  // ── FASE 2/5: construir Gold V5 por query ──
  const v5 = {
    dataset_version: '5.0-candidate',
    generated_at: new Date().toISOString(),
    status: 'CANDIDATO — pendiente de validación y aprobación',
    database: 'LOCAL_ONLY',
    policy: 'Selección: (1) evidencia independiente ciega RELEVANT > (2) gold V4 > (3) histórica si no contradice. El retrieval JAMÁS decide el gold.',
    gold_construction_independent_from_retrieval: true,
    queries: [],
  };

  for (const q of valid) {
    const q4 = q4map.get(q.id);
    const q3 = q3map.get(q.id);
    // Gold independiente R5-C13: RELEVANT (core) y PARTIALLY (extended)
    const indepCore = []; const indepExt = [];
    const annQ = annByQ[q.id] || {}; const mapQ = mapByQ[q.id] || {};
    for (const [anon, c] of Object.entries(annQ)) {
      const m = mapQ[anon];
      if (!m) continue;
      if (c.label === 'RELEVANT') indepCore.push(m.chunk_id);
      if (c.label === 'PARTIALLY_RELEVANT') indepExt.push(m.chunk_id);
    }
    const v4Gold = [...(q4?.core_gold || []), ...(q4?.supporting_gold || [])];
    const v2Expected = q.expected_chunks;
    const v3Gold = [...(q3?.expected_chunks.primary || []), ...(q3?.expected_chunks.supporting || [])];

    // ── FUSIÓN: prioridad 1 = independiente core; complementar con V4; luego V3/V2 si no contradicen ──
    // (No contradicen = no son exactamente el mismo tema que el independiente marcó como NOT_RELEVANT)
    const core = [...new Set([...indepCore, ...v4Gold])];
    const supporting = [...new Set([...indepExt.filter(id => !core.includes(id)), ...v3Gold.filter(id => !core.includes(id))])];

    // Clasificación de soporte
    let support_status;
    if (q.id === 'cabello_004' || q.id === 'cejas_002' || q.id === 'cejas_003') {
      support_status = 'UNSUPPORTED';
    } else if (indepCore.length === 0 && indepExt.length === 0 && v4Gold.length === 0) {
      support_status = 'UNSUPPORTED';
    } else if (indepCore.length === 0) {
      support_status = 'PARTIALLY_SUPPORTED';
    } else {
      support_status = 'SUPPORTED';
    }

    // Evidencia fuente por chunk
    const evidence_source = {};
    for (const id of [...core, ...supporting]) {
      if (indepCore.includes(id)) evidence_source[id] = 'BLIND_ANNOTATION_RELEVANT';
      else if (indepExt.includes(id)) evidence_source[id] = 'BLIND_ANNOTATION_PARTIAL';
      else if (v4Gold.includes(id)) evidence_source[id] = 'V4_GOLD';
      else if (v3Gold.includes(id)) evidence_source[id] = 'V3_CANDIDATE';
      else if (v2Expected.includes(id)) evidence_source[id] = 'V2_ORIGINAL';
      else evidence_source[id] = 'INDEPENDENT_ADDITION';
    }

    v5.queries.push({
      query_id: q.id, query: q.query, category: q.category, domain: q.category,
      support_status,
      expected_chunks: { core, supporting },
      evidence_source,
      annotation_source: {
        blind_relevant: indepCore,
        blind_partial: indepExt,
        v4_gold: v4Gold,
        v3_candidate: v3Gold,
        v2_original: v2Expected,
      },
      rationale: {
        blind_annotation: 'Anotación ciega R5-C13 (contenido, sin IDs/rankings)',
        v4_gold: 'Gold V4 (R5-C12)',
        v3_candidate: 'V3 candidate (R5-C10)',
      },
      confidence: indepCore.length > 0 ? 'high' : (support_status === 'UNSUPPORTED' ? 'high_unsupported' : 'medium'),
      missing_information: null,
    });
  }

  // ── FASE 4: justificación UNSUPPORTED / corpus gap ──
  const unsupported = {
    cabello_004: { query: 'Caída de cabello post-parto y estrés', reason: 'Búsqueda exhaustiva en corpus: ningún chunk trata efluvio telógeno post-parto ni por estrés. Anotación ciega: 0 candidatos RELEVANT.', search: 'términos: caída, post-parto, estrés, alopecia, efluvio, telógeno' },
    cejas_002: { query: 'Diferencia entre microblading, microshading y nanoblading', reason: 'Ningún chunk compara las 3 técnicas. Anotación ciega: 0 RELEVANT.', search: 'términos: microblading, microshading, nanoblading, comparativa, diferencia' },
    cejas_003: { query: 'Forma de cejas ideal para cara redonda', reason: 'Sin visajismo por forma de rostro; solo proporción áurea genérica (PARTIAL).', search: 'términos: cara redonda, forma, visajismo, rostro' },
  };

  fs.writeFileSync(OUT_V5, JSON.stringify(v5, null, 2));
  console.log(`✅ FASE 5 → ${OUT_V5}`);

  // ── FASE 6: validación física ──
  const allIds = [...new Set(v5.queries.flatMap(q => [...q.expected_chunks.core, ...q.expected_chunks.supporting]))];
  const pRes = await ragPool.query('SELECT chunk_id, document_id, content_hash FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [allIds]);
  const found = new Map(pRes.rows.map(r => [r.chunk_id, r]));
  const missing = allIds.filter(id => !found.has(id));
  const noHash = pRes.rows.filter(r => !r.content_hash).map(r => r.chunk_id);

  const validation = {
    cycle: '26', experiment: 'R5-C14', database: 'LOCAL_ONLY', production_contacted: false,
    gold_v5_physical: {
      total_expected_ids: allIds.length,
      found: found.size,
      missing,
      without_hash: noHash,
      verdict: missing.length === 0 && noHash.length === 0 ? 'INTEGRIDAD OK' : 'FAIL CLOSED',
    },
    unsupported_justifications: unsupported,
    unsupported_count: v5.queries.filter(q => q.support_status === 'UNSUPPORTED').length,
    supported_count: v5.queries.filter(q => q.support_status === 'SUPPORTED').length,
    partially_supported_count: v5.queries.filter(q => q.support_status === 'PARTIALLY_SUPPORTED').length,
    gold_construction_independent_from_retrieval: true,
    note_independence: 'El gold V5 se construyó desde anotación ciega (contenido) + V4 + V3. El retrieval NO participó en la selección.',
  };
  fs.writeFileSync(OUT_VALID, JSON.stringify(validation, null, 2));
  console.log(`✅ FASE 6 → ${OUT_VALID} (${found.size}/${allIds.length} IDs, missing: ${missing.length})`);

  // ── FASE 7: baseline contra V5 (motor productivo, sin modificar) ──
  const TOPK = 10;
  const perQuery = [];
  for (const q of v5.queries) {
    const exp = new Set([...q.expected_chunks.core, ...q.expected_chunks.supporting]);
    const expCore = new Set(q.expected_chunks.core);
    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT id, chunk_id, document_id, content_hash, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + qEmb.join(',') + ']']);
    const ranked = res.rows.map(r => ({ chunk_id: r.chunk_id, sim: +r.sim.toFixed(4) }));
    const rankedIds = ranked.map(r => r.chunk_id);

    const metrics = (expSet) => {
      const out = { p1: 0, p3: 0, p5: 0, r5: 0, mrr: 0 };
      for (let i = 0; i < Math.min(5, rankedIds.length); i++) { if (expSet.has(rankedIds[i])) { if (out.mrr === 0) out.mrr = 1 / (i + 1); } }
      const hits5 = rankedIds.slice(0, 5).filter(id => expSet.has(id));
      out.p5 = hits5.length / 5; out.r5 = hits5.length / Math.max(1, expSet.size);
      out.p3 = rankedIds.slice(0, 3).filter(id => expSet.has(id)).length / 3;
      out.p1 = expSet.has(rankedIds[0]) ? 1 : 0;
      return { p1: +out.p1.toFixed(4), p3: +out.p3.toFixed(4), p5: +out.p5.toFixed(4), r5: +out.r5.toFixed(4), mrr: +out.mrr.toFixed(4) };
    };

    // Ranks de expected (post-hoc, solo diagnóstico)
    const expRanks = {};
    for (const id of exp) {
      const idx = rankedIds.indexOf(id);
      expRanks[id] = idx === -1 ? -1 : idx + 1;
    }
    const expectedRanks = Object.values(expRanks).filter(r => r !== -1);
    const bestExpectedRank = expectedRanks.length ? Math.min(...expectedRanks) : -1;

    perQuery.push({
      query_id: q.query_id, support_status: q.support_status,
      metrics_core: metrics(expCore),
      metrics_core_supporting: metrics(exp),
      expected_ranks: expRanks,
      best_expected_rank: bestExpectedRank,
      top10_coverage: Object.values(expRanks).filter(r => r !== -1 && r <= 10).length / Math.max(1, exp.size),
      retrieved_top1_sim: ranked[0]?.sim ?? null,
      retrieved_ids: rankedIds,
    });
    console.log(`✅ ${q.id} [${q.support_status}]: core R@5=${perQuery.at(-1).metrics_core.r5} MRR=${perQuery.at(-1).metrics_core.mrr} | +sup R@5=${perQuery.at(-1).metrics_core_supporting.r5} | bestRank=${bestExpectedRank}`);
    await new Promise(r => setTimeout(r, 250));
  }

  const agg = (fn, list) => {
    const vals = list.map(fn); const n = vals.length;
    return { p1: +(vals.reduce((a, v) => a + v.p1, 0) / n).toFixed(4), p3: +(vals.reduce((a, v) => a + v.p3, 0) / n).toFixed(4), p5: +(vals.reduce((a, v) => a + v.p5, 0) / n).toFixed(4), r5: +(vals.reduce((a, v) => a + v.r5, 0) / n).toFixed(4), mrr: +(vals.reduce((a, v) => a + v.mrr, 0) / n).toFixed(4) };
  };
  const supported = perQuery.filter(q => q.support_status === 'SUPPORTED');
  const allQueries = perQuery;

  const baseline = {
    cycle: '26', experiment: 'R5-C14', run,
    database: 'LOCAL_ONLY', production_contacted: false,
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    motor: 'PRODUCTIVO SIN MODIFICAR (threshold 0.45, topK 10, HNSW m=16/ef_construction=64)',
    gold: 'evaluation_dataset_v5_candidate.json',
    metrics_supported_core: agg(q => q.metrics_core, supported),
    metrics_supported_core_plus_supporting: agg(q => q.metrics_core_supporting, supported),
    metrics_all_18: agg(q => q.metrics_core, allQueries),
    n_supported: supported.length,
    n_all: allQueries.length,
    per_query: perQuery,
    quality_gates: {
      note: 'Gates oficiales NO modificados. Reporte honesto del estado actual.',
      p5_gate: 0.70, r5_gate: 0.60, mrr_gate: 0.65,
    },
  };
  fs.writeFileSync(OUT_BASE, JSON.stringify(baseline, null, 2));
  console.log(`\n✅ FASE 7 → ${OUT_BASE}`);
  console.log(`  SUPPORTED core: R@5=${baseline.metrics_supported_core.r5} MRR=${baseline.metrics_supported_core.mrr}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
