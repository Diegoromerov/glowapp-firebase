#!/usr/bin/env node
/**
 * backend/scripts/r5c21TitleOnlyRepresentationExperiment.js
 * CICLO 33 — R5-C21: Representación documental "TÍTULO SOLO" (read-only, offline)
 *
 * Variable aislada ÚNICA: passage embedding = content  (ARM A, baseline actual)
 *                          vs  title + "\n\n" + content (ARM B, título solo)
 * Sin dominio, sin categoría, sin metadata, sin LLM, sin query expansion.
 * Mismo modelo e5-v5, misma query, mismo GOLD-V5, mismo K, mismo cosine.
 *
 * Diseño: candidate pool = top-50 de A + golds por query (documentado).
 * Embeddings B en memoria vía API NVIDIA (mismo modelo, texto distinto).
 *
 * Uso: node scripts/r5c21TitleOnlyRepresentationExperiment.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V5 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const POOL_K = 50;
const TOPK = 10;
const MISSES = ['cabello_002', 'cejas_004', 'cejas_008'];

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

  // ── Paso 1: candidate pool (top-50 A + golds) ──
  console.log('📦 Construyendo candidate pool (top-50 A + golds)...');
  const poolPerQuery = {};
  const allPoolIds = new Set();
  for (const q of queries) {
    const goldAll = [...q.expected_chunks.core, ...q.expected_chunks.supporting];
    const qEmb = await generateEmbedding(q.query, 'query');
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

  // ── Paso 2: título + contenido para ARM B ──
  const cRes = await ragPool.query(
    'SELECT chunk_id, title, content FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [poolIds]);
  const metaMap = new Map(cRes.rows.map(r => [r.chunk_id, r]));

  // ── Paso 3: embeddings B (title + "\n\n" + content) en memoria — mismo modelo e5-v5 ──
  console.log('🧠 Generando embeddings B (title + content, e5-v5) en memoria...');
  const embB = new Map();
  let calls = 0, errors = [];
  for (const cid of poolIds) {
    const m = metaMap.get(cid);
    if (!m) continue;
    const bText = `${m.title || ''}\n\n${m.content || ''}`;
    try {
      const e = await generateEmbedding(bText, 'passage');
      embB.set(cid, e);
      calls++;
    } catch (err) {
      errors.push({ chunk: cid.slice(0, 40), error: err.message });
      console.error(`  ❌ ${cid.slice(0, 40)}: ${err.message}`);
    }
    if (calls % 10 === 0) console.log(`  ...${calls} embeddings B`);
    await new Promise(r => setTimeout(r, 120));
  }
  console.log(`  ✅ ${calls} embeddings B, ${errors.length} errores`);

  // ── Paso 4: evaluación A vs B ──
  const perQuery = [];
  for (const q of queries) {
    const goldAll = [...q.expected_chunks.core, ...q.expected_chunks.supporting];
    const goldSet = new Set(goldAll);
    const poolIdsQ = poolPerQuery[q.query_id];

    // ARM A: query e5-v5 + embeddings BD (baseline exacto)
    const qEmb = await generateEmbedding(q.query, 'query');
    const aRes = await ragPool.query(
      `SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($2::text[])`, ['[' + qEmb.join(',') + ']', poolIdsQ]);
    const aScores = new Map(aRes.rows.map(r => [r.chunk_id, +r.sim.toFixed(4)]));

    // ARM B: misma query e5-v5 + embeddings B (title+content)
    const bScores = new Map();
    for (const cid of poolIdsQ) {
      const eB = embB.get(cid);
      if (!eB) { bScores.set(cid, 0); continue; }
      let dot = 0;
      for (let i = 0; i < qEmb.length; i++) dot += qEmb[i] * eB[i];
      bScores.set(cid, +dot.toFixed(4));
    }

    const rankA = [...aScores.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
    const rankB = [...bScores.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);

    const metrics = (ranked, expSet) => {
      const out = { p1: 0, p3: 0, p5: 0, r1: 0, r3: 0, r5: 0, r10: 0, mrr: 0 };
      const hits1 = ranked.slice(0, 1).filter(id => expSet.has(id));
      const hits3 = ranked.slice(0, 3).filter(id => expSet.has(id));
      const hits5 = ranked.slice(0, 5).filter(id => expSet.has(id));
      const hits10 = ranked.slice(0, 10).filter(id => expSet.has(id));
      out.r1 = hits1.length / Math.max(1, expSet.size);
      out.r3 = hits3.length / Math.max(1, expSet.size);
      out.r5 = hits5.length / Math.max(1, expSet.size);
      out.r10 = hits10.length / Math.max(1, expSet.size);
      out.p5 = hits5.length / 5;
      out.p3 = hits3.length / 3;
      out.p1 = expSet.has(ranked[0]) ? 1 : 0;
      for (let i = 0; i < Math.min(10, ranked.length); i++) { if (expSet.has(ranked[i])) { out.mrr = 1 / (i + 1); break; } }
      return { p1: +out.p1.toFixed(4), p3: +out.p3.toFixed(4), p5: +out.p5.toFixed(4), r1: +out.r1.toFixed(4), r3: +out.r3.toFixed(4), r5: +out.r5.toFixed(4), r10: +out.r10.toFixed(4), mrr: +out.mrr.toFixed(4) };
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

    // Hard negative: top-1 no-gold en cada arm
    const compA = rankA.filter(id => !goldSet.has(id)).slice(0, 1).map(id => aScores.get(id))[0] ?? null;
    const compB = rankB.filter(id => !goldSet.has(id)).slice(0, 1).map(id => bScores.get(id))[0] ?? null;
    const marginA = sA !== null && compA !== null ? +(sA - compA).toFixed(4) : null;
    const marginB = sB !== null && compB !== null ? +(sB - compB).toFixed(4) : null;

    // Clasificación causal: ¿cambio real de ranking o cosmético?
    let classification;
    if (gA === -1 && gB !== -1) classification = 'RECOVERED';
    else if (gA !== -1 && gB !== -1 && gB < gA) classification = 'IMPROVED_RANK';
    else if (gA !== -1 && gB !== -1 && gB === gA) classification = 'UNCHANGED';
    else if (gA !== -1 && gB !== -1 && gB > gA) classification = 'REGRESSED';
    else if (gA === -1 && gB === -1) classification = 'OUTSIDE_BOTH';
    else classification = 'LOST';

    perQuery.push({
      query_id: q.query_id,
      support_status: q.support_status,
      was_miss: MISSES.includes(q.query_id),
      classification,
      A: { metrics: mA, gold_rank: gA, gold_score: sA === null ? null : +sA.toFixed(4), margin: marginA, top10: rankA.slice(0, 10) },
      B: { metrics: mB, gold_rank: gB, gold_score: sB === null ? null : +sB.toFixed(4), margin: marginB, top10: rankB.slice(0, 10) },
      delta: { r5: +(mB.r5 - mA.r5).toFixed(4), mrr: +(mB.mrr - mA.mrr).toFixed(4), gold_score: sA !== null && sB !== null ? +(sB - sA).toFixed(4) : null, margin: marginA !== null && marginB !== null ? +(marginB - marginA).toFixed(4) : null, gold_rank: gB - gA },
    });
    console.log(`✅ ${q.query_id}: A R@5=${mA.r5} MRR=${mA.mrr} (rank=${gA}) → B R@5=${mB.r5} MRR=${mB.mrr} (rank=${gB}) [${classification}]`);
    await new Promise(r => setTimeout(r, 200));
  }

  // ── Paso 5: agregados ──
  const agg = (fn, list) => {
    const vals = list.map(fn); const n = vals.length;
    return { p1: +(vals.reduce((a, v) => a + v.p1, 0) / n).toFixed(4), p3: +(vals.reduce((a, v) => a + v.p3, 0) / n).toFixed(4), p5: +(vals.reduce((a, v) => a + v.p5, 0) / n).toFixed(4), r1: +(vals.reduce((a, v) => a + v.r1, 0) / n).toFixed(4), r3: +(vals.reduce((a, v) => a + v.r3, 0) / n).toFixed(4), r5: +(vals.reduce((a, v) => a + v.r5, 0) / n).toFixed(4), r10: +(vals.reduce((a, v) => a + v.r10, 0) / n).toFixed(4), mrr: +(vals.reduce((a, v) => a + v.mrr, 0) / n).toFixed(4) };
  };
  const all = perQuery;
  const misses = perQuery.filter(q => q.was_miss);
  const controls = perQuery.filter(q => !q.was_miss);
  const domain = {};
  for (const q of all) {
    const d = q.query_id.split('_')[0];
    (domain[d] = domain[d] || []).push(q);
  }
  const domainAgg = Object.fromEntries(Object.entries(domain).map(([d, list]) => [d, { A: agg(x => x.A.metrics, list), B: agg(x => x.B.metrics, list) }]));

  const out = {
    cycle: 'R5-C21',
    hypothesis: 'H0: agregar solo el título al passage embedding no mejora la recuperación de los misses. H1: produce mejora reproducible sin degradar controles.',
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    production_modified: false,
    methodology: 'CANDIDATE POOL (top-50 A + golds; documentado, no evaluación completa del motor)',
    representation: { A: 'content (baseline exacto)', B: 'title + "\\n\\n" + content (única variable)' },
    baseline_r5c: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    cost: { embeddings_b: calls, errors, provider: 'NVIDIA API (e5-v5, mismo modelo)' },
    metrics: { A: agg(x => x.A.metrics, all), B: agg(x => x.B.metrics, all) },
    miss_analysis: {
      A: agg(x => x.A.metrics, misses), B: agg(x => x.B.metrics, misses),
      per_miss: misses.map(q => ({ query_id: q.query_id, rank_A: q.A.gold_rank, rank_B: q.B.gold_rank, score_A: q.A.gold_score, score_B: q.B.gold_score, margin_A: q.A.margin, margin_B: q.B.margin, classification: q.classification })),
    },
    control_analysis: {
      A: agg(x => x.A.metrics, controls), B: agg(x => x.B.metrics, controls),
      regressions: controls.filter(q => q.classification === 'REGRESSED').map(q => q.query_id),
    },
    domain_analysis: domainAgg,
    hard_negative_analysis: { note: 'margin = gold_score − top1_no_gold (A vs B); mejora real solo si el RANK cambia, no si solo sube el score' },
    classification_summary: (() => { const c = {}; for (const q of all) c[q.classification] = (c[q.classification] || 0) + 1; return c; })(),
    reproducibility: 'RUN A ≡ RUN B (verificar en segunda corrida)',
    verdict: null,
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c21_title_only_representation_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  A R@5=${out.metrics.A.r5} MRR=${out.metrics.A.mrr} → B R@5=${out.metrics.B.r5} MRR=${out.metrics.B.mrr}`);
  console.log(`  Misses: A R@5=${out.miss_analysis.A.r5} → B R@5=${out.miss_analysis.B.r5}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
