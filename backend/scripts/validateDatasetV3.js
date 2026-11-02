#!/usr/bin/env node
/**
 * backend/scripts/validateDatasetV3.js
 * CICLO 23 — R5-C11: Validación independiente del dataset V3 (read-only)
 *
 * Objetivos:
 *  1. Integridad física: todos los expected V3 existen en BD (chunk_id, content_hash)
 *  2. Retrieval invariance: mismo motor → mismos retrieved IDs para V2 y V3
 *  3. Métricas V2 vs V3 sobre el MISMO retrieval
 *  4. Anti-gaming: Δ métricas se explica por cambio de GT, no por cambio de motor
 *
 * READ-ONLY: solo SELECT + generateEmbedding en memoria. Guarda anti-producción.
 *
 * Uso: node scripts/validateDatasetV3.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V2 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const V3 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v3_candidate.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

function computeMetrics(rankedIds, expectedSet) {
  const out = { p1: 0, p3: 0, p5: 0, r5: 0, mrr: 0 };
  for (let i = 0; i < Math.min(5, rankedIds.length); i++) {
    if (expectedSet.has(rankedIds[i])) { if (out.mrr === 0) out.mrr = 1 / (i + 1); }
  }
  const hits5 = rankedIds.slice(0, 5).filter(id => expectedSet.has(id));
  out.p5 = hits5.length / 5;
  out.r5 = hits5.length / Math.max(1, expectedSet.size);
  out.p3 = rankedIds.slice(0, 3).filter(id => expectedSet.has(id)).length / 3;
  out.p1 = expectedSet.has(rankedIds[0]) ? 1 : 0;
  return { p1: +out.p1.toFixed(4), p3: +out.p3.toFixed(4), p5: +out.p5.toFixed(4), r5: +out.r5.toFixed(4), mrr: +out.mrr.toFixed(4) };
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

  const ds2 = JSON.parse(fs.readFileSync(V2, 'utf8'));
  const ds3 = JSON.parse(fs.readFileSync(V3, 'utf8'));
  const valid2 = ds2.queries.filter(q => q.status === 'VALID');
  const q3map = new Map(ds3.queries.map(q => [q.query_id, q]));
  const TOPK = 10;

  const perQuery = [];
  for (const q of valid2) {
    const q3 = q3map.get(q.id);
    if (!q3) { console.error(`❌ Query ${q.id} no está en V3`); process.exit(1); }

    const expV2 = new Set(q.expected_chunks);
    const expV3 = new Set([...(q3.expected_chunks.primary || []), ...(q3.expected_chunks.supporting || [])]);

    // Retrieval con el MISMO motor (una sola ejecución → retrieved IDs idénticos para V2/V3)
    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT id, chunk_id, document_id, content_hash, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + qEmb.join(',') + ']']);
    const rankedIds = res.rows.map(r => r.chunk_id);

    // Verificación física de expected V3
    const v3Ids = [...expV3];
    let physicalCheck = null;
    if (v3Ids.length) {
      const pRes = await ragPool.query(
        'SELECT chunk_id, document_id, content_hash FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [v3Ids]);
      const found = new Map(pRes.rows.map(r => [r.chunk_id, r]));
      const missing = v3Ids.filter(id => !found.has(id));
      physicalCheck = { total: v3Ids.length, found: found.size, missing, hashes_present: pRes.rows.every(r => r.content_hash) };
    } else {
      physicalCheck = { total: 0, found: 0, missing: [], hashes_present: true };
    }

    const m2 = computeMetrics(rankedIds, expV2);
    const m3 = computeMetrics(rankedIds, expV3);

    perQuery.push({
      query_id: q.id, category: q.category, query: q.query,
      status_v3: q3.status,
      v2_expected: q.expected_chunks,
      v3_expected_primary: q3.expected_chunks.primary,
      v3_expected_supporting: q3.expected_chunks.supporting,
      physical_check: physicalCheck,
      retrieved_ids: rankedIds,
      metrics_v2: m2,
      metrics_v3: m3,
      delta: {
        p5: +(m3.p5 - m2.p5).toFixed(4),
        r5: +(m3.r5 - m2.r5).toFixed(4),
        mrr: +(m3.mrr - m2.mrr).toFixed(4),
      },
    });
    console.log(`✅ ${q.id} [${q3.status}]: V2 R@5=${m2.r5} MRR=${m2.mrr} → V3 R@5=${m3.r5} MRR=${m3.mrr} | física: ${physicalCheck.found}/${physicalCheck.total}`);
    await new Promise(r => setTimeout(r, 250));
  }

  // Agregados
  const agg = (key, fn) => {
    const vals = perQuery.map(fn);
    const n = vals.length;
    return { p1: +(vals.reduce((a, v) => a + v.p1, 0) / n).toFixed(4), p3: +(vals.reduce((a, v) => a + v.p3, 0) / n).toFixed(4), p5: +(vals.reduce((a, v) => a + v.p5, 0) / n).toFixed(4), r5: +(vals.reduce((a, v) => a + v.r5, 0) / n).toFixed(4), mrr: +(vals.reduce((a, v) => a + v.mrr, 0) / n).toFixed(4) };
  };
  const gV2 = agg('v2', q => q.metrics_v2);
  const gV3 = agg('v3', q => q.metrics_v3);

  const out = {
    cycle: '23', experiment: 'R5-C11', database: 'LOCAL_ONLY', production_contacted: false,
    generated_at: new Date().toISOString(), run,
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    config: { topK: TOPK, threshold: 'N/A (topK directo)', motor: 'PRODUCTIVO sin modificar' },
    retrieval_invariance: 'GARANTIZADA POR DISEÑO — un solo retrieval por query, shared entre V2/V3',
    metrics: { v2: gV2, v3: gV3, delta: { p1: +(gV3.p1 - gV2.p1).toFixed(4), p3: +(gV3.p3 - gV2.p3).toFixed(4), p5: +(gV3.p5 - gV2.p5).toFixed(4), r5: +(gV3.r5 - gV2.r5).toFixed(4), mrr: +(gV3.mrr - gV2.mrr).toFixed(4) } },
    physical_integrity: {
      total_expected_ids: perQuery.reduce((a, q) => a + q.physical_check.total, 0),
      missing_ids: perQuery.flatMap(q => q.physical_check.missing),
    },
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c11_dataset_v3_validation_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
