#!/usr/bin/env node
/**
 * backend/scripts/r5c18DocumentRepresentationAB.js
 * CICLO 30 — R5-C18: A/B controlado de representación documental (read-only)
 *
 * ARM A (control):    passage embedding = content (exactamente el pipeline actual)
 * ARM B (experimental): passage embedding = domain + seccion + title + content
 *
 * TODO lo demás constante: query idéntica, modelo, GOLD-V5, K, threshold, cosine.
 * La única variable independiente es la representación documental.
 *
 * Diseño de costos (control de rate-limit):
 *  - ARM A: usa embeddings EXISTENTES en BD (0 llamadas nuevas)
 *  - ARM B: genera embeddings EN MEMORIA solo para el pool de candidatos
 *           (top-50 de A + golds por query; ~60-90 chunks únicos en total)
 *  - delay controlado entre llamadas
 *
 * READ-ONLY. Guarda anti-producción.
 * Uso: node scripts/r5c18DocumentRepresentationAB.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V5 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const CORPUS = path.join(__dirname, '..', 'src', 'data', 'corpus_canonico', 'corpus_canonico.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

const POOL_K = 50; // profundidad del pool de candidatos (cobertura)

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
  const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const corpusById = new Map(corpus.chunks.map(c => [c.chunk_id, c]));
  const queries = v5.queries.filter(q => q.support_status === 'SUPPORTED' || q.support_status === 'PARTIALLY_SUPPORTED');
  const TOPK = 10;

  // ── Paso 1: pool de candidatos por query (top-50 de A con embeddings BD) ──
  console.log('📦 Construyendo pool de candidatos (top-50 A + golds)...');
  const poolPerQuery = {};
  const allPoolIds = new Set();
  for (const q of queries) {
    const goldAll = [...q.expected_chunks.core, ...q.expected_chunks.supporting];
    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${POOL_K}`, ['[' + qEmb.join(',') + ']']);
    const poolIds = res.rows.map(r => r.chunk_id);
    // Añadir golds que no estén en top-50 (para medir su rank en B)
    for (const g of goldAll) if (!poolIds.includes(g)) poolIds.push(g);
    poolPerQuery[q.query_id] = poolIds;
    poolIds.forEach(id => allPoolIds.add(id));
  }
  const poolIds = [...allPoolIds];
  console.log(`  Pool único: ${poolIds.length} chunks (de ${queries.length} queries)`);

  // ── Paso 2: carga de metadata para ARM B ──
  const metaRes = await ragPool.query(
    'SELECT chunk_id, document_id, title, category, seccion, content FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [poolIds]);
  const metaMap = new Map(metaRes.rows.map(r => [r.chunk_id, r]));

  // ── Paso 3: embeddings B en memoria (solo pool) ──
  console.log('🧠 Generando embeddings B (dominio+seccion+titulo+contenido) en memoria...');
  const embB = new Map();
  let calls = 0, errors = [];
  for (const cid of poolIds) {
    const m = metaMap.get(cid);
    if (!m) { console.error(`  ⚠️ Sin metadata para ${cid.slice(0, 40)}`); continue; }
    const cCorpus = corpusById.get(cid);
    const domain = cCorpus?.category || m.category || '';
    const seccion = cCorpus?.seccion || m.seccion || '';
    const title = m.title || '';
    const content = m.content || '';
    // ARM B: dominio + sección + título + contenido (misma longitud aproximada que A)
    const bText = [domain, seccion, title, content].filter(Boolean).join(' | ');
    try {
      const e = await generateEmbedding(bText, 'passage');
      embB.set(cid, e);
      calls++;
    } catch (err) {
      errors.push({ chunk: cid.slice(0, 40), error: err.message });
      console.error(`  ❌ Error embedding ${cid.slice(0, 40)}: ${err.message}`);
    }
    if (calls % 10 === 0) console.log(`  ...${calls} embeddings B generados`);
    await new Promise(r => setTimeout(r, 120)); // delay controlado
  }
  console.log(`  ✅ ${calls} embeddings B, ${errors.length} errores`);

  // ── Paso 4: evaluación A vs B ──
  const perQuery = [];
  const embACache = new Map(); // query → embedding (reutilizar entre queries no aplica; cachear por query para A y B)
  for (const q of queries) {
    const goldAll = [...q.expected_chunks.core, ...q.expected_chunks.supporting];
    const goldSet = new Set(goldAll);
    const poolIdsQ = poolPerQuery[q.query_id];

    const qEmb = await generateEmbedding(q.query, 'query');

    // ARM A: similitud con embeddings EXISTENTES en BD (pipeline actual)
    const aRes = await ragPool.query(
      `SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($2::text[])`, ['[' + qEmb.join(',') + ']', poolIdsQ]);
    const aScores = new Map(aRes.rows.map(r => [r.chunk_id, +r.sim.toFixed(4)]));

    // ARM B: similitud coseno en memoria con embeddings B
    const bScores = new Map();
    for (const cid of poolIdsQ) {
      const eB = embB.get(cid);
      if (!eB) { bScores.set(cid, 0); continue; }
      // cosine = dot / (|a|*|b|) — embeddings normalizados por NVIDIA; usar dot product
      let dot = 0;
      for (let i = 0; i < qEmb.length; i++) dot += qEmb[i] * eB[i];
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
    const top1Score = (scores, ranked) => scores.get(ranked[0]) ?? null;

    const mA = metrics(rankA, goldSet);
    const mB = metrics(rankB, goldSet);
    const gA = bestGoldRank(rankA, goldAll);
    const gB = bestGoldRank(rankB, goldAll);
    const sA = bestGoldScore(aScores, goldAll);
    const sB = bestGoldScore(bScores, goldAll);

    // Clasificación
    let cls;
    if (gB !== -1 && (gA === -1 || gB < gA)) cls = 'IMPROVED';
    else if (gA !== -1 && (gB === -1 || gB > gA)) cls = 'REGRESSED';
    else cls = 'UNCHANGED';

    // Hard negatives: top-5 competidores (no-gold) en A y B
    const compA = rankA.filter(id => !goldSet.has(id)).slice(0, 5).map(id => ({ chunk_id: id, sim: aScores.get(id) }));
    const compB = rankB.filter(id => !goldSet.has(id)).slice(0, 5).map(id => ({ chunk_id: id, sim: bScores.get(id) }));

    perQuery.push({
      query_id: q.query_id,
      support_status: q.support_status,
      was_miss: ['cabello_002', 'cejas_004', 'cejas_008'].includes(q.query_id),
      classification: cls,
      A: { metrics: mA, gold_rank: gA, gold_score: sA === null ? null : +sA.toFixed(4), top1_score: top1Score(aScores, rankA), top10: rankA.slice(0, 10), competitors: compA },
      B: { metrics: mB, gold_rank: gB, gold_score: sB === null ? null : +sB.toFixed(4), top1_score: top1Score(bScores, rankB), top10: rankB.slice(0, 10), competitors: compB },
      delta: {
        r5: +(mB.r5 - mA.r5).toFixed(4), mrr: +(mB.mrr - mA.mrr).toFixed(4), p5: +(mB.p5 - mA.p5).toFixed(4),
        gold_score: sA !== null && sB !== null ? +(sB - sA).toFixed(4) : null,
        gold_rank: gA === -1 && gB === -1 ? 0 : gB - gA,
      },
    });
    console.log(`✅ ${q.query_id}: A R@5=${mA.r5} MRR=${mA.mrr} (goldRank=${gA}) → B R@5=${mB.r5} MRR=${mB.mrr} (goldRank=${gB}) [${cls}]`);
    await new Promise(r => setTimeout(r, 200));
  }

  // ── Paso 5: agregados ──
  const agg = (fn, list) => {
    const vals = list.map(fn); const n = vals.length;
    return { p1: +(vals.reduce((a, v) => a + v.p1, 0) / n).toFixed(4), p3: +(vals.reduce((a, v) => a + v.p3, 0) / n).toFixed(4), p5: +(vals.reduce((a, v) => a + v.p5, 0) / n).toFixed(4), r5: +(vals.reduce((a, v) => a + v.r5, 0) / n).toFixed(4), mrr: +(vals.reduce((a, v) => a + v.mrr, 0) / n).toFixed(4) };
  };
  const all = perQuery;
  const supported = perQuery.filter(q => q.support_status === 'SUPPORTED');
  const misses = perQuery.filter(q => q.was_miss);
  const rest = perQuery.filter(q => !q.was_miss);
  const improved = perQuery.filter(q => q.classification === 'IMPROVED').length;
  const regressed = perQuery.filter(q => q.classification === 'REGRESSED').length;
  const unchanged = perQuery.filter(q => q.classification === 'UNCHANGED').length;

  const out = {
    cycle: '30', experiment: 'R5-C18', run,
    database: 'LOCAL_ONLY', production_contacted: false,
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    config: { topK: TOPK, pool_k: POOL_K, motor: 'PRODUCTIVO sin modificar', nota: 'ARM B evaluado sobre pool top-50 A + golds (cobertura acotada, documentado)' },
    baseline_r5c: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO — referencia oficial' },
    representation: {
      A: 'passage embedding = content (pipeline actual exacto)',
      B: 'passage embedding = domain + seccion + title + content (en memoria, sin reingesta)',
      campos: ['category (dominio)', 'seccion', 'title', 'content'], separador: ' | ',
      note: 'Misma query, mismo modelo, mismo GOLD-V5, mismo K. Única variable: representación documental.',
    },
    cost: { embeddings_B_generated: calls, errors, note: 'ARM A usa embeddings BD (0 llamadas). ARM B solo pool (~60-90 chunks). Delay 120ms.' },
    metrics: {
      A_control: agg(q => q.A.metrics, all),
      B_experimental: agg(q => q.B.metrics, all),
      delta: { r5: +(agg(q => q.B.metrics, all).r5 - agg(q => q.A.metrics, all).r5).toFixed(4), mrr: +(agg(q => q.B.metrics, all).mrr - agg(q => q.A.metrics, all).mrr).toFixed(4) },
      supported_A: agg(q => q.A.metrics, supported),
      supported_B: agg(q => q.B.metrics, supported),
    },
    groups: {
      misses: { A: agg(q => q.A.metrics, misses), B: agg(q => q.B.metrics, misses) },
      rest: { A: agg(q => q.A.metrics, rest), B: agg(q => q.B.metrics, rest) },
    },
    classification: { improved, regressed, unchanged, total: all.length },
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c18_document_representation_ab_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  A R@5=${out.metrics.A_control.r5} MRR=${out.metrics.A_control.mrr} → B R@5=${out.metrics.B_control?.r5 ?? out.metrics.B_experimental.r5} MRR=${out.metrics.B_experimental.mrr}`);
  console.log(`  Improved=${improved} Regressed=${regressed} Unchanged=${unchanged}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
