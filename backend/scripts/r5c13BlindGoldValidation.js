#!/usr/bin/env node
/**
 * backend/scripts/r5c13BlindGoldValidation.js
 * CICLO 25 — R5-C13: Validación CIEGA del Gold Set (read-only)
 *
 * FASE 1 — CANDIDATE POOL CIEGO (determinista, seed fija):
 *   Por query: expected V2 + gold V3/V4 + distractores del MISMO dominio
 *   + distractores de OTROS dominios. IDs anonimizados (candidate_01...).
 *   El archivo de candidates NO revela source_class ni chunk_id.
 *
 * FASE 2 — ANOTACIÓN: el anotador recibe solo query + contenido (IDs anonimizados)
 *   y clasifica: 3 RELEVANT / 2 PARTIALLY / 1 RELATED / 0 NOT_RELEVANT / U / A.
 *
 * FASE 3 — REVELAR MAPPING: calcular overlap gold_independiente vs constructor.
 *
 * FASE 4 — RETRIEVAL (solo después de cerrar la anotación).
 *
 * Uso: node scripts/r5c13BlindGoldValidation.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V2 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const V3 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v3_candidate.json');
const V4 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v4_gold_candidate.json');
const CORPUS = path.join(__dirname, '..', 'src', 'data', 'corpus_canonico', 'corpus_canonico.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const SEED = 'r5c13-blind-validation-seed-001'; // seed fija → pool determinista

function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
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
  const ds4 = JSON.parse(fs.readFileSync(V4, 'utf8'));
  const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const byId = new Map(corpus.chunks.map(c => [c.chunk_id, c]));
  const valid = ds2.queries.filter(q => q.status === 'VALID');
  const q3map = new Map(ds3.queries.map(q => [q.query_id, q]));
  const q4map = new Map(ds4.queries.map(q => [q.query_id, q]));

  // ── FASE 1: construir candidate pool ciego (sin anotación aún) ──
  const pool = [];
  for (const q of valid) {
    const q3 = q3map.get(q.id);
    const q4 = q4map.get(q.id);
    const expectedV2 = q.expected_chunks;
    const goldV3 = [...(q3?.expected_chunks.primary || []), ...(q3?.expected_chunks.supporting || [])];
    const goldV4 = [...(q4?.core_gold || []), ...(q4?.supporting_gold || [])];

    // Chunks del MISMO dominio (por document_id del primer expected) — distractores independientes del ranking
    const domChunks = [];
    const docIds = new Set();
    for (const e of expectedV2) { const c = byId.get(e); if (c) docIds.add(c.document_id); }
    for (const g of [...goldV3, ...goldV4]) { const c = byId.get(g); if (c) docIds.add(c.document_id); }
    for (const c of corpus.chunks) {
      if (docIds.has(c.document_id) && !expectedV2.includes(c.chunk_id) && !goldV3.includes(c.chunk_id) && !goldV4.includes(c.chunk_id)) {
        domChunks.push(c.chunk_id);
      }
    }
    // Distractores de OTROS dominios
    const otherChunks = corpus.chunks.filter(c => !docIds.has(c.document_id)).map(c => c.chunk_id);

    const sources = [
      ...expectedV2.map(id => ({ chunk_id: id, source_class: 'expected_v2' })),
      ...goldV3.filter(id => !expectedV2.includes(id)).map(id => ({ chunk_id: id, source_class: 'gold_v3' })),
      ...goldV4.filter(id => !expectedV2.includes(id) && !goldV3.includes(id)).map(id => ({ chunk_id: id, source_class: 'gold_v4' })),
      ...seededShuffle(domChunks, SEED + q.id).slice(0, 6).map(id => ({ chunk_id: id, source_class: 'distractor_same_domain' })),
      ...seededShuffle(otherChunks, SEED + q.id + 'o').slice(0, 3).map(id => ({ chunk_id: id, source_class: 'distractor_other_domain' })),
    ];
    // Dedupe preservando orden
    const seen = new Set();
    const uniq = sources.filter(s => { if (seen.has(s.chunk_id)) return false; seen.add(s.chunk_id); return true; });
    // Anonimizar (determinista): primero shuffle, luego asignar IDs anónimos
    const shuffled = seededShuffle(uniq, SEED + q.id + 'anon');
    const anon = shuffled.map((s, i) => ({ ...s, anon_id: `candidate_${String(i + 1).padStart(2, '0')}` }));
    // NOTA: el shuffle de anonimización reordena; guardar mapping
    const mapping = anon.map(s => ({ anon_id: s.anon_id, chunk_id: s.chunk_id, source_class: s.source_class }));
    // Obtener contenido desde BD (fuente de verdad de chunks; incluye legacy)
    const ids = anon.map(s => s.chunk_id);
    const cRes = await ragPool.query(
      'SELECT chunk_id, title, content FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [ids]);
    const cMap = new Map(cRes.rows.map(r => [r.chunk_id, r]));
    const blind = anon.map(s => {
      const r = cMap.get(s.chunk_id);
      return { anon_id: s.anon_id, title: r ? r.title : '', content: r ? r.content : 'CONTENIDO NO DISPONIBLE' };
    });
    // Excluir candidatos sin contenido recuperable (no anotables) — documentar
    const unavailable = blind.filter(c => c.content === 'CONTENIDO NO DISPONIBLE').map(c => c.anon_id);
    const poolBlind = blind.filter(c => c.content !== 'CONTENIDO NO DISPONIBLE');
    const poolMapping = mapping.filter(m => !unavailable.includes(m.anon_id));
    // Re-anonimizar tras exclusión para mantener numeración contigua
    const renumbered = poolBlind.map((c, i) => ({ ...c, anon_id: `candidate_${String(i + 1).padStart(2, '0')}` }));
    const anonLookup = new Map(poolBlind.map((c, i) => [c.anon_id, renumbered[i].anon_id]));
    const renumberedMapping = poolMapping.map(m => ({ ...m, anon_id: anonLookup.get(m.anon_id) }));
    pool.push({ query_id: q.id, query: q.query, category: q.category, blind_candidates: renumbered, mapping: renumberedMapping, excluded_unavailable: unavailable });
  }

  // Guardar solo la parte CIEGA (sin mapping) para anotación
  const blindOut = {
    generated_at: new Date().toISOString(), run, seed: SEED,
    note: 'FASE 1 — candidate pool CIEGO. El mapping NO está en este archivo.',
    queries: pool.map(p => ({ query_id: p.query_id, query: p.query, candidates: p.blind_candidates })),
  };
  const blindPath = path.join(OUT_DIR, `r5c13_blind_gold_candidates_${run.toLowerCase()}.json`);
  fs.writeFileSync(blindPath, JSON.stringify(blindOut, null, 2));
  console.log(`✅ FASE 1 → ${blindPath} (pool ciego, sin mapping)`);

  // Guardar el mapping EN ARCHIVO SEPARADO (se revela solo en FASE 3)
  const mappingOut = {
    generated_at: new Date().toISOString(), run, seed: SEED,
    note: 'MAPPING candidate_anon → chunk_id → source_class. NO revelar durante la anotación.',
    queries: pool.map(p => ({ query_id: p.query_id, mapping: p.mapping })),
  };
  const mappingPath = path.join(OUT_DIR, `r5c13_mapping_${run.toLowerCase()}.json`);
  fs.writeFileSync(mappingPath, JSON.stringify(mappingOut, null, 2));
  console.log(`✅ MAPPING → ${mappingPath} (archivo separado, revelar en FASE 3)`);

  // Diagnosticar candidatos sin contenido
  const noContent = pool.flatMap(p => p.blind_candidates.filter(c => c.content === 'CONTENIDO NO DISPONIBLE').map(c => ({ q: p.query_id, anon: c.anon_id })));
  console.log(`⚠️ Candidatos sin contenido: ${noContent.length} — verificar IDs en BD`);

  // ── FASE 2: ANOTACIÓN (por el anotador — aquí se ejecuta el juicio semántico) ──
  // El anotador clasifica cada candidato por CONTENIDO solamente.
  // La anotación se guarda en r5c13_annotations.json (archivo intermedio).
  const annPath = path.join(OUT_DIR, `r5c13_annotations_${run.toLowerCase()}.json`);
  const annotations = [];
  for (const p of pool) {
    for (const c of p.blind_candidates) {
      // Placeholder: la anotación se completa en el siguiente paso (lectura de contenido).
      annotations.push({ query_id: p.query_id, anon_id: c.anon_id, label: null, score: null, reason: null });
    }
  }
  fs.writeFileSync(annPath, JSON.stringify({ annotations }, null, 2));
  console.log(`✅ FASE 2 → ${annPath} (anotaciones pendientes de completar)`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
