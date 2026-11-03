#!/usr/bin/env node
/**
 * backend/scripts/r5c3RerankingExperiment.js
 * CICLO 15 — R5-C3: Experimento controlado de RERANKING (read-only)
 *
 * Pipeline experimental (NO toca ragService ni producción):
 *   QUERY → VECTOR RETRIEVAL (top-20, SQL read-only) → HEURISTIC RERANKER → RERANKED
 *
 * RERANKER: determinista, SIN leakage de ground truth.
 *   score = α·similarity_vectorial + β·overlap_léxico(query_terms, título/contenido)
 *   Los expected_chunks se usan SOLO para evaluar después, nunca para ordenar.
 *
 * Regla crítica: set(candidatos originales) == set(candidatos rerankeados).
 * Solo cambia el ORDEN.
 *
 * Uso: node scripts/r5c3RerankingExperiment.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const DS = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

// Stopwords español para extracción de términos
const STOPWORDS = new Set(('de la el en y a los del se las por un para con no una su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te ti tu tus ellas nosotras vosotros vosotras os mío mía míos mías tuyo tuya tuyos tuyas suyo suya suyos suyas nuestro nuestra nuestros nuestras vuestro vuestra vuestros vuestras esos esas esos esas qué quién quiénes cuál cuáles cómo cuándo dónde para qué').split(/\s+/));

const STOPWORDS_EXTRA = new Set(['mejor','cómo','qué','cuál','cuáles','puedo','puede','debería','correctamente','ideal','usar','tratamiento','rutina','casero','profesional','real','realmente','vs','versus','entre','misma','mismo','hacer','hacerse']);

function extractTerms(query) {
  return query
    .toLowerCase()
    .replace(/[¿?¡!.,:;()"'«»]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w) && !STOPWORDS_EXTRA.has(w));
}

function lexicalOverlap(queryTerms, chunk) {
  if (!queryTerms.length) return 0;
  const title = (chunk.title || '').toLowerCase();
  const content = (chunk.content || '').toLowerCase().substring(0, 1500);
  let hits = 0;
  for (const t of queryTerms) {
    if (title.includes(t) || content.includes(t)) hits++;
  }
  return hits / queryTerms.length;
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

async function main() {
  const args = process.argv.slice(2);
  const runArg = args.find(a => a.startsWith('--run='));
  const run = runArg ? runArg.split('=')[1] : 'A';

  // ── Seguridad anti-producción ──
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  const isLocal = ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0');
  if (!isLocal) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO.');
    process.exit(1);
  }

  const ds = JSON.parse(fs.readFileSync(DS, 'utf8'));
  const valid = ds.queries.filter(q => q.status === 'VALID');
  const ALPHA = 0.7, BETA = 0.3; // pesos del reranker

  const perQuery = [];
  for (const q of valid) {
    const qEmb = await generateEmbedding(q.query, 'query');
    const qv = '[' + qEmb.join(',') + ']';
    const terms = extractTerms(q.query);

    // Candidatos top-20 (SQL read-only, topK 20 para estudio de profundidad)
    const cand = await ragPool.query(
      `SELECT id, chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT 20`, [qv]);
    const candidates = cand.rows.map((r, i) => ({
      rank_original: i + 1,
      chunk_id: r.chunk_id,
      document_id: r.document_id,
      title: r.title,
      content: r.content,
      similarity: parseFloat(r.sim.toFixed(6)),
    }));

    // RERANKER HEURÍSTICO (sin ground truth: solo query + chunk)
    const scored = candidates.map(c => ({
      ...c,
      lexical: lexicalOverlap(terms, c),
      rerank_score: ALPHA * c.similarity + BETA * lexicalOverlap(terms, c),
    }));
    scored.sort((a, b) => b.rerank_score - a.rerank_score);
    scored.forEach((c, i) => { c.rank_reranked = i + 1; });

    // Preservar el orden original para comparación
    candidates.sort((a, b) => a.rank_original - b.rank_original);

    // Evaluación (solo aquí se usa ground truth)
    const expected = q.expected_chunks;
    const orig5 = candidates.slice(0, 5).map(c => c.chunk_id);
    const rer5 = scored.slice(0, 5).map(c => c.chunk_id);
    const metrics = (ids5) => {
      const hits5 = ids5.filter(id => expected.includes(id));
      const p5 = hits5.length / 5;
      const r5 = hits5.length / Math.max(1, expected.length);
      // MRR sobre top-5
      let mrr = 0;
      for (let i = 0; i < ids5.length; i++) { if (expected.includes(ids5[i])) { mrr = 1/(i+1); break; } }
      return { p5: +p5.toFixed(4), r5: +r5.toFixed(4), mrr: +mrr.toFixed(4) };
    };
    const mBase = metrics(orig5);
    const mRer = metrics(rer5);

    // Oracle: mejor rank posible del expected dentro del candidate set
    const expRanks = scored.filter(c => expected.includes(c.chunk_id)).map(c => c.rank_original);
    const oracleBest = expRanks.length ? Math.min(...expRanks) : null;

    perQuery.push({
      query_id: q.id,
      query: q.query,
      category: q.category,
      expected_chunks: expected,
      terms: terms,
      candidate_count: scored.length,
      baseline: { ...mBase, top1: candidates[0]?.chunk_id, top1_sim: candidates[0]?.similarity },
      reranked: { ...mRer, top1: scored[0]?.chunk_id, top1_score: scored[0]?.rerank_score },
      expected_ranks_original: candidates.map((c,i)=>c.chunk_id).map((id,i)=>expected.includes(id)?i+1:null).filter(Boolean),
      expected_ranks_reranked: scored.map((c,i)=>c.chunk_id).map((id,i)=>expected.includes(id)?i+1:null).filter(Boolean),
      oracle_best_rank: oracleBest,
      evidence_in_top10: candidates.slice(0,10).some(c => expected.includes(c.chunk_id)),
      evidence_in_top20: candidates.some(c => expected.includes(c.chunk_id)),
      candidates: scored.map(c => ({ rank_original: c.rank_original, rank_reranked: c.rank_reranked, chunk_id: c.chunk_id, similarity: c.similarity, lexical: c.lexical, rerank_score: c.rerank_score })),
    });
    console.log(`✅ ${q.id}: orig P@5=${mBase.p5} R@5=${mBase.r5} MRR=${mBase.mrr} → rerank P@5=${mRer.p5} R@5=${mRer.r5} MRR=${mRer.mrr}`);
    await new Promise(r => setTimeout(r, 250));
  }

  // Agregados
  const agg = (key) => {
    const vals = perQuery.map(q => q[key]);
    return {
      p1: +(vals.filter(v=>v.mrr===1).length / perQuery.length).toFixed(4),
      p3: +(vals.map(v=>v.p3||0).reduce((a,b)=>a+b,0) / perQuery.length).toFixed(4),
      p5: +(vals.map(v=>v.p5).reduce((a,b)=>a+b,0) / perQuery.length).toFixed(4),
      r5: +(vals.map(v=>v.r5).reduce((a,b)=>a+b,0) / perQuery.length).toFixed(4),
      mrr: +(vals.map(v=>v.mrr).reduce((a,b)=>a+b,0) / perQuery.length).toFixed(4),
    };
  };

  const out = {
    run: run,
    generated_at: new Date().toISOString(),
    config: { topK: 20, alpha: ALPHA, beta: BETA, reranker: 'HEURISTIC_RERANKER (similarity·0.7 + lexical_overlap·0.3)', bd: 'LOCAL', model: 'nvidia/nv-embedqa-e5-v5' },
    global_baseline: agg('baseline'),
    global_reranked: agg('reranked'),
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c3_reranking_run_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
