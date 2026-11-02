#!/usr/bin/env node
/**
 * backend/scripts/r5c19EmbeddingModelAB.js
 * CICLO 31 — R5-C19: A/B controlado de modelo de embeddings (read-only, local)
 *
 * ARM A: nvidia/nv-embedqa-e5-v5 (1024d) — embeddings EXISTENTES en BD
 * ARM B: mxbai-embed-large (1024d) vía Ollama LOCAL — en memoria
 *
 * Constantes: mismas 18 queries GOLD-V5, mismo gold, mismo corpus, mismo texto
 * passage/query, mismo K, mismas métricas. Única variable: modelo de embedding.
 *
 * Diseño: CANDIDATE POOL (documentado, no evaluación completa del motor):
 *  - top-50 ARM A por query + golds + hard negatives de R5-C17
 *  - embeddings B generados en memoria SOLO para el pool (~60-90 chunks únicos)
 *
 * Guarda anti-producción. Uso: node scripts/r5c19EmbeddingModelAB.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V5 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const OLLAMA_URL = 'http://localhost:11434/api/embed';
const OLLAMA_MODEL = 'mxbai-embed-large'; // 1024d — misma dimensión que el productivo
const POOL_K = 50;

async function ollamaEmbed(texts) {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, input: texts }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Ollama ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json();
  return data.embeddings;
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

  const v5 = JSON.parse(fs.readFileSync(V5, 'utf8'));
  const queries = v5.queries.filter(q => q.support_status !== 'UNSUPPORTED');
  const TOPK = 10;
  const MISSES = ['cabello_002', 'cejas_004', 'cejas_008'];

  // ── Paso 1: pool de candidatos (top-50 A + golds) ──
  console.log('📦 Construyendo candidate pool (top-50 A + golds)...');
  const poolPerQuery = {};
  const allPoolIds = new Set();
  for (const q of queries) {
    const goldAll = [...q.expected_chunks.core, ...q.expected_chunks.supporting];
    const qEmb = await generateEmbedding(q.query, 'query'); // ARM A query embedding (NVIDIA)
    const res = await ragPool.query(
      `SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${POOL_K}`, ['[' + qEmb.join(',') + ']']);
    const poolIds = res.rows.map(r => r.chunk_id);
    for (const g of goldAll) if (!poolIds.includes(g)) poolIds.push(g);
    poolPerQuery[q.query_id] = poolIds;
    poolIds.forEach(id => allPoolIds.add(id));
  }
  const poolIds = [...allPoolIds];
  console.log(`  Pool único: ${poolIds.length} chunks`);

  // ── Paso 2: contenido de pool para embeddings B ──
  const cRes = await ragPool.query(
    'SELECT chunk_id, content FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [poolIds]);
  const contentMap = new Map(cRes.rows.map(r => [r.chunk_id, r.content]));

  // ── Paso 3: embeddings B (mxbai-embed-large) en lotes ──
  console.log(`🧠 Generando embeddings B (${OLLAMA_MODEL}) en memoria...`);
  const embB = new Map();
  const BATCH = 16;
  for (let i = 0; i < poolIds.length; i += BATCH) {
    const batch = poolIds.slice(i, i + BATCH);
    const texts = batch.map(id => contentMap.get(id) || '');
    try {
      const embs = await ollamaEmbed(texts);
      batch.forEach((id, j) => embB.set(id, embs[j]));
    } catch (err) {
      console.error(`  ❌ Batch error: ${err.message}`);
      for (const id of batch) embB.set(id, null);
    }
    if ((i / BATCH) % 4 === 0) console.log(`  ...${Math.min(i + BATCH, poolIds.length)}/${poolIds.length}`);
    await new Promise(r => setTimeout(r, 100));
  }
  const embBCount = [...embB.values()].filter(Boolean).length;
  console.log(`  ✅ ${embBCount}/${poolIds.length} embeddings B`);

  // ── Paso 4: evaluación A vs B ──
  // Normalizar embeddings B (mxbai no está normalizado por defecto en algunos casos)
  const normB = new Map();
  for (const [id, e] of embB) {
    if (!e) continue;
    const norm = Math.sqrt(e.reduce((a, b) => a + b * b, 0));
    normB.set(id, norm > 0 ? e.map(v => v / norm) : e);
  }

  const perQuery = [];
  for (const q of queries) {
    const goldAll = [...q.expected_chunks.core, ...q.expected_chunks.supporting];
    const goldSet = new Set(goldAll);
    const poolIdsQ = poolPerQuery[q.query_id];

    // ARM A: query NVIDIA + embeddings BD
    const qEmbA = await generateEmbedding(q.query, 'query');
    const aRes = await ragPool.query(
      `SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($2::text[])`, ['[' + qEmbA.join(',') + ']', poolIdsQ]);
    const aScores = new Map(aRes.rows.map(r => [r.chunk_id, +r.sim.toFixed(4)]));

    // ARM B: query mxbai + embeddings B normalizados (cosine)
    const [qEmbB] = await ollamaEmbed([q.query]);
    const qNorm = Math.sqrt(qEmbB.reduce((a, b) => a + b * b, 0));
    const qB = qNorm > 0 ? qEmbB.map(v => v / qNorm) : qEmbB;
    const bScores = new Map();
    for (const cid of poolIdsQ) {
      const eB = normB.get(cid);
      if (!eB) { bScores.set(cid, 0); continue; }
      let dot = 0;
      for (let i = 0; i < qB.length; i++) dot += qB[i] * eB[i];
      bScores.set(cid, +dot.toFixed(4));
    }

    const rankA = [...aScores.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
    const rankB = [...bScores.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);

    const metrics = (ranked, expSet) => {
      const out = { p1: 0, p3: 0, p5: 0, r5: 0, mrr: 0 };
      for (let i = 0; i < Math.min(5, ranked.length); i++) { if (expSet.has(ranked[i])) { if (out.mrr === 0) out.mrr = 1 / (i + 1); } }
      const hits5 = ranked.slice(0, 5).filter(id => expSet.has(id));
      out.p5 = hits5.length / 5; out.r5 = hits5.length / Math.max(1, expSet.size);
      out.p3 = ranked.slice(0, 3).filter(id => expSet.has(id)).length / 3;
      out.p1 = expSet.has(ranked[0]) ? 1 : 0;
      return { p1: +out.p1.toFixed(4), p3: +out.p3.toFixed(4), p5: +out.p5.toFixed(4), r5: +out.r5.toFixed(4), mrr: +out.mrr.toFixed(4) };
    };
    const rankOf = (ranked, id) => { const i = ranked.indexOf(id); return i === -1 ? -1 : i + 1; };
    const bestGoldRank = (ranked, ids) => { const rs = ids.map(id => rankOf(ranked, id)).filter(r => r !== -1); return rs.length ? Math.min(...rs) : -1; };
    const bestGoldScore = (scores, ids) => { const vs = ids.map(id => scores.get(id)).filter(v => v !== undefined); return vs.length ? Math.max(...vs) : null; };

    const mA = metrics(rankA, goldSet);
    const mB = metrics(rankB, goldSet);
    const gA = bestGoldRank(rankA, goldAll);
    const gB = bestGoldRank(rankB, goldAll);
    const sA = bestGoldScore(aScores, goldAll);
    const sB = bestGoldScore(bScores, goldAll);

    // Márgenes gold vs top-1 negativo (discriminación)
    const compA = rankA.filter(id => !goldSet.has(id)).slice(0, 1).map(id => aScores.get(id))[0] ?? null;
    const compB = rankB.filter(id => !goldSet.has(id)).slice(0, 1).map(id => bScores.get(id))[0] ?? null;
    const marginA = sA !== null && compA !== null ? +(sA - compA).toFixed(4) : null;
    const marginB = sB !== null && compB !== null ? +(sB - compB).toFixed(4) : null;

    perQuery.push({
      query_id: q.query_id,
      support_status: q.support_status,
      was_miss: MISSES.includes(q.query_id),
      A: { metrics: mA, gold_rank: gA, gold_score: sA === null ? null : +sA.toFixed(4), margin: marginA, top1: rankA[0] },
      B: { metrics: mB, gold_rank: gB, gold_score: sB === null ? null : +sB.toFixed(4), margin: marginB, top1: rankB[0] },
      delta: { r5: +(mB.r5 - mA.r5).toFixed(4), mrr: +(mB.mrr - mA.mrr).toFixed(4), gold_score: sA !== null && sB !== null ? +(sB - sA).toFixed(4) : null, margin: marginA !== null && marginB !== null ? +(marginB - marginA).toFixed(4) : null },
      discrimination: marginA !== null && marginB !== null ? (marginB > marginA + 0.01 ? 'IMPROVED_DISCRIMINATION' : marginB < marginA - 0.01 ? 'WORSE_DISCRIMINATION' : 'SAME') : 'N/A',
    });
    console.log(`✅ ${q.query_id}: A R@5=${mA.r5} MRR=${mA.mrr} → B R@5=${mB.r5} MRR=${mB.mrr} | ΔR@5=${perQuery.at(-1).delta.r5 >= 0 ? '+' : ''}${perQuery.at(-1).delta.r5} | disc=${perQuery.at(-1).discrimination}`);
    await new Promise(r => setTimeout(r, 200));
  }

  // ── Paso 5: agregados ──
  const agg = (fn, list) => {
    const vals = list.map(fn); const n = vals.length;
    return { p1: +(vals.reduce((a, v) => a + v.p1, 0) / n).toFixed(4), p3: +(vals.reduce((a, v) => a + v.p3, 0) / n).toFixed(4), p5: +(vals.reduce((a, v) => a + v.p5, 0) / n).toFixed(4), r5: +(vals.reduce((a, v) => a + v.r5, 0) / n).toFixed(4), mrr: +(vals.reduce((a, v) => a + v.mrr, 0) / n).toFixed(4) };
  };
  const all = perQuery;
  const misses = perQuery.filter(q => q.was_miss);
  const rest = perQuery.filter(q => !q.was_miss);
  const discImp = perQuery.filter(q => q.discrimination === 'IMPROVED_DISCRIMINATION').length;
  const discWorse = perQuery.filter(q => q.discrimination === 'WORSE_DISCRIMINATION').length;

  const out = {
    cycle: '31', experiment: 'R5-C19', run,
    database: 'LOCAL_ONLY', production_contacted: false,
    model_a: 'nvidia/nv-embedqa-e5-v5 (1024d, API NVIDIA)',
    model_b: 'mxbai-embed-large (1024d, Ollama LOCAL) — misma dimensión que el productivo; comparación limpia del espacio semántico',
    methodology: 'CANDIDATE POOL (top-50 A + golds por query; ~N chunks únicos). NO es evaluación completa del motor. Documentado.',
    config: { topK: TOPK, pool_k: POOL_K, motor: 'PRODUCTIVO sin modificar' },
    baseline_r5c: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    cost: { pool_size: poolIds.length, embeddings_b_generated: embBCount, provider: "Ollama LOCAL (sin coste API)" },
    metrics: {
      A: agg(q => q.A.metrics, all),
      B: agg(q => q.B.metrics, all),
      delta: { r5: +(agg(q => q.B.metrics, all).r5 - agg(q => q.A.metrics, all).r5).toFixed(4), mrr: +(agg(q => q.B.metrics, all).mrr - agg(q => q.A.metrics, all).mrr).toFixed(4) },
    },
    groups: {
      misses: { A: agg(q => q.A.metrics, misses), B: agg(q => q.B.metrics, misses) },
      rest: { A: agg(q => q.A.metrics, rest), B: agg(q => q.B.metrics, rest) },
    },
    discrimination: { improved: discImp, worse: discWorse, same: all.length - discImp - discWorse, total: all.length },
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c19_embedding_model_ab_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  A R@5=${out.metrics.A.r5} MRR=${out.metrics.A.mrr} → B R@5=${out.metrics.B.r5} MRR=${out.metrics.B.mrr}`);
  console.log(`  Discriminación: improved=${discImp} worse=${discWorse} same=${all.length - discImp - discWorse}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
