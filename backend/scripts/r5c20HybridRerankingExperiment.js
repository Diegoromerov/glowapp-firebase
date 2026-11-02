#!/usr/bin/env node
/**
 * backend/scripts/r5c20HybridRerankingExperiment.js
 * CICLO 32 — R5-C20: A/B de reranking híbrido (read-only, determinista)
 *
 * Pregunta: ¿el gold está en el candidate pool (recall) y un reranker
 * híbrido puede subirlo (ranking)?
 *
 * ARM A: top-50 e5-v5 actual, SIN reranking (baseline contemporáneo)
 * ARM B: mismo top-50 e5-v5 + reranker híbrido (fórmula congelada)
 *
 * Reranker híbrido (explicable, sin LLM externo, sin reglas por query):
 *   hybrid = w_v * norm(vector) + w_l * lexical + w_c * concept + w_t * title
 *
 * Señales (todas deterministas, sobre el pool):
 *  - vector: similitud e5-v5 normalizada min-max dentro del pool
 *  - lexical: solapamiento de términos de la query en content (normalizado)
 *  - concept: términos clave de dominio (activos/condiciones/procedimientos)
 *    — lista GENÉRICA de conceptos de belleza/dermatología, NO derivada del gold
 *  - title: solapamiento de términos de la query en title
 *
 * GRID PRE-REGISTRADO (3 configuraciones, todas reportadas):
 *  CFG1: w_v=0.70 w_l=0.20 w_c=0.05 w_t=0.05
 *  CFG2: w_v=0.50 w_l=0.30 w_c=0.10 w_t=0.10
 *  CFG3: w_v=0.30 w_l=0.40 w_c=0.15 w_t=0.15
 * NO hay tuning post-hoc: los pesos se fijan antes de evaluar.
 *
 * Uso: node scripts/r5c20HybridRerankingExperiment.js --run=A
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

// ── Conceptos de dominio (lista GENÉRICA de belleza/dermatología, NO derivada del gold) ──
const CONCEPTS = [
  // activos/ingredientes
  'niacinamida', 'vitamina c', 'ácido hialurónico', 'retinol', 'ácido salicílico', 'peróxido de benzoilo',
  'hidroquinona', 'arbutina', 'urea', 'ceramidas', 'péptidos', 'ácido glicólico', 'ácido láctico', 'ácido azelaico',
  'filtro solar', 'spf', 'óxido de zinc', 'dióxido de titanio', 'aceite de romero', 'aceites esenciales',
  // condiciones/problemas
  'acné', 'melasma', 'hiperpigmentación', 'piel grasa', 'piel seca', 'piel sensible', 'rosácea', 'dermatitis',
  'eccema', 'psoriasis', 'queratosis pilaris', 'celulitis', 'cicatriz', 'manchas', 'poros', 'arrugas',
  'caída de cabello', 'caspa', 'cuero cabelludo', 'alopecia', 'puntas secas', 'cabello dañado', 'decoloración',
  // procedimientos
  'microblading', 'micropigmentación', 'peeling', 'hidratación', 'exfoliación', 'limpiador', 'tónico', 'sérum',
  'protector solar', 'mascarilla', 'champú', 'acondicionador', 'tinte', 'coloración', 'láser', 'electrólisis',
  // zonas anatómicas
  'cutícula', 'microbioma', 'barrera cutánea', 'estrato córneo', 'melanocito', 'folículo', 'dermis', 'epidermis',
  'cejas', 'párpado', 'orbicular', 'pH', 'dermis',
];

// ── GRID PRE-REGISTRADO de pesos ──
const GRID = {
  CFG1: { w_v: 0.70, w_l: 0.20, w_c: 0.05, w_t: 0.05 },
  CFG2: { w_v: 0.50, w_l: 0.30, w_c: 0.10, w_t: 0.10 },
  CFG3: { w_v: 0.30, w_l: 0.40, w_c: 0.15, w_t: 0.15 },
};

function tokenize(text) {
  return (text || '').toLowerCase().replace(/[¿?¡!.,:;()"'«»]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

// Señal léxica: solapamiento de términos de la query en el contenido
function lexicalScore(queryTokens, content) {
  if (!content || queryTokens.length === 0) return 0;
  const contentTokens = new Set(tokenize(content));
  const hits = queryTokens.filter(t => contentTokens.has(t)).length;
  return hits / Math.max(1, queryTokens.length);
}

// Señal de concepto: cuántos conceptos de dominio aparecen en el contenido
function conceptScore(content) {
  if (!content) return 0;
  const c = content.toLowerCase();
  let hits = 0;
  for (const con of CONCEPTS) {
    if (c.includes(con)) hits++;
  }
  return Math.min(1, hits / 5); // saturar a 5+ conceptos
}

// Señal de título: solapamiento de términos de la query en el título
function titleScore(queryTokens, title) {
  if (!title || queryTokens.length === 0) return 0;
  const titleTokens = new Set(tokenize(title));
  const hits = queryTokens.filter(t => titleTokens.has(t)).length;
  return hits / Math.max(1, queryTokens.length);
}

function metrics(rankedIds, expSet, k = 5) {
  const out = { p1: 0, p3: 0, p5: 0, r5: 0, r10: 0, mrr: 0 };
  for (let i = 0; i < Math.min(10, rankedIds.length); i++) {
    if (expSet.has(rankedIds[i])) {
      if (out.mrr === 0 && i < 10) out.mrr = 1 / (i + 1);
    }
  }
  const hits5 = rankedIds.slice(0, 5).filter(id => expSet.has(id));
  out.p5 = hits5.length / 5;
  out.r5 = hits5.length / Math.max(1, expSet.size);
  out.r10 = rankedIds.slice(0, 10).filter(id => expSet.has(id)).length / Math.max(1, expSet.size);
  out.p3 = rankedIds.slice(0, 3).filter(id => expSet.has(id)).length / 3;
  out.p1 = expSet.has(rankedIds[0]) ? 1 : 0;
  return { p1: +out.p1.toFixed(4), p3: +out.p3.toFixed(4), p5: +out.p5.toFixed(4), r5: +out.r5.toFixed(4), r10: +out.r10.toFixed(4), mrr: +out.mrr.toFixed(4) };
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
  const MISSES = ['cabello_002', 'cejas_004', 'cejas_008'];

  const perQuery = [];
  for (const q of queries) {
    const goldAll = [...q.expected_chunks.core, ...q.expected_chunks.supporting];
    const goldSet = new Set(goldAll);
    const queryTokens = tokenize(q.query);

    // ── Retrieval top-50 e5-v5 (pool natural, SIN insertar gold) ──
    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT chunk_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${POOL_K}`, ['[' + qEmb.join(',') + ']']);
    const pool = res.rows.map(r => ({
      chunk_id: r.chunk_id, title: r.title || '', content: r.content || '',
      vector_score: +r.sim.toFixed(4),
    }));

    // ── Candidate recall @10/@20/@50 (separar recall de ranking) ──
    const recall10 = pool.slice(0, 10).filter(r => goldSet.has(r.chunk_id)).length / Math.max(1, goldAll.length);
    const recall20 = pool.slice(0, 20).filter(r => goldSet.has(r.chunk_id)).length / Math.max(1, goldAll.length);
    const recall50 = pool.filter(r => goldSet.has(r.chunk_id)).length / Math.max(1, goldAll.length);
    const goldInPool = pool.some(r => goldSet.has(r.chunk_id));
    const goldRankOriginal = (() => { const i = pool.findIndex(r => goldSet.has(r.chunk_id)); return i === -1 ? -1 : i + 1; })();

    // ── ARM A: ranking original (por vector_score) ──
    const rankA = [...pool].sort((a, b) => b.vector_score - a.vector_score).map(r => r.chunk_id);
    const mA = metrics(rankA, goldSet);

    // ── ARM B: reranker híbrido (fórmula congelada, 3 configs del grid) ──
    // Normalizar vector dentro del pool (min-max)
    const vecScores = pool.map(r => r.vector_score);
    const vMin = Math.min(...vecScores), vMax = Math.max(...vecScores);
    const vRange = Math.max(1e-9, vMax - vMin);

    const cfgResults = {};
    for (const [cfgName, w] of Object.entries(GRID)) {
      const scored = pool.map(r => {
        const l = lexicalScore(queryTokens, r.content);
        const c = conceptScore(r.content);
        const t = titleScore(queryTokens, r.title);
        const vNorm = (r.vector_score - vMin) / vRange;
        const hybrid = w.w_v * vNorm + w.w_l * l + w.w_c * c + w.w_t * t;
        return { ...r, hybrid_score: +hybrid.toFixed(4) };
      });
      const rank = scored.sort((a, b) => b.hybrid_score - a.hybrid_score).map(r => r.chunk_id);
      const m = metrics(rank, goldSet);
      const goldRank = (() => { const i = rank.findIndex(id => goldSet.has(id)); return i === -1 ? -1 : i + 1; })();
      cfgResults[cfgName] = { metrics: m, gold_rank: goldRank, top10: rank.slice(0, 10) };
    }

    // ── Hard negatives: top-5 competidores (no-gold) del pool ──
    const hardNegatives = pool.filter(r => !goldSet.has(r.chunk_id)).slice(0, 5).map(r => ({
      chunk_id: r.chunk_id, vector_score: r.vector_score,
      title: (r.title || '').slice(0, 60),
    }));
    // Márgenes (mejor gold vs mejor negativo) — vector y CFG2
    const bestGoldVec = Math.max(...pool.filter(r => goldSet.has(r.chunk_id)).map(r => r.vector_score), -1);
    const bestNegVec = Math.max(...pool.filter(r => !goldSet.has(r.chunk_id)).map(r => r.vector_score), -1);
    const marginVector = +(bestGoldVec - bestNegVec).toFixed(4);

    const goldRanksByCfg = Object.fromEntries(Object.entries(cfgResults).map(([k, v]) => [k, v.gold_rank]));

    perQuery.push({
      query_id: q.query_id,
      support_status: q.support_status,
      was_miss: MISSES.includes(q.query_id),
      candidate_recall: { r10: +recall10.toFixed(4), r20: +recall20.toFixed(4), r50: +recall50.toFixed(4), gold_in_pool: goldInPool, gold_rank_original: goldRankOriginal },
      A: { metrics: mA, gold_rank: goldRankOriginal, top1: rankA[0] },
      B: {
        CFG1: cfgResults.CFG1, CFG2: cfgResults.CFG2, CFG3: cfgResults.CFG3,
      },
      hard_negatives: hardNegatives,
      margin_vector: marginVector,
      classification: !goldInPool ? 'CANDIDATE_POOL_MISS' : (cfgResults.CFG2.metrics.r5 > mA.r5 || (cfgResults.CFG2.gold_rank !== -1 && cfgResults.CFG2.gold_rank <= 5 && goldRankOriginal > 5)) ? 'RERANK_RECOVERED' : (cfgResults.CFG2.gold_rank < goldRankOriginal && goldRankOriginal !== -1) ? 'RERANK_IMPROVED_BUT_NOT_RECOVERED' : (cfgResults.CFG2.metrics.r5 < mA.r5) ? 'RERANK_HARMFUL' : 'UNCHANGED',
    });
    console.log(`✅ ${q.query_id}: recall@50=${recall50.toFixed(2)} goldRankA=${goldRankOriginal} → CFG2 goldRank=${cfgResults.CFG2.gold_rank} | A R@5=${mA.r5} CFG2 R@5=${cfgResults.CFG2.metrics.r5} [${perQuery.at(-1).classification}]`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── Agregados ──
  const agg = (fn, list) => {
    const vals = list.map(fn); const n = vals.length;
    return { p1: +(vals.reduce((a, v) => a + v.p1, 0) / n).toFixed(4), p3: +(vals.reduce((a, v) => a + v.p3, 0) / n).toFixed(4), p5: +(vals.reduce((a, v) => a + v.p5, 0) / n).toFixed(4), r5: +(vals.reduce((a, v) => a + v.r5, 0) / n).toFixed(4), r10: +(vals.reduce((a, v) => a + v.r10, 0) / n).toFixed(4), mrr: +(vals.reduce((a, v) => a + v.mrr, 0) / n).toFixed(4) };
  };
  const all = perQuery;
  const recallAgg = (fn, list) => { const vals = list.map(fn); return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4); };

  const out = {
    cycle: '32', experiment: 'R5-C20', run,
    database: 'LOCAL_ONLY', production_contacted: false,
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    config: { pool_k: POOL_K, topk: TOPK, motor: 'PRODUCTIVO sin modificar' },
    baseline_r5c: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    reranker: {
      formula: 'hybrid = w_v * norm(vector) + w_l * lexical + w_c * concept + w_t * title',
      grid: GRID,
      note: 'Pesos PRE-REGISTRADOS antes de evaluar. Sin tuning post-hoc. Sin reglas por query. Señales deterministas sin LLM.',
      concepts_list_size: CONCEPTS.length,
    },
    candidate_recall_global: {
      r10: recallAgg(q => q.candidate_recall.r10, all),
      r20: recallAgg(q => q.candidate_recall.r20, all),
      r50: recallAgg(q => q.candidate_recall.r50, all),
      gold_in_pool: all.filter(q => q.candidate_recall.gold_in_pool).length + '/' + all.length,
      outside_pool: all.filter(q => !q.candidate_recall.gold_in_pool).map(q => q.query_id),
    },
    metrics: {
      A: agg(q => q.A.metrics, all),
      B_CFG1: agg(q => q.B.CFG1.metrics, all),
      B_CFG2: agg(q => q.B.CFG2.metrics, all),
      B_CFG3: agg(q => q.B.CFG3.metrics, all),
    },
    misses_analysis: perQuery.filter(q => q.was_miss).map(q => ({
      query_id: q.query_id,
      gold_in_pool: q.candidate_recall.gold_in_pool,
      gold_rank_A: q.candidate_recall.gold_rank_original,
      gold_rank_cfg2: q.B.CFG2.gold_rank,
      recall50: q.candidate_recall.r50,
      classification: q.classification,
    })),
    classification_summary: (() => {
      const c = {};
      for (const q of all) c[q.classification] = (c[q.classification] || 0) + 1;
      return c;
    })(),
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c20_hybrid_reranking_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  Recall@50 global: ${out.candidate_recall_global.r50}`);
  console.log(`  A R@5=${out.metrics.A.r5} MRR=${out.metrics.A.mrr} → CFG2 R@5=${out.metrics.B_CFG2.r5} MRR=${out.metrics.B_CFG2.mrr}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
