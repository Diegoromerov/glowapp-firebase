#!/usr/bin/env node
/**
 * backend/scripts/r5c22CandidatePoolRecallCeiling.js
 * CICLO 34 — R5-C22: Candidate pool / recall ceiling (read-only, diagnóstico)
 *
 * Pregunta: ¿dónde se pierde la evidencia? ¿recuperación (fuera del pool),
 * ranking (en el pool pero abajo), o léxico (vector la pierde pero lexical la encuentra)?
 *
 * EXPERIMENTO A: top-100 vectorial por query; clasificar golds TOP5/10/20/50/100/>100
 * EXPERIMENTO B: recall ceiling R@5/10/20/50/100 + MRR@K
 * EXPERIMENTO C: los 3 misses en detalle
 * EXPERIMENTO D: hard negatives (dominio/título)
 * EXPERIMENTO E: diagnóstico léxico (TF simple en memoria, sin LLM)
 * EXPERIMENTO F: unión vector + lexical en memoria
 * EXPERIMENTO G: clasificación causal A-E
 *
 * READ-ONLY. Guarda anti-producción. Uso: node scripts/r5c22CandidatePoolRecallCeiling.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V5 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const CORPUS = path.join(__dirname, '..', 'src', 'data', 'corpus_canonico', 'corpus_canonico.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const TOPK = 100;
const MISSES = ['cabello_002', 'cejas_004', 'cejas_008'];

const STOP = new Set('de la el en y a los del se las por un para con no una su al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mis tu tus suyas esos esas'.split(/\s+/));

function tokenize(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,:;()"'«»]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
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
  const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const queries = v5.queries.filter(q => q.support_status !== 'UNSUPPORTED');

  // ── Índice léxico en memoria (TF simple sobre corpus canónico) ──
  // document_id + content tokenizado
  const lexDocs = corpus.chunks.map(c => ({ chunk_id: c.chunk_id, tokens: tokenize(c.content) }));
  console.log(`📚 Índice léxico: ${lexDocs.length} chunks`);

  // Pre-tokenizar queries
  const perQuery = [];
  for (const q of queries) {
    const goldAll = [...q.expected_chunks.core, ...q.expected_chunks.supporting];
    const goldSet = new Set(goldAll);
    const qTokens = tokenize(q.query);

    // ── EXPERIMENTO A: top-100 vectorial ──
    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT chunk_id, document_id, title, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + qEmb.join(',') + ']']);
    const vecTop = res.rows.map(r => ({ chunk_id: r.chunk_id, document_id: r.document_id, title: r.title || '', score: +r.sim.toFixed(4) }));

    // Ranks de golds en vector
    const goldRanks = {};
    for (const g of goldAll) {
      const i = vecTop.findIndex(r => r.chunk_id === g);
      goldRanks[g] = i === -1 ? -1 : i + 1;
    }
    const bestGoldRank = Math.min(...Object.values(goldRanks).filter(r => r !== -1), 999);
    const anyInTop = (k) => Object.values(goldRanks).some(r => r !== -1 && r <= k);
    const goldClass = bestGoldRank === 999 ? '>TOP100' :
      bestGoldRank <= 5 ? 'TOP5' : bestGoldRank <= 10 ? 'TOP10' : bestGoldRank <= 20 ? 'TOP20' : bestGoldRank <= 50 ? 'TOP50' : bestGoldRank <= 100 ? 'TOP100' : '>TOP100';

    // ── EXPERIMENTO B: recall ceiling (por query) ──
    const recallAt = (k) => vecTop.slice(0, k).filter(r => goldSet.has(r.chunk_id)).length / Math.max(1, goldAll.length);
    const mrrAt = (k) => {
      for (let i = 0; i < Math.min(k, vecTop.length); i++) {
        if (goldSet.has(vecTop[i].chunk_id)) return 1 / (i + 1);
      }
      return 0;
    };

    // ── EXPERIMENTO E: diagnóstico léxico (TF) ──
    const qTokSet = new Set(qTokens);
    const lexScores = lexDocs.map(d => {
      let hits = 0;
      const dSet = new Set(d.tokens);
      for (const t of qTokSet) if (dSet.has(t)) hits++;
      return { chunk_id: d.chunk_id, hits };
    }).filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits);
    const lexTop = lexScores.map(x => x.chunk_id);
    const lexGoldRank = (() => { const i = lexTop.findIndex(id => goldSet.has(id)); return i === -1 ? -1 : i + 1; })();
    const lexAnyInTop = (k) => lexTop.slice(0, k).some(id => goldSet.has(id));

    // ── EXPERIMENTO F: unión vector + lexical ──
    const unionTop = [...new Set([...vecTop.map(r => r.chunk_id), ...lexTop])];
    const unionRecallAt = (k) => unionTop.slice(0, k).filter(id => goldSet.has(id)).length / Math.max(1, goldAll.length);
    const unionGoldRank = (() => { const i = unionTop.findIndex(id => goldSet.has(id)); return i === -1 ? -1 : i + 1; })();

    // ── EXPERIMENTO D: hard negatives (top-5 competidores) ──
    const hardNegatives = vecTop.filter(r => !goldSet.has(r.chunk_id)).slice(0, 5).map(r => ({
      chunk_id: r.chunk_id, score: r.score, title: (r.title || '').slice(0, 60),
      document_id: r.document_id,
    }));

    // ── EXPERIMENTO G: clasificación causal ──
    let causalClass;
    if (bestGoldRank <= 5) causalClass = 'A_VECTOR_SUCCESS';
    else if (bestGoldRank <= 100) causalClass = 'B_VECTOR_LATE';
    else if (lexGoldRank !== -1 && lexGoldRank <= 20) causalClass = 'C_VECTOR_MISS_LEXICAL_HIT';
    else if (lexGoldRank !== -1) causalClass = 'E_LEXICAL_ONLY_ADVANTAGE';
    else causalClass = 'D_BOTH_MISS';

    perQuery.push({
      query_id: q.query_id,
      support_status: q.support_status,
      was_miss: MISSES.includes(q.query_id),
      gold_class: goldClass,
      best_gold_rank: bestGoldRank === 999 ? -1 : bestGoldRank,
      gold_ranks: goldRanks,
      recall: { r5: +recallAt(5).toFixed(4), r10: +recallAt(10).toFixed(4), r20: +recallAt(20).toFixed(4), r50: +recallAt(50).toFixed(4), r100: +recallAt(100).toFixed(4) },
      mrr: { r5: +mrrAt(5).toFixed(4), r10: +mrrAt(10).toFixed(4), r20: +mrrAt(20).toFixed(4), r50: +mrrAt(50).toFixed(4), r100: +mrrAt(100).toFixed(4) },
      lexical: { gold_rank: lexGoldRank, any_in_20: lexAnyInTop(20), any_in_100: lexAnyInTop(100) },
      union: { gold_rank: unionGoldRank, recall_r5: +unionRecallAt(5).toFixed(4), recall_r10: +unionRecallAt(10).toFixed(4), recall_r20: +unionRecallAt(20).toFixed(4) },
      hard_negatives: hardNegatives,
      causal_class: causalClass,
      vector_top10: vecTop.slice(0, 10).map(r => r.chunk_id),
    });
    console.log(`✅ ${q.query_id}: bestGoldRank=${bestGoldRank === 999 ? '>100' : bestGoldRank} [${goldClass}] | R@5=${recallAt(5).toFixed(2)} R@100=${recallAt(100).toFixed(2)} | lexRank=${lexGoldRank} | unionRank=${unionGoldRank} [${causalClass}]`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── Agregados ──
  const avg = (fn) => { const vals = perQuery.map(fn); return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4); };
  const recallGlobal = {
    r5: avg(q => q.recall.r5), r10: avg(q => q.recall.r10), r20: avg(q => q.recall.r20), r50: avg(q => q.recall.r50), r100: avg(q => q.recall.r100),
  };
  const mrrGlobal = {
    r5: avg(q => q.mrr.r5), r10: avg(q => q.mrr.r10), r20: avg(q => q.mrr.r20), r50: avg(q => q.mrr.r50), r100: avg(q => q.mrr.r100),
  };
  const unionRecallGlobal = { r5: avg(q => q.union.recall_r5), r10: avg(q => q.union.recall_r10), r20: avg(q => q.union.recall_r20) };
  const lexAny20 = perQuery.filter(q => q.lexical.any_in_20).length;
  const unionImproves = perQuery.filter(q => q.union.gold_rank !== -1 && (q.best_gold_rank === -1 || q.union.gold_rank < q.best_gold_rank)).length;
  const misses = perQuery.filter(q => q.was_miss);

  const out = {
    cycle: 'R5-C22',
    model: 'e5-v5 (1024d)',
    gold_version: 'GOLD-V5',
    production_modified: false,
    railway_contacted: false,
    vector_recall: recallGlobal,
    vector_mrr: mrrGlobal,
    lexical_recall: { any_in_20_queries: `${lexAny20}/${perQuery.length}`, note: 'proporción de queries con al menos un gold en lexical top-20' },
    union_recall: unionRecallGlobal,
    union_improves_over_vector: `${unionImproves}/${perQuery.length}`,
    miss_analysis: misses.map(q => ({
      query_id: q.query_id,
      gold_class: q.gold_class,
      best_gold_rank: q.best_gold_rank,
      recall: q.recall,
      lexical_gold_rank: q.lexical.gold_rank,
      union_gold_rank: q.union.gold_rank,
      hard_negatives: q.hard_negatives,
    })),
    hard_negatives: perQuery.flatMap(q => q.hard_negatives.map(h => ({ query: q.query_id, ...h }))).slice(0, 30),
    causal_classification: {
      summary: (() => { const c = {}; for (const q of perQuery) c[q.causal_class] = (c[q.causal_class] || 0) + 1; return c; })(),
      per_query: perQuery.map(q => ({ query_id: q.query_id, class: q.causal_class, best_gold_rank: q.best_gold_rank })),
    },
    reproducibility: 'RUN A ≡ RUN B (verificar en segunda corrida)',
    verdict: null,
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c22_candidate_pool_recall_ceiling_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  Recall vector: R@5=${recallGlobal.r5} R@10=${recallGlobal.r10} R@20=${recallGlobal.r20} R@50=${recallGlobal.r50} R@100=${recallGlobal.r100}`);
  console.log(`  MRR vector: R@5=${mrrGlobal.r5} R@100=${mrrGlobal.r100}`);
  console.log(`  Unión: R@5=${unionRecallGlobal.r5} R@20=${unionRecallGlobal.r20} | mejora en ${unionImproves}/${perQuery.length}`);
  console.log(`  Clasificación: ${JSON.stringify(out.causal_classification.summary)}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
