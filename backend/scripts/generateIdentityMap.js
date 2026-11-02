#!/usr/bin/env node
/**
 * backend/scripts/generateIdentityMap.js
 * R5-A — Genera el MAPA DE IDENTIDAD completo:
 * query → expected_chunk → document_id → document_version → content_hash → source
 * Escribe backend/src/data/eval/identity_map_v2.json
 */
const fs = require('fs');
const path = require('path');

const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'corpus_canonico', 'corpus_canonico.json'), 'utf8'));
const ds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json'), 'utf8'));

const byId = {};
for (const c of corpus.chunks) {
  if (!byId[c.chunk_id]) byId[c.chunk_id] = [];
  byId[c.chunk_id].push(c);
}

const identityMap = [];
for (const q of ds.queries) {
  if (q.status !== 'VALID') continue;
  for (const eid of q.expected_chunks) {
    const candidates = byId[eid] || [];
    // Elegir el candidato del dominio con mejor score en el match
    const match = q.matched_candidates.find(m => m.chunk_id === eid);
    const cand = candidates.find(c => c.document_id === (match && match.document_id)) || candidates[0];
    if (!cand) continue;
    identityMap.push({
      query_id: q.id,
      query: q.query,
      category: q.category,
      expected_chunk: eid,
      document_id: cand.document_id,
      document_version: cand.document_version,
      content_hash: cand.content_hash,
      content_hash_short: cand.content_hash.slice(0, 12),
      fuente: cand.fuente,
      seccion: cand.seccion,
      title: cand.title,
      source_files: cand.metadata._source_files || [],
      match_score: match ? match.score : null,
    });
  }
}

const out = {
  generated_at: new Date().toISOString(),
  corpus_version: corpus.corpus_version,
  entries: identityMap.length,
  queries_covered: new Set(identityMap.map(e => e.query_id)).size,
  map: identityMap,
};

const outPath = path.join(__dirname, '..', 'src', 'data', 'eval', 'identity_map_v2.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`✅ Identity map: ${identityMap.length} entradas, ${out.queries_covered} queries cubiertas`);
console.log(`📁 ${outPath}`);
