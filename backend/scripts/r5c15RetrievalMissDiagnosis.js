#!/usr/bin/env node
/**
 * backend/scripts/r5c15RetrievalMissDiagnosis.js
 * CICLO 27 — R5-C15: Diagnóstico causal de los 3 retrieval misses (read-only)
 *
 * Objeto: cabello_002, cejas_004, cejas_008 (evidencia existe en corpus,
 *         retrieval no la coloca en Top-5).
 *
 * FASES:
 *  F1 Reproducción base (HNSW productivo top-10 + exact scan top-10)
 *  F2 Clasificación causal (con evidencia numérica y textual)
 *  F3 Exact scan como oráculo técnico
 *  F4 Análisis de competidores (top-5 que desplazan al gold)
 *  F5 Prueba de robustez del embedding (3-5 reformulaciones, en memoria)
 *  F6 Prueba document-centric (query derivada del contenido del gold)
 *  F7 Prueba HNSW controlada (ef_search vía SET LOCAL, sin reconstruir)
 *
 * READ-ONLY: SELECT + SET LOCAL (sesión) + generateEmbedding en memoria.
 * Guarda anti-producción. Uso: node scripts/r5c15RetrievalMissDiagnosis.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V5 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

const MISSES = ['cabello_002', 'cejas_004', 'cejas_008'];

// Reformulaciones semánticamente equivalentes (sin añadir información nueva)
const REFORMULATIONS = {
  'cabello_002': [
    'Tratamiento para cabello dañado por decoloración',                        // original
    '¿Cómo reparar el cabello que se dañó por la decoloración?',               // directa
    'Restauración de la fibra capilar tras procesos de decoloración',          // técnica
    'Qué productos y cuidados ayudan al cabello decolorado y dañado',          // descriptiva
    'Reparación capilar post-decoloración: tratamientos efectivos',            // orientada a resultado
  ],
  'cejas_004': [
    'Corrección de cejas asimétricas con micropigmentación',                   // original
    '¿Cómo corregir cejas asimétricas con micropigmentación?',                 // directa
    'Manejo de la asimetría ciliar en el diseño de micropigmentación',         // técnica
    'Técnicas para igualar cejas desiguales en el procedimiento de micropigmentación', // descriptiva
    'Diseño de cejas para rostros con asimetría: micropigmentación',           // orientada a resultado
  ],
  'cejas_008': [
    'Remoción de microblading mal hecho: opciones y riesgos',                  // original
    '¿Cómo quitar un microblading mal hecho y qué riesgos tiene?',             // directa
    'Procedimientos de eliminación de pigmento tras microblading fallido',     // técnica
    'Opciones para borrar microblading con resultados insatisfactorios',       // descriptiva
    'Eliminación de microblading defectuoso: láser, electrólisis y riesgos',   // orientada a resultado
  ],
};

// Representación document-centric por gold (derivada del contenido, en memoria)
const DOC_CENTRIC = {
  'cabello_002': 'El pH juega un papel crítico en la integridad de la cutícula capilar durante procesos de coloración y decoloración. La restauración del pH ácido después de un proceso alcalino es esencial para el sellado de la cutícula y la reparación del cabello dañado.',
  'cejas_004': 'La dinámica del músculo orbicular y la arquitectura muscular facial influyen directamente en la simetría del diseño de cejas. Evaluar la musculatura permite adaptar el diseño de micropigmentación para corregir asimetrías.',
  'cejas_008': 'La eliminación de microblading mal ejecutado puede realizarse mediante interacción con láser de eliminación de tatuajes, electrólisis que daña la matriz folicular, o láser de erbio-glass 1550nm con fototermólisis fraccionada no ablativa.',
};

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
  const q5map = new Map(v5.queries.map(q => [q.query_id, q]));
  const TOPK = 10;

  // Índice HNSW disponible?
  const idx = await ragPool.query(`SELECT indexname FROM pg_indexes WHERE tablename='beauty_knowledge_embeddings' AND indexdef ILIKE '%hnsw%'`);
  const hnswIndexName = idx.rows[0]?.indexname || null;

  const results = [];
  for (const qid of MISSES) {
    const g = q5map.get(qid);
    const goldAll = [...g.expected_chunks.core, ...g.expected_chunks.supporting];
    const goldSet = new Set(goldAll);

    // ── F1: embedding de query + HNSW top-10 (config productiva) ──
    const qEmb = await generateEmbedding(g.query, 'query');
    const vec = '[' + qEmb.join(',') + ']';
    const hnsw = await ragPool.query(
      `SELECT id, chunk_id, document_id, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, [vec]);
    const hnswTop = hnsw.rows.map(r => ({ chunk_id: r.chunk_id, sim: +r.sim.toFixed(4) }));
    const hnswIds = hnswTop.map(r => r.chunk_id);

    // ── F1/F3: EXACT scan top-10 (oráculo técnico) ──
    const exact = await ragPool.query(
      `SELECT id, chunk_id, document_id, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings
       ORDER BY embedding <=> $1::halfvec::halfvec LIMIT ${TOPK}
       OFFSET 0`, [vec]);
    // exact scan con SET LOCAL para forzar seq scan (desactivar index scan)
    await ragPool.query('SET LOCAL enable_indexscan = off; SET LOCAL enable_bitmapscan = off;');
    const exactScan = await ragPool.query(
      `SELECT id, chunk_id, document_id, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings
       ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, [vec]);
    await ragPool.query('SET LOCAL enable_indexscan = on; SET LOCAL enable_bitmapscan = on;');
    const exactTop = exactScan.rows.map(r => ({ chunk_id: r.chunk_id, sim: +r.sim.toFixed(4) }));
    const exactIds = exactTop.map(r => r.chunk_id);

    // Ranks del gold en ambos
    const goldRanks = {};
    for (const cid of goldAll) {
      const hIdx = hnswIds.indexOf(cid);
      const eIdx = exactIds.indexOf(cid);
      goldRanks[cid] = { hnsw_rank: hIdx === -1 ? -1 : hIdx + 1, exact_rank: eIdx === -1 ? -1 : eIdx + 1, sim: null };
    }
    // Scores del gold (búsqueda directa de similitud)
    const goldSims = await ragPool.query(
      `SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($2::text[])`, [vec, goldAll]);
    for (const r of goldSims.rows) {
      if (goldRanks[r.chunk_id]) goldRanks[r.chunk_id].sim = +r.sim.toFixed(4);
    }

    // Margenes
    const top1Sim = hnswTop[0]?.sim ?? null;
    const top5Sim = hnswTop[4]?.sim ?? null;
    const bestGoldSim = Math.max(...Object.values(goldRanks).map(r => r.sim ?? 0));
    const goldInTop5 = hnswIds.slice(0, 5).some(id => goldSet.has(id));
    const goldInTop10 = hnswIds.some(id => goldSet.has(id));

    // HNSW miss vs exact
    const hnswMiss = Object.values(goldRanks).filter(r => r.hnsw_rank === -1 && r.exact_rank !== -1);
    const bothMiss = Object.values(goldRanks).filter(r => r.hnsw_rank === -1 && r.exact_rank === -1);

    // ── F4: competidores (top-5 que desplazan, sin gold) ──
    const competitors = hnswTop.filter(r => !goldSet.has(r.chunk_id)).slice(0, 5);
    const compDetails = await ragPool.query(
      'SELECT chunk_id, title, document_id FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])',
      [competitors.map(c => c.chunk_id)]);
    const compMap = new Map(compDetails.rows.map(r => [r.chunk_id, r]));
    const competitorsDetailed = competitors.map(c => ({
      chunk_id: c.chunk_id,
      title: compMap.get(c.chunk_id)?.title || '',
      sim: c.sim,
    }));

    // ── F5: reformulaciones (en memoria) ──
    const reformulations = [];
    for (const rf of REFORMULATIONS[qid]) {
      const rEmb = await generateEmbedding(rf, 'query');
      const rRes = await ragPool.query(
        `SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim
         FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + rEmb.join(',') + ']']);
      const rIds = rRes.rows.map(r => r.chunk_id);
      const rGold = goldAll.filter(id => rIds.includes(id));
      const rRanks = {};
      for (const cid of goldAll) {
        const i = rIds.indexOf(cid);
        rRanks[cid] = i === -1 ? -1 : i + 1;
      }
      const bestR = Math.min(...Object.values(rRanks).filter(r => r !== -1), 100);
      reformulations.push({
        text: rf, is_original: rf === g.query,
        gold_in_top5: rIds.slice(0, 5).some(id => goldSet.has(id)),
        gold_in_top10: rIds.some(id => goldSet.has(id)),
        best_gold_rank: bestR === 100 ? -1 : bestR,
        top1_sim: +rRes.rows[0].sim.toFixed(4),
        ranks: rRanks,
      });
      await new Promise(r => setTimeout(r, 200));
    }

    // ── F6: document-centric (query derivada del contenido del gold) ──
    const docText = DOC_CENTRIC[qid];
    const dEmb = await generateEmbedding(docText, 'query');
    const dRes = await ragPool.query(
      `SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + dEmb.join(',') + ']']);
    const dIds = dRes.rows.map(r => r.chunk_id);
    const docCentric = {
      text: docText,
      gold_in_top5: dIds.slice(0, 5).some(id => goldSet.has(id)),
      gold_in_top10: dIds.some(id => goldSet.has(id)),
      best_gold_rank: (() => { const r = goldAll.map(id => dIds.indexOf(id) + 1).filter(x => x > 0); return r.length ? Math.min(...r) : -1; })(),
      top1: dRes.rows[0]?.chunk_id || null,
      top1_sim: +dRes.rows[0]?.sim.toFixed(4) || null,
    };

    // ── F7: ef_search controlado (SET LOCAL) ──
    const efResults = {};
    for (const ef of [40, 100, 200, 400]) {
      await ragPool.query(`SET LOCAL hnsw.ef_search = ${ef};`);
      const efRes = await ragPool.query(
        `SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim
         FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, [vec]);
      const efIds = efRes.rows.map(r => r.chunk_id);
      const bestEf = (() => { const r = goldAll.map(id => efIds.indexOf(id) + 1).filter(x => x > 0); return r.length ? Math.min(...r) : -1; })();
      efResults[`ef_${ef}`] = {
        gold_in_top5: efIds.slice(0, 5).some(id => goldSet.has(id)),
        best_gold_rank: bestEf,
        top1_sim: +efRes.rows[0].sim.toFixed(4),
      };
    }
    await ragPool.query('RESET hnsw.ef_search;');

    // ── F2: clasificación causal (evidencia numérica) ──
    // Criterios objetivos
    const goldInExact = Object.values(goldRanks).some(r => r.exact_rank !== -1);
    const exactVsHnswDiffer = JSON.stringify(hnswIds) !== JSON.stringify(exactIds);
    const reformHelps = reformulations.filter(r => !r.is_original).some(r => r.gold_in_top5 && !reformulations.find(o => o.is_original)?.gold_in_top5);
    const docCentricHelps = docCentric.gold_in_top5 && !goldInTop5;

    const causes = [];
    if (goldInExact && exactVsHnswDiffer) causes.push('D_HNSW_APPROXIMATION');
    if (reformHelps) causes.push('A_QUERY_EMBEDDING');
    if (docCentricHelps) causes.push('A_QUERY_EMBEDDING');
    if (!goldInTop5 && goldInExact) causes.push('C_SEMANTIC_COMPETITION');
    if (!goldInExact) causes.push('B_DOCUMENT_EMBEDDING_OR_F_SEMANTIC_MISMATCH');
    if (causes.length === 0) causes.push('E_CHUNK_REPRESENTATION');
    if (causes.length > 1) causes.push('MIXED');

    results.push({
      query_id: qid,
      query: g.query,
      gold_chunks: goldAll,
      gold_ranks: goldRanks,
      top1_sim: top1Sim,
      top5_sim: top5Sim,
      best_gold_sim: bestGoldSim,
      gold_in_top5: goldInTop5, gold_in_top10: goldInTop10,
      hnsw_miss_vs_exact: hnswMiss.length,
      both_miss: bothMiss.length,
      hnsw_top10: hnswTop,
      exact_top10: exactTop,
      exact_vs_hnsw_differ: exactVsHnswDiffer,
      competitors_top5: competitorsDetailed,
      reformulations,
      doc_centric: docCentric,
      ef_search: efResults,
      causes,
    });
    console.log(`✅ ${qid}: goldTop5=${goldInTop5} goldTop10=${goldInTop10} | hnswMiss=${hnswMiss.length} bothMiss=${bothMiss.length} | causas=[${causes.join(',')}]`);
    await new Promise(r => setTimeout(r, 300));
  }

  const out = {
    cycle: '27', experiment: 'R5-C15', run,
    database: 'LOCAL_ONLY', production_contacted: false,
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    config: { topK: TOPK, threshold: '0.45 (no aplicado en topK directo)', motor: 'PRODUCTIVO sin modificar' },
    hnsw_index: hnswIndexName,
    baseline_r5c: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    results,
  };
  const outPath = path.join(OUT_DIR, `r5c15_retrieval_miss_diagnosis_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
