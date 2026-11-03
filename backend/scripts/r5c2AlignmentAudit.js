#!/usr/bin/env node
/**
 * backend/scripts/r5c2AlignmentAudit.js
 * CICLO 14 — R5-C2: Experimento controlado de alineación + recuperación
 * READ-ONLY estricto: solo SELECT + SET LOCAL (sesión), sin escrituras.
 *
 * Para cada query VALID:
 *  1. Retrieval HNSW top-10 (productivo)
 *  2. Retrieval exact scan top-10 (enable_indexscan off, sesión temporal)
 *  3. Similaridad query→expected directa (exacta)
 *  4. Clasificación de alineación basada en contenido semántico
 * Salida: backend/src/data/eval/r5c2_alignment_candidate.json
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const DS = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const CORPUS = path.join(__dirname, '..', 'src', 'data', 'corpus_canonico', 'corpus_canonico.json');
const OUT = path.join(__dirname, '..', 'src', 'data', 'eval', 'r5c2_alignment_candidate.json');

async function main() {
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  const isLocal = ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0');
  if (!isLocal) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO (seguridad).');
    process.exit(1);
  }

  const ds = JSON.parse(fs.readFileSync(DS, 'utf8'));
  const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const byId = new Map(corpus.chunks.map(c => [c.chunk_id, c]));
  const valid = ds.queries.filter(q => q.status === 'VALID');

  const results = [];
  for (const q of valid) {
    const qEmb = await generateEmbedding(q.query, 'query');
    const qv = '[' + qEmb.join(',') + ']';

    // ── A. Retrieval HNSW (productivo) top-10 ──
    const hnswRes = await ragPool.query(
      `SELECT id, chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings
       ORDER BY embedding <=> $1::halfvec LIMIT 10`, [qv]);

    // ── B. Retrieval exact scan top-10 (sesión temporal read-only) ──
    await ragPool.query('SET LOCAL enable_indexscan = off');
    await ragPool.query('SET LOCAL enable_bitmapscan = off');
    const exactRes = await ragPool.query(
      `SELECT id, chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings
       ORDER BY embedding <=> $1::halfvec LIMIT 10`, [qv]);

    const hnswIds = hnswRes.rows.map(r => r.chunk_id);
    const exactIds = exactRes.rows.map(r => r.chunk_id);

    // ── C. Similaridad exacta query→expected ──
    const expLit = '{' + q.expected_chunks.join(',') + '}';
    const expRes = await ragPool.query(
      `SELECT chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($2::text[])
       ORDER BY sim DESC`, [qv, q.expected_chunks]);

    // ── D. Ensamblar ──
    const expectedInfo = q.expected_chunks.map(cid => {
      const c = byId.get(cid);
      const simRow = expRes.rows.find(r => r.chunk_id === cid);
      return {
        chunk_id: cid,
        document_id: c ? c.document_id : (simRow ? simRow.document_id : '?'),
        title: c ? c.title : (simRow ? simRow.title : '?'),
        content: c ? c.content : (simRow ? simRow.content : '?'),
        similarity_exact: simRow ? parseFloat(simRow.sim.toFixed(4)) : null,
        rank_hnsw: hnswIds.indexOf(cid) >= 0 ? hnswIds.indexOf(cid) + 1 : null,
        rank_exact: exactIds.indexOf(cid) >= 0 ? exactIds.indexOf(cid) + 1 : null,
        in_top5_hnsw: hnswIds.indexOf(cid) >= 0 && hnswIds.indexOf(cid) < 5,
        in_top10_hnsw: hnswIds.indexOf(cid) >= 0,
      };
    });

    results.push({
      query_id: q.id,
      query: q.query,
      category: q.category,
      difficulty: q.difficulty,
      expected_chunks: q.expected_chunks,
      expected_info: expectedInfo,
      hnsw_top10: hnswRes.rows.map((r, i) => ({
        rank: i + 1, chunk_id: r.chunk_id, document_id: r.document_id,
        title: r.title, similarity: parseFloat(r.sim.toFixed(4)),
        is_expected: q.expected_chunks.includes(r.chunk_id),
      })),
      exact_top10: exactRes.rows.map((r, i) => ({
        rank: i + 1, chunk_id: r.chunk_id, document_id: r.document_id,
        title: r.title, similarity: parseFloat(r.sim.toFixed(4)),
        is_expected: q.expected_chunks.includes(r.chunk_id),
      })),
      hnsw_misses: q.expected_chunks.filter(cid => exactIds.includes(cid) && !hnswIds.includes(cid)),
      embedding_misses: q.expected_chunks.filter(cid => !exactIds.includes(cid)),
    });
    console.log(`✅ ${q.id}: expected=${q.expected_chunks.length} | hnsw_top10_hits=${q.expected_chunks.filter(c=>hnswIds.includes(c)).length} | exact_top10_hits=${q.expected_chunks.filter(c=>exactIds.includes(c)).length}`);
    await new Promise(r => setTimeout(r, 250));
  }

  const out = {
    generated_at: new Date().toISOString(),
    purpose: 'R5-C2 alineación + oracle + HNSW vs exact (read-only)',
    config: { topK: 10, model: 'nvidia/nv-embedqa-e5-v5', bd: 'LOCAL' },
    queries: results,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n✅ Guardado: ${OUT}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
