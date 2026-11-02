#!/usr/bin/env node
/**
 * backend/scripts/ragDiagnosticR5c0.js
 * CICLO 12 — R5-C0 AUTOPSIA: diagnóstico READ-ONLY del RAG
 * Para cada query VALID: ejecuta searchBeautyKnowledge con topK=10, threshold=0
 * (para ver TODOS los candidatos y su score) y registra posiciones de expected.
 * NO modifica BD, NO persiste embeddings, NO cambia sistema.
 * Salida: backend/src/data/eval/rag_diagnostic_r5c0.json
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { searchBeautyKnowledge } = require('../src/services/ragService');

const DS_PATH = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const IM_PATH = path.join(__dirname, '..', 'src', 'data', 'eval', 'identity_map_v2.json');
const OUT_PATH = path.join(__dirname, '..', 'src', 'data', 'eval', 'rag_diagnostic_r5c0.json');

async function main() {
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  const isLocal = ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1');
  if (!isLocal) {
    console.error('🚫 RAG_DATABASE_URL NO es local. Abortando diagnóstico (solo lectura LOCAL).');
    process.exit(1);
  }

  const ds = JSON.parse(fs.readFileSync(DS_PATH, 'utf8'));
  const im = JSON.parse(fs.readFileSync(IM_PATH, 'utf8'));
  const valid = ds.queries.filter(q => q.status === 'VALID');

  // Map query_id -> expected chunk_ids (del dataset)
  const expByQuery = Object.fromEntries(valid.map(q => [q.id, q.expected_chunks]));

  const queries = [];
  for (const q of valid) {
    const expected = expByQuery[q.id] || [];
    // Retrieval con threshold 0 y topK 10 para ver candidatos completos
    const retrieved = await searchBeautyKnowledge(q.query, { topK: 10, threshold: 0 });

    // R5-C0: enriquecer con chunk_id (mismo mecanismo que el evaluator R5-B)
    // searchBeautyKnowledge retorna id (UUID); el dataset referencia chunk_id semánticos
    const ids = retrieved.map(r => r.id).filter(Boolean);
    let chunkIdMap = {};
    if (ids.length > 0) {
      const idRes = await ragPool.query(
        'SELECT id, chunk_id FROM beauty_knowledge_embeddings WHERE id = ANY($1::uuid[])',
        [ids]
      );
      for (const row of idRes.rows) chunkIdMap[row.id] = row.chunk_id;
    }

    const rows = retrieved.map((r, i) => ({
      rank: i + 1,
      chunk_id: chunkIdMap[r.id] || r.chunk_id || r.id,
      title: r.title,
      score: r.similarity,
      is_expected: expected.includes(chunkIdMap[r.id] || r.chunk_id || r.id),
    }));
    const expRanks = rows.filter(r => r.is_expected).map(r => r.rank);
    const expScores = rows.filter(r => r.is_expected).map(r => r.score);
    queries.push({
      query_id: q.id,
      query: q.query,
      category: q.category,
      difficulty: q.difficulty,
      expected_chunks: expected,
      n_expected: expected.length,
      n_retrieved: rows.length,
      retrieved: rows,
      expected_ranks: expRanks,
      expected_scores: expScores,
      best_rank: expRanks.length ? Math.min(...expRanks) : null,
      best_score: expScores.length ? Math.max(...expScores) : null,
      n_expected_in_top10: expRanks.length,
      n_expected_in_top5: expRanks.filter(r => r <= 5).length,
    });
    console.log(`${q.id}: expected=${expected.length} in_top10=${expRanks.length} best_rank=${queries[queries.length-1].best_rank} best_score=${queries[queries.length-1].best_score?.toFixed(4)}`);
    await new Promise(r => setTimeout(r, 250));
  }

  const out = {
    generated_at: new Date().toISOString(),
    purpose: 'R5-C0 diagnóstico READ-ONLY — retrieval topK=10 threshold=0 para autopsia',
    config: { topK: 10, threshold: 0, bd: 'LOCAL', model: 'nvidia/nv-embedqa-e5-v5' },
    queries,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\n✅ Diagnóstico guardado: ${OUT_PATH}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
