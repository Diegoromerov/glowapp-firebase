#!/usr/bin/env node
/**
 * backend/scripts/r5c17EmbeddingDiscriminationExperiment.js
 * CICLO 29 — R5-C17: Discriminación del embedding + representación documental
 *
 * Casos: 3 misses (cabello_002, cejas_004, cejas_008) + 4 controles positivos
 *        (skincare_003, skincare_010, cabello_008, cejas_007)
 *
 * EXP A — Matriz query↔documento: sim(query,gold), sim(query,competidores), márgenes
 * EXP B — Gold↔Gold: sim(gold_embedding, competitor_embedding)
 * EXP C — Hard negatives (del retrieval real, con clasificación)
 * EXP D — Discriminación relativa: gold vs top1/top5/mean/max negatives (agregado)
 * EXP E — Caracterización de chunks problemáticos (largo, dominios, título)
 * EXP F — Representación documental en memoria: título+contenido y dominio+título+contenido
 *         (SIN reingestar, SIN escribir embeddings, SOLO en memoria)
 *
 * READ-ONLY. Guarda anti-producción. Uso: node scripts/r5c17EmbeddingDiscriminationExperiment.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V5 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

const MISSES = ['cabello_002', 'cejas_004', 'cejas_008'];
const CONTROLS = ['skincare_003', 'skincare_010', 'cabello_008', 'cejas_007'];
const ALL_CASES = [...MISSES, ...CONTROLS];

// Representaciones documentales alternativas (en memoria, sin tocar BD)
// DOC_A = título + contenido (mismo texto que produce el embedding actual)
// DOC_B = título + contenido (con dominio explícito)
const DOC_PREFIX = {
  'cabello_002': 'Colorimetría capilar — ',
  'cejas_004': 'Visajismo y diseño de cejas — ',
  'cejas_008': 'Visajismo y diseño de cejas — ',
  'skincare_003': 'Rutinas de skincare por tipo de piel — ',
  'skincare_010': 'Rutinas de skincare por tipo de piel — ',
  'cabello_008': 'Cuidado corporal y cabello — ',
  'cejas_007': 'Visajismo y diseño de cejas — ',
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

  const perCase = [];
  const aggregate = {};

  for (const qid of ALL_CASES) {
    const g = q5map.get(qid);
    const goldAll = [...g.expected_chunks.core, ...g.expected_chunks.supporting];
    const goldSet = new Set(goldAll);
    const isMiss = MISSES.includes(qid);

    // ── Query embedding + retrieval productivo ──
    const qEmb = await generateEmbedding(g.query, 'query');
    const vecQ = '[' + qEmb.join(',') + ']';
    const res = await ragPool.query(
      `SELECT id, chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, [vecQ]);
    const top10 = res.rows.map(r => ({ chunk_id: r.chunk_id, document_id: r.document_id, title: r.title, sim: +r.sim.toFixed(4) }));

    // ── EXP A: matriz query↔documento ──
    // sim(query, gold) directo
    const goldSims = await ragPool.query(
      'SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($2::text[])', [vecQ, goldAll]);
    const goldSimMap = new Map(goldSims.rows.map(r => [r.chunk_id, +r.sim.toFixed(4)]));

    // competidores: top-5 no-gold del retrieval
    const competitors = top10.filter(r => !goldSet.has(r.chunk_id)).slice(0, 5);
    const marginData = { gold_scores: [...goldSimMap.values()], competitor_scores: competitors.map(c => c.sim) };
    const bestGold = Math.max(...marginData.gold_scores);
    const top1Comp = competitors[0]?.sim ?? null;
    const meanComp = marginData.competitor_scores.length ? marginData.competitor_scores.reduce((a, b) => a + b, 0) / marginData.competitor_scores.length : null;
    const maxComp = marginData.competitor_scores.length ? Math.max(...marginData.competitor_scores) : null;
    const margins = {
      gold_vs_top1: bestGold - (top1Comp ?? bestGold),
      gold_vs_mean_neg: bestGold - (meanComp ?? bestGold),
      gold_vs_max_neg: bestGold - (maxComp ?? bestGold),
    };

    // ── EXP B: gold↔competidores (embeddings de BD) ──
    const goldIds = [...goldSimMap.keys()];
    const compIds = competitors.map(c => c.chunk_id);
    const goldComp = [];
    if (goldIds.length && compIds.length) {
      const bRes = await ragPool.query(
        `SELECT a.chunk_id AS gold, b.chunk_id AS comp, 1-(a.embedding <=> b.embedding) AS sim
         FROM beauty_knowledge_embeddings a
         CROSS JOIN LATERAL (SELECT chunk_id, embedding FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($2::text[])) b
         WHERE a.chunk_id = ANY($1::text[])`, [goldIds, compIds]);
      for (const r of bRes.rows) {
        goldComp.push({ gold: r.gold, competitor: r.comp, sim: +r.sim.toFixed(4) });
      }
    }

    // ── EXP C: hard negatives clasificados ──
    const hardNegatives = competitors.map(c => ({
      chunk_id: c.chunk_id,
      title: (c.title || '').slice(0, 80),
      sim_query: c.sim,
      delta_vs_best_gold: +(bestGold - c.sim).toFixed(4),
      classification: c.sim > bestGold ? 'NEGATIVO_SUPERA_GOLD' : (bestGold - c.sim) < 0.03 ? 'EMPATE_PRACTICO' : (bestGold - c.sim) < 0.06 ? 'COMPETENCIA_ESTRECHA' : 'SEPARACION_CLARA',
    }));

    // ── EXP E: características del chunk problemático ──
    const chunkInfo = await ragPool.query(
      'SELECT chunk_id, document_id, title, LENGTH(content) AS len FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [goldIds]);
    const chunkChars = chunkInfo.rows.map(r => ({
      chunk_id: r.chunk_id, document_id: r.document_id, title: (r.title || '').slice(0, 70), len: r.len,
    }));

    // ── EXP F: representación documental en memoria ──
    // F1: embedding con dominio+título+contenido (simulación de representación alternativa)
    const docReps = {};
    for (const cid of goldIds) {
      const c = chunkInfo.rows.find(r => r.chunk_id === cid);
      if (!c) continue;
      const fullText = `${DOC_PREFIX[qid] || ''}${c.title}. ${c.content}`;
      const dEmb = await generateEmbedding(fullText, 'passage');
      const dRes = await ragPool.query(
        'SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($2::text[])',
        ['[' + dEmb.join(',') + ']', goldIds]);
      const dMap = new Map(dRes.rows.map(r => [r.chunk_id, +r.sim.toFixed(4)]));
      docReps[cid] = { text_prefix: DOC_PREFIX[qid] || '', sim_query_to_docrep: dMap.get(cid) ?? null, sim_gold_vs_competitors: {} };
    }

    perCase.push({
      query_id: qid,
      query: g.query,
      case_type: isMiss ? 'MISS' : 'CONTROL_POSITIVO',
      support_status: g.support_status,
      gold_chunks: goldIds,
      expA_query_document: {
        gold_scores: marginData.gold_scores,
        best_gold_score: +bestGold.toFixed(4),
        competitors: competitors.map(c => ({ chunk_id: c.chunk_id, title: (c.title || '').slice(0, 70), sim: c.sim })),
        margins,
      },
      expB_gold_competitor_sim: goldComp,
      expC_hard_negatives: hardNegatives,
      expE_chunk_chars: chunkChars,
      expF_doc_representation: docReps,
      rank_of_best_gold: (() => { const i = top10.findIndex(r => goldSet.has(r.chunk_id)); return i === -1 ? -1 : i + 1; })(),
      gold_in_top5: top10.slice(0, 5).some(r => goldSet.has(r.chunk_id)),
    });
    console.log(`✅ ${qid} [${isMiss ? 'MISS' : 'CTRL'}]: bestGold=${marginData.best_gold_score} top1Comp=${top1Comp} margin=${margins.gold_vs_top1 >= 0 ? '+' : ''}${margins.gold_vs_top1.toFixed(4)} | goldTop5=${perCase.at(-1).gold_in_top5}`);
    await new Promise(r => setTimeout(r, 300));
  }

  // ── EXP D: agregados de discriminación ──
  const missCases = perCase.filter(c => c.case_type === 'MISS');
  const ctrlCases = perCase.filter(c => c.case_type === 'CONTROL_POSITIVO');
  const aggStats = (cases) => {
    const margins = cases.map(c => c.expA_query_document.margins.gold_vs_top1);
    const sorted = [...margins].sort((a, b) => a - b);
    const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    return { mean: +mean.toFixed(4), median: +median.toFixed(4), min: +sorted[0].toFixed(4), max: +sorted[sorted.length - 1].toFixed(4), n: margins.length };
  };
  aggregate.misses = aggStats(missCases);
  aggregate.controls = aggStats(ctrlCases);

  // ── EXP F resumen: ¿la representación documental separa mejor? ──
  // Comparar sim(query→gold actual) vs sim(query→docrep) — si docrep sube la sim del gold, la representación documental es factor
  const docRepEffect = [];
  for (const c of perCase) {
    for (const [cid, rep] of Object.entries(c.expF_doc_representation)) {
      const origSim = c.expA_query_document.gold_scores.find((_, i) => c.gold_chunks[i] === cid);
      docRepEffect.push({ query: c.query_id, chunk: cid, sim_query_gold_orig: origSim ?? null, sim_query_gold_docrep: rep.sim_query_to_docrep });
    }
  }

  const out = {
    cycle: '29', experiment: 'R5-C17', run,
    database: 'LOCAL_ONLY', production_contacted: false,
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    config: { topK: TOPK, motor: 'PRODUCTIVO sin modificar' },
    baseline_r5c: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    cases: { misses: MISSES, controls: CONTROLS, rationale: 'Misses = los 3 reales de GOLD-V5; controles = queries con R@5=1 en baseline R5-C14' },
    expD_aggregate: aggregate,
    expF_doc_representation_effect: docRepEffect,
    per_case: perCase,
  };
  const outPath = path.join(OUT_DIR, `r5c17_embedding_discrimination_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  Misses margin(gold−top1): mean=${aggregate.misses.mean} median=${aggregate.misses.median} min=${aggregate.misses.min}`);
  console.log(`  Controles margin(gold−top1): mean=${aggregate.controls.mean} median=${aggregate.controls.median} min=${aggregate.controls.min}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
