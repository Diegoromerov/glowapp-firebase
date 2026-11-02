#!/usr/bin/env node
/**
 * backend/scripts/r5c7CorpusCoverageAudit.js
 * CICLO 19 — R5-C7: Auditoría de cobertura del corpus (read-only)
 *
 * FASE 1-2: Para cada query VALID:
 *   - Retrieval HNSW top-20 (productivo)
 *   - Exact scan top-20 (SET LOCAL enable_indexscan/bitmapscan off — sesión temporal)
 *   - Similitud exacta query→expected
 *   - Chunks que desplazan al expected (falsos positivos)
 *
 * READ-ONLY: solo SELECT + SET LOCAL. Guarda anti-producción.
 *
 * Uso: node scripts/r5c7CorpusCoverageAudit.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const DS = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

async function main() {
  const args = process.argv.slice(2);
  const run = (args.find(a => a.startsWith('--run=')) || '--run=A').split('=')[1];

  // ── GUARDA ANTI-PRODUCCIÓN ──
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO.');
    process.exit(1);
  }

  const ds = JSON.parse(fs.readFileSync(DS, 'utf8'));
  const valid = ds.queries.filter(q => q.status === 'VALID');
  const TOPK = 20;

  const perQuery = [];
  for (const q of valid) {
    const expected = q.expected_chunks;
    const qEmb = await generateEmbedding(q.query, 'query');
    const qv = '[' + qEmb.join(',') + ']';

    // A. HNSW top-20 (productivo)
    const hnsw = await ragPool.query(
      `SELECT id, chunk_id, document_id, title, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, [qv]);

    // B. Exact scan top-20 (sesión temporal read-only)
    await ragPool.query('SET LOCAL enable_indexscan = off');
    await ragPool.query('SET LOCAL enable_bitmapscan = off');
    const exact = await ragPool.query(
      `SELECT id, chunk_id, document_id, title, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, [qv]);

    // C. Similitud exacta query→expected (scan sobre los IDs)
    const expSims = [];
    for (const expId of expected) {
      const er = await ragPool.query(
        `SELECT chunk_id, title, 1-(embedding <=> $1::halfvec) AS sim
         FROM beauty_knowledge_embeddings WHERE chunk_id = $2`, [qv, expId]);
      if (er.rows.length) expSims.push({ chunk_id: expId, title: er.rows[0].title, sim: parseFloat(er.rows[0].sim.toFixed(4)) });
    }

    const hnswIds = hnsw.rows.map(r => r.chunk_id);
    const exactIds = exact.rows.map(r => r.chunk_id);

    // Expected en cada conjunto
    const expInHnsw = expected.map(id => ({ id, rank: hnswIds.indexOf(id) >= 0 ? hnswIds.indexOf(id) + 1 : null }));
    const expInExact = expected.map(id => ({ id, rank: exactIds.indexOf(id) >= 0 ? exactIds.indexOf(id) + 1 : null }));

    // Chunks que desplazan al expected en HNSW top-5 (no-expected con sim >= peor expected del top5)
    const displacers = hnsw.rows.slice(0, 5).filter(r => !expected.includes(r.chunk_id)).map(r => ({
      chunk_id: r.chunk_id, title: r.title, sim: parseFloat(r.sim.toFixed(4)), rank: hnswIds.indexOf(r.chunk_id) + 1,
    }));

    perQuery.push({
      query_id: q.id, query: q.query, category: q.category, expected_chunks: expected,
      expected_sims: expSims,
      expected_best_sim: expSims.length ? Math.max(...expSims.map(e => e.sim)) : null,
      hnsw_top20: hnsw.rows.map((r, i) => ({ rank: i + 1, chunk_id: r.chunk_id, title: r.title, sim: parseFloat(r.sim.toFixed(4)), is_expected: expected.includes(r.chunk_id) })),
      exact_top20: exact.rows.map((r, i) => ({ rank: i + 1, chunk_id: r.chunk_id, title: r.title, sim: parseFloat(r.sim.toFixed(4)), is_expected: expected.includes(r.chunk_id) })),
      expected_in_hnsw_top5: expInHnsw.filter(e => e.rank && e.rank <= 5).length,
      expected_in_hnsw_top20: expInHnsw.filter(e => e.rank).length,
      expected_in_exact_top20: expInExact.filter(e => e.rank).length,
      hnsw_misses_vs_exact: expected.filter(id => exactIds.includes(id) && !hnswIds.includes(id)),
      best_expected_rank_hnsw: Math.min(...expInHnsw.map(e => e.rank).filter(Boolean), Infinity) === Infinity ? null : Math.min(...expInHnsw.map(e => e.rank).filter(Boolean)),
      displacers_top5: displacers,
    });
    console.log(`✅ ${q.id}: exp_top5_hnsw=${perQuery.at(-1).expected_in_hnsw_top5}/${expected.length} exp_top20_hnsw=${perQuery.at(-1).expected_in_hnsw_top20} exp_top20_exact=${perQuery.at(-1).expected_in_exact_top20}`);
    await new Promise(r => setTimeout(r, 250));
  }

  const out = {
    cycle: '19', experiment: 'R5-C7', database: 'LOCAL_ONLY', production_contacted: false,
    generated_at: new Date().toISOString(), run,
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    config: { topK: TOPK, hnsw: 'm=16 ef_construction=64 (productivo)', exact: 'SET LOCAL enable_indexscan=off' },
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c7_corpus_coverage_audit_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
