/**
 * R6-C10 Corpus Expansion + Embedding Model Evaluation
 * Experimental: Corpus forensics + micro-benchmark NVIDIA e5-v5 vs mxbai-embed-large
 * Read-only, no modifications to production
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const MAX_EMBED_CHARS = 1400;
const K = 200;
const RRF_K = 60;
const POOL_K = 50;

// Ollama config
const OLLAMA_URL = 'http://localhost:11434/api/embed';
const OLLAMA_MODEL = 'mxbai-embed-large'; // 1024d — same dim as production

// NVIDIA config
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/embeddings';
const NVIDIA_EMBEDDING_MODEL = process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5';

const CRITICAL_QUERIES = ['cabello_002', 'cejas_004', 'cejas_008'];

async function main() {
  const args = process.argv.slice(2);
  const run = args.find(a => a.startsWith('--run='))?.split('=')[1] || 'A';

  console.log('=== R6-C10 CORPUS EXPANSION + EMBEDDING MODEL EVALUATION ===');
  console.log('Run:', run);

  // === ENV GUARD ===
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 PRODUCTION DETECTED - ABORT');
    process.exit(1);
  }
  console.log('✅ ENV GUARD: PASS (local)');

  // === DB POOL ===
  const ragPool = new Pool({ connectionString: process.env.DATABASE_URL, idleTimeoutMillis: 10000 });

  // === BD INTEGRITY CHECK ===
  const integrity = await ragPool.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE embedding IS NULL) AS nulls,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS nonnulls
    FROM beauty_knowledge_embeddings
  `);
  const idxCheck = await ragPool.query("SELECT indexname FROM pg_indexes WHERE tablename='beauty_knowledge_embeddings' AND indexname LIKE '%hnsw%'");
  const integrityData = integrity.rows[0];
  console.log('BD INTEGRITY:', JSON.stringify(integrityData));
  console.log('HNSW INDEX:', idxCheck.rows.map(r => r.indexname).join(', '));

  if (parseInt(integrityData.nulls) > 0) {
    console.error('🚫 DATABASE-INTEGRITY-FAIL: NULL embeddings > 0');
    process.exit(1);
  }
  if (idxCheck.rows.length === 0) {
    console.error('🚫 DATABASE-INTEGRITY-FAIL: HNSW index not found');
    process.exit(1);
  }

  // === LOAD GOLD-V5 ===
  const goldPath = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
  const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
  const supportedQueries = gold.queries.filter(q => q.support_status !== 'UNSUPPORTED');
  const allQueries = gold.queries;
  console.log('GOLD-V5 total queries:', allQueries.length);
  console.log('SUPPORTED queries:', supportedQueries.length);
  console.log('UNSUPPORTED queries:', allQueries.length - supportedQueries.length);

  // Build expected_ids map
  const expectedIdsMap = {};
  const queryCategories = {};
  const queryTexts = {};
  for (const q of allQueries) {
    const core = q.expected_chunks?.core || [];
    const supporting = q.expected_chunks?.supporting || [];
    expectedIdsMap[q.query_id] = [...core, ...supporting];
    queryCategories[q.query_id] = q.category || q.domain || '';
    queryTexts[q.query_id] = q.query;
  }

  // === EMBEDDING FUNCTIONS ===
  async function generateNVIDIAEmbedding(text) {
    const embeddingText = text.length > MAX_EMBED_CHARS ? text.substring(0, MAX_EMBED_CHARS) : text;
    const response = await fetch(NVIDIA_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + NVIDIA_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: NVIDIA_EMBEDDING_MODEL,
        input: [embeddingText],
        input_type: 'query',
        encoding_format: 'float',
      }),
    });
    if (!response.ok) throw new Error('NVIDIA API error: ' + response.status);
    const data = await response.json();
    return data.data[0].embedding;
  }

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

  // Normalize embeddings to unit vectors
  function normalizeEmbedding(e) {
    if (!e) return null;
    const norm = Math.sqrt(e.reduce((a, b) => a + b * b, 0));
    return norm > 0 ? e.map(v => v / norm) : e;
  }

  // Cosine similarity
  function cosine(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }

  // === VECTOR RETRIEVAL ===
  async function retrieveVector(query, pool = null, k = K) {
    const emb = await generateNVIDIAEmbedding(query);
    const vecStr = '[' + emb.join(',') + ']';
    let queryStr = `
      SELECT chunk_id, title, content, category, metadata,
             1 - (embedding <=> $1::halfvec) AS similarity
      FROM beauty_knowledge_embeddings
    `;
    const params = [vecStr];
    if (pool && pool.length > 0) {
      queryStr += ' WHERE chunk_id = ANY($2::text[])';
      params.push(pool);
    }
    queryStr += ' ORDER BY embedding <=> $1::halfvec LIMIT $' + (params.length + 1);
    params.push(k);
    const res = await ragPool.query(queryStr, params);
    return res.rows.map((r, i) => ({
      chunk_id: r.chunk_id,
      title: r.title,
      content: r.content,
      category: r.category,
      metadata: r.metadata,
      similarity: parseFloat(r.similarity),
      vector_rank: i + 1,
      vector_score: parseFloat(r.similarity)
    }));
  }

  // === FTS RETRIEVAL ===
  async function retrieveFTS(query, k = K) {
    const res = await ragPool.query(
      `SELECT chunk_id, title, content, category, metadata,
              ts_rank_cd(to_tsvector('spanish', title || ' ' || content), plainto_tsquery('spanish', $1)) AS fts_score
       FROM beauty_knowledge_embeddings
       WHERE to_tsvector('spanish', title || ' ' || content) @@ plainto_tsquery('spanish', $1)
       ORDER BY fts_score DESC
       LIMIT $2`,
      [query, k]
    );
    return res.rows.map((r, i) => ({
      chunk_id: r.chunk_id,
      title: r.title,
      content: r.content,
      category: r.category,
      metadata: r.metadata,
      fts_score: parseFloat(r.fts_score),
      fts_rank: i + 1
    }));
  }

  // === HYBRID RRF ===
  function combineRRF(vectorResults, ftsResults, k = RRF_K) {
    const scores = new Map();
    for (const r of vectorResults) {
      if (!scores.has(r.chunk_id)) {
        scores.set(r.chunk_id, { ...r, fts_rank: null, fts_score: null, source: 'VECTOR' });
      }
      const entry = scores.get(r.chunk_id);
      entry.vector_rank = r.vector_rank;
      entry.vector_score = r.vector_score;
      entry.source = entry.source === 'FTS' ? 'BOTH' : 'VECTOR';
    }
    for (const r of ftsResults) {
      if (!scores.has(r.chunk_id)) {
        scores.set(r.chunk_id, { ...r, vector_rank: null, vector_score: null, source: 'FTS' });
      } else {
        const entry = scores.get(r.chunk_id);
        entry.fts_rank = r.fts_rank;
        entry.fts_score = r.fts_score;
        entry.source = entry.source === 'VECTOR' ? 'BOTH' : 'FTS';
      }
    }
    for (const entry of scores.values()) {
      let rrfScore = 0;
      if (entry.vector_rank) rrfScore += 1 / (k + entry.vector_rank);
      if (entry.fts_rank) rrfScore += 1 / (k + entry.fts_rank);
      entry.hybrid_score = rrfScore;
    }
    return Array.from(scores.values()).sort((a, b) => b.hybrid_score - a.hybrid_score)
      .map((r, i) => ({ ...r, hybrid_rank: i + 1 }));
  }

  // === EVALUATION HELPERS ===
  function computeMetrics(expectedIds, results, k) {
    const topK = results.slice(0, k).map(r => r.chunk_id);
    let hit = false;
    let firstHitRank = -1;
    let goldCount = 0;
    for (let i = 0; i < topK.length; i++) {
      if (expectedIds.includes(topK[i])) {
        hit = true;
        if (firstHitRank === -1) firstHitRank = i + 1;
        goldCount++;
      }
    }
    return { hit, first_hit_rank: firstHitRank >= 0 ? firstHitRank : null, gold_count: goldCount };
  }

  function computeMRR(expectedIds, results) {
    for (let i = 0; i < results.length; i++) {
      if (expectedIds.includes(results[i].chunk_id)) {
        return 1 / (i + 1);
      }
    }
    return 0;
  }

  // ============================================
  // PHASE 1: CORPUS FORENSICS
  // ============================================
  console.log('\n=== PHASE 1: CORPUS FORENSICS ===');
  const corpusForensics = {};

  for (const q of supportedQueries) {
    const queryId = q.query_id;
    const expectedIds = expectedIdsMap[queryId] || [];
    const queryText = queryTexts[queryId];

    const forensicsEntry = {
      query_id: queryId,
      query: queryText,
      category: queryCategories[queryId],
      gold_chunks: []
    };

    for (const goldId of expectedIds) {
      // Check if chunk exists in BD
      const res = await ragPool.query(
        'SELECT chunk_id, title, content, category, metadata, embedding IS NOT NULL AS has_embedding FROM beauty_knowledge_embeddings WHERE chunk_id = $1',
        [goldId]
      );

      if (res.rows.length === 0) {
        forensicsEntry.gold_chunks.push({
          chunk_id: goldId,
          status: 'CORPUS_ABSENT',
          exists: false,
          has_embedding: false,
          in_top_200: false,
          in_top_50: false,
          fts_rank: null
        });
        continue;
      }

      const row = res.rows[0];

      // Check vector rank in full corpus (top-200)
      const vectorRes = await retrieveVector(queryText, null, 200);
      const inTop200 = vectorRes.find(r => r.chunk_id === goldId);
      const inTop50 = vectorRes.find(r => r.chunk_id === goldId && r.vector_rank <= 50);

      // Check FTS
      const ftsRes = await retrieveFTS(queryText, 200);
      const ftsHit = ftsRes.find(r => r.chunk_id === goldId);

      let status = 'CORPUS_PRESENT_AND_RETRIEVABLE';
      if (inTop50) status = 'CORPUS_PRESENT_AND_RETRIEVABLE';
      else if (inTop200) status = 'CORPUS_PRESENT_VECTOR_MISS_TOP50';
      else if (ftsHit) status = 'CORPUS_PRESENT_LEXICAL_MISS';
      else status = 'CORPUS_PRESENT_VECTOR_MISS';

      forensicsEntry.gold_chunks.push({
        chunk_id: goldId,
        status,
        exists: true,
        has_embedding: row.has_embedding,
        title: row.title,
        category: row.category,
        in_top_200: !!inTop200,
        vector_rank: inTop200 ? inTop200.vector_rank : null,
        vector_score: inTop200 ? inTop200.vector_score : null,
        in_top_50: !!inTop50,
        fts_rank: ftsHit ? ftsHit.fts_rank : null,
        fts_score: ftsHit ? ftsHit.fts_score : null
      });
    }

    corpusForensics[queryId] = forensicsEntry;
  }

  // ============================================
  // PHASE 2: VECTOR MISS MAP
  // ============================================
  console.log('\n=== PHASE 2: VECTOR MISS MAP ===');
  const vectorMissMap = {};

  for (const q of supportedQueries) {
    const queryId = q.query_id;
    const expectedIds = expectedIdsMap[queryId] || [];
    const queryText = queryTexts[queryId];

    const vectorRes = await retrieveVector(queryText, null, 200);
    const ftsRes = await retrieveFTS(queryText, 200);
    const hybridRes = combineRRF(vectorRes, ftsRes);

    const goldInVector = vectorRes.filter(r => expectedIds.includes(r.chunk_id));
    const goldInFTS = ftsRes.filter(r => expectedIds.includes(r.chunk_id));
    const goldInHybrid = hybridRes.filter(r => expectedIds.includes(r.chunk_id));

    const vectorMiss = expectedIds.filter(id => !vectorRes.find(r => r.chunk_id === id));
    const ftsMiss = expectedIds.filter(id => !ftsRes.find(r => r.chunk_id === id));
    const hybridMiss = expectedIds.filter(id => !hybridRes.find(r => r.chunk_id === id));

    vectorMissMap[queryId] = {
      query_id: queryId,
      query: queryText,
      category: queryCategories[queryId],
      gold_total: expectedIds.length,
      gold_in_vector: goldInVector.length,
      gold_in_fts: goldInFTS.length,
      gold_in_hybrid: goldInHybrid.length,
      vector_miss_count: vectorMiss.length,
      vector_miss_ids: vectorMiss,
      vector_miss_details: vectorMiss.map(id => {
        const goldChunk = corpusForensics[queryId]?.gold_chunks?.find(g => g.chunk_id === id);
        return {
          chunk_id: id,
          title: goldChunk?.title,
          status: goldChunk?.status,
          has_embedding: goldChunk?.has_embedding
        };
      }),
      fts_miss_count: ftsMiss.length,
      hybrid_miss_count: hybridMiss.length
    };
  }

  // ============================================
  // PHASE 3: MICRO-BENCHMARK - NVIDIA vs MXBAI
  // ============================================
  console.log('\n=== PHASE 3: MICRO-BENCHMARK ===');

  // Build candidate pool (top-50 NVIDIA + golds) per query
  const poolPerQuery = {};
  const allPoolIds = new Set();
  for (const q of supportedQueries) {
    const queryId = q.query_id;
    const goldAll = expectedIdsMap[queryId] || [];
    const vectorRes = await retrieveVector(queryTexts[queryId], null, POOL_K);
    const poolIds = vectorRes.map(r => r.chunk_id);
    for (const g of goldAll) if (!poolIds.includes(g)) poolIds.push(g);
    poolPerQuery[queryId] = poolIds;
    poolIds.forEach(id => allPoolIds.add(id));
  }
  const poolIds = [...allPoolIds];
  console.log(`  Candidate pool: ${poolIds.length} unique chunks`);

  // Get content for pool
  const cRes = await ragPool.query(
    'SELECT chunk_id, content FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [poolIds]
  );
  const contentMap = new Map(cRes.rows.map(r => [r.chunk_id, r.content]));

  // Generate NVIDIA embeddings for pool (query side only needed, but we need doc embeddings for mxbai)
  // Actually for mxbai we generate doc embeddings, for NVIDIA we use DB embeddings
  console.log(`  Generating mxbai embeddings for ${poolIds.length} chunks...`);
  const embMxbai = new Map();
  const BATCH = 16;
  for (let i = 0; i < poolIds.length; i += BATCH) {
    const batch = poolIds.slice(i, i + BATCH);
    const texts = batch.map(id => contentMap.get(id) || '');
    try {
      const embs = await ollamaEmbed(texts);
      batch.forEach((id, j) => embMxbai.set(id, normalizeEmbedding(embs[j])));
    } catch (err) {
      console.error(`  Batch error: ${err.message}`);
      for (const id of batch) embMxbai.set(id, null);
    }
    await new Promise(r => setTimeout(r, 100));
  }
  const embMxbaiCount = [...embMxbai.values()].filter(Boolean).length;
  console.log(`  ✅ ${embMxbaiCount}/${poolIds.length} mxbai embeddings`);

  // Run micro-benchmark
  const microbenchmark = {};
  for (const q of supportedQueries) {
    const queryId = q.query_id;
    const expectedIds = expectedIdsMap[queryId] || [];
    const queryText = queryTexts[queryId];
    const goldSet = new Set(expectedIds);
    const poolIdsQ = poolPerQuery[queryId];

    // ARM A: NVIDIA query + NVIDIA doc embeddings (from DB)
    const qEmbNVIDIA = await generateNVIDIAEmbedding(queryText);
    const nvidiaVecStr = '[' + qEmbNVIDIA.join(',') + ']';
    const aRes = await ragPool.query(
      `SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($2::text[])`, [nvidiaVecStr, poolIdsQ]);
    const aScores = new Map(aRes.rows.map(r => [r.chunk_id, +r.sim.toFixed(4)]));

    // ARM B: mxbai query + mxbai doc embeddings (cosine)
    const [qEmbMxbai] = await ollamaEmbed([queryText]);
    const qB = normalizeEmbedding(qEmbMxbai);
    const bScores = new Map();
    for (const cid of poolIdsQ) {
      const eB = embMxbai.get(cid);
      if (!eB) { bScores.set(cid, 0); continue; }
      bScores.set(cid, +cosine(qB, eB).toFixed(4));
    }

    // Rank and compute metrics
    const rankA = [...aScores.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
    const rankB = [...bScores.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);

    const metrics = (ranked) => {
      const out = { p1: 0, p3: 0, p5: 0, r5: 0, r10: 0, r20: 0, r50: 0, mrr: 0 };
      let firstHit = true;
      for (let i = 0; i < ranked.length; i++) {
        if (goldSet.has(ranked[i])) {
          if (firstHit) { out.mrr = 1 / (i + 1); firstHit = false; }
        }
      }
      const hits5 = ranked.slice(0, 5).filter(id => goldSet.has(id)).length;
      out.p5 = +(hits5 / 5).toFixed(4);
      out.r5 = +(hits5 / Math.max(1, goldSet.size)).toFixed(4);
      const hits10 = ranked.slice(0, 10).filter(id => goldSet.has(id)).length;
      out.r10 = +(hits10 / Math.max(1, goldSet.size)).toFixed(4);
      const hits20 = ranked.slice(0, 20).filter(id => goldSet.has(id)).length;
      out.r20 = +(hits20 / Math.max(1, goldSet.size)).toFixed(4);
      const hits50 = ranked.slice(0, 50).filter(id => goldSet.has(id)).length;
      out.r50 = +(hits50 / Math.max(1, goldSet.size)).toFixed(4);
      out.p3 = +(ranked.slice(0, 3).filter(id => goldSet.has(id)).length / 3).toFixed(4);
      out.p1 = goldSet.has(ranked[0]) ? 1 : 0;
      return out;
    };

    microbenchmark[queryId] = {
      query_id: queryId,
      query: queryText,
      gold_total: expectedIds.length,
      nvidia: { ...metrics(rankA), ranked: rankA, scores: Object.fromEntries(aScores) },
      mxbai: { ...metrics(rankB), ranked: rankB, scores: Object.fromEntries(bScores) }
    };

    await new Promise(r => setTimeout(r, 50));
  }

  // ============================================
  // PHASE 4: VIRTUAL CORPUS EXPERIMENT
  // ============================================
  console.log('\n=== PHASE 4: VIRTUAL CORPUS EXPERIMENT ===');
  const virtualCorpus = {};

  for (const q of supportedQueries) {
    const queryId = q.query_id;
    const forensics = corpusForensics[queryId];
    const absent = forensics.gold_chunks.filter(g => g.status === 'CORPUS_ABSENT');
    const vectorMiss = forensics.gold_chunks.filter(g => g.status === 'CORPUS_PRESENT_VECTOR_MISS' || g.status === 'CORPUS_PRESENT_VECTOR_MISS_TOP50');
    const lexicalMiss = forensics.gold_chunks.filter(g => g.status === 'CORPUS_PRESENT_LEXICAL_MISS');

    virtualCorpus[queryId] = {
      query_id: queryId,
      absent_count: absent.length,
      vector_miss_count: vectorMiss.length,
      lexical_miss_count: lexicalMiss.length,
      retrievable_count: forensics.gold_chunks.filter(g => g.status === 'CORPUS_PRESENT_AND_RETRIEVABLE').length,
      recommendation: absent.length > 0 ? 'CORPUS_EXPANSION_NEEDED' : vectorMiss.length > 0 ? 'EMBEDDING_IMPROVEMENT_NEEDED' : 'OK'
    };
  }

  // ============================================
  // PHASE 5: CAUSAL ANALYSIS
  // ============================================
  console.log('\n=== PHASE 5: CAUSAL ANALYSIS ===');
  const causalMatrix = {};
  for (const q of supportedQueries) {
    const queryId = q.query_id;
    const fm = corpusForensics[queryId];
    const vm = vectorMissMap[queryId];
    const mb = microbenchmark[queryId];

    causalMatrix[queryId] = {
      query_id: queryId,
      gold_total: fm.gold_chunks.length,
      corpus_present_and_retrievable: fm.gold_chunks.filter(g => g.status === 'CORPUS_PRESENT_AND_RETRIEVABLE').length,
      corpus_present_vector_miss: fm.gold_chunks.filter(g => g.status === 'CORPUS_PRESENT_VECTOR_MISS').length,
      corpus_present_vector_miss_top50: fm.gold_chunks.filter(g => g.status === 'CORPUS_PRESENT_VECTOR_MISS_TOP50').length,
      corpus_present_lexical_miss: fm.gold_chunks.filter(g => g.status === 'CORPUS_PRESENT_LEXICAL_MISS').length,
      corpus_absent: fm.gold_chunks.filter(g => g.status === 'CORPUS_ABSENT').length,
      vector_miss_count: vm.vector_miss_count,
      fts_miss_count: vm.fts_miss_count,
      hybrid_miss_count: vm.hybrid_miss_count,
      nvidia_r50: mb.nvidia.r50,
      mxbai_r50: mb.mxbai.r50,
      nvidia_mrr: mb.nvidia.mrr,
      mxbai_mrr: mb.mxbai.mrr,
      r50_delta: +(mb.mxbai.r50 - mb.nvidia.r50).toFixed(4),
      mrr_delta: +(mb.mxbai.mrr - mb.nvidia.mrr).toFixed(4),
      classification: (() => {
        if (fm.gold_chunks.filter(g => g.status === 'CORPUS_ABSENT').length > 0) return 'CORPUS_GAP';
        if (fm.gold_chunks.filter(g => g.status === 'CORPUS_PRESENT_VECTOR_MISS' || g.status === 'CORPUS_PRESENT_VECTOR_MISS_TOP50').length > 0) {
          if (mb.mxbai.r50 > mb.nvidia.r50) return 'EMBEDDING_LIMITATION';
          return 'EMBEDDING_LIMITATION';
        }
        return 'OK';
      })()
    };
  }

  // ============================================
  // AGGREGATE METRICS
  // ============================================
  function aggregateMicrobenchmark(model) {
    const queries = supportedQueries.length;
    const mrrSum = supportedQueries.reduce((sum, q) => sum + microbenchmark[q.query_id][model].mrr, 0);
    const r5Sum = supportedQueries.reduce((sum, q) => sum + microbenchmark[q.query_id][model].r5, 0);
    const r10Sum = supportedQueries.reduce((sum, q) => sum + microbenchmark[q.query_id][model].r10, 0);
    const r20Sum = supportedQueries.reduce((sum, q) => sum + microbenchmark[q.query_id][model].r20, 0);
    const r50Sum = supportedQueries.reduce((sum, q) => sum + microbenchmark[q.query_id][model].r50, 0);
    return {
      mrr: +(mrrSum / queries).toFixed(4),
      r5: +(r5Sum / queries).toFixed(4),
      r10: +(r10Sum / queries).toFixed(4),
      r20: +(r20Sum / queries).toFixed(4),
      r50: +(r50Sum / queries).toFixed(4),
      queries
    };
  }

  const aggNVIDIA = aggregateMicrobenchmark('nvidia');
  const aggMxbai = aggregateMicrobenchmark('mxbai');

  // ============================================
  // DECISION
  // ============================================
  console.log('\n=== DECISION ANALYSIS ===');
  const decision = {
    r6c10_verdict: '',
    corpus_gap_confirmed: false,
    embedding_limitation_confirmed: false,
    mxbai_improves_over_nvidia: false,
    mxbai_improvement_significant: false,
    recommendations: [],
    next_cycle: ''
  };

  // Check corpus gap
  let totalCorpusAbsent = 0;
  let totalVectorMiss = 0;
  for (const q of supportedQueries) {
    const fm = corpusForensics[q.query_id];
    totalCorpusAbsent += fm.gold_chunks.filter(g => g.status === 'CORPUS_ABSENT').length;
    totalVectorMiss += fm.gold_chunks.filter(g => g.status === 'CORPUS_PRESENT_VECTOR_MISS' || g.status === 'CORPUS_PRESENT_VECTOR_MISS_TOP50').length;
  }

  decision.corpus_gap_confirmed = totalCorpusAbsent > 0;
  decision.embedding_limitation_confirmed = totalVectorMiss > 0;

  // Check if mxbai improves
  const mrrDelta = aggMxbai.mrr - aggNVIDIA.mrr;
  const r50Delta = aggMxbai.r50 - aggNVIDIA.r50;
  decision.mxbai_improves_over_nvidia = mrrDelta > 0 || r50Delta > 0;
  decision.mxbai_improvement_significant = mrrDelta > 0.02 || r50Delta > 0.05;

  // Determine verdict
  if (decision.corpus_gap_confirmed && !decision.mxbai_improves_over_nvidia) {
    decision.r6c10_verdict = 'CORPUS_EXPANSION_PRIMARY';
  } else if (!decision.corpus_gap_confirmed && decision.embedding_limitation_confirmed && decision.mxbai_improves_over_nvidia) {
    decision.r6c10_verdict = 'EMBEDDING_MODEL_CHANGE_PRIMARY';
  } else if (decision.corpus_gap_confirmed && decision.embedding_limitation_confirmed && decision.mxbai_improves_over_nvidia) {
    decision.r6c10_verdict = 'MULTI_FACTOR_BOTH_NEEDED';
  } else if (!decision.corpus_gap_confirmed && decision.embedding_limitation_confirmed && !decision.mxbai_improves_over_nvidia) {
    decision.r6c10_verdict = 'EMBEDDING_LIMITATION_NO_BETTER_MODEL';
  } else {
    decision.r6c10_verdict = 'INCONCLUSIVE';
  }

  // Recommendations
  if (decision.corpus_gap_confirmed) {
    decision.recommendations.push('CORPUS_EXPANSION: Add missing GOLD chunks identified in forensics');
  }
  if (decision.mxbai_improves_over_nvidia) {
    decision.recommendations.push('EMBEDDING_MODEL_CHANGE: mxbai-embed-large shows improvement; evaluate full re-ingestion');
  } else if (decision.embedding_limitation_confirmed) {
    decision.recommendations.push('EMBEDDING_INVESTIGATION: mxbai does not improve; need better model or fine-tuning');
  }

  decision.next_cycle = decision.r6c10_verdict === 'CORPUS_EXPANSION_PRIMARY' ? 'R6-C11: Corpus Expansion' :
                        decision.r6c10_verdict === 'EMBEDDING_MODEL_CHANGE_PRIMARY' ? 'R6-C11: Embedding Model Migration' :
                        decision.r6c10_verdict === 'MULTI_FACTOR_BOTH_NEEDED' ? 'R6-C11: Combined Corpus + Embedding' :
                        'R6-C11: Alternative Strategy';

  // ============================================
  // FINAL REPORTS
  // ============================================
  const corpusForensicsReport = {
    cycle: 'R6-C10',
    run,
    timestamp: new Date().toISOString(),
    name: 'CORPUS_FORENSICS',
    database_integrity: {
      total: parseInt(integrityData.total),
      nulls: parseInt(integrityData.nulls),
      nonnulls: parseInt(integrityData.nonnulls),
      hnsw_operational: idxCheck.rows.length > 0,
      status: 'PASS'
    },
    dataset: {
      total_queries: allQueries.length,
      supported_queries: supportedQueries.length,
      unsupported_queries: allQueries.length - supportedQueries.length,
      supported_query_ids: supportedQueries.map(q => q.query_id)
    },
    corpus_forensics: corpusForensics,
    summary: {
      total_gold_chunks: supportedQueries.reduce((sum, q) => sum + corpusForensics[q.query_id].gold_chunks.length, 0),
      corpus_absent: totalCorpusAbsent,
      corpus_present_vector_miss: totalVectorMiss,
      corpus_present_lexical_miss: supportedQueries.reduce((sum, q) => sum + corpusForensics[q.query_id].gold_chunks.filter(g => g.status === 'CORPUS_PRESENT_LEXICAL_MISS').length, 0),
      corpus_present_and_retrievable: supportedQueries.reduce((sum, q) => sum + corpusForensics[q.query_id].gold_chunks.filter(g => g.status === 'CORPUS_PRESENT_AND_RETRIEVABLE').length, 0)
    },
    production_guards: { env_guard: 'PASS', read_only: true, no_railway: true, no_production_modification: true }
  };

  const microbenchmarkReport = {
    cycle: 'R6-C10',
    run,
    timestamp: new Date().toISOString(),
    name: 'EMBEDDING_MODEL_MICROBENCHMARK',
    models: {
      nvidia: { model: NVIDIA_EMBEDDING_MODEL, provider: 'NVIDIA API', dims: 1024 },
      mxbai: { model: OLLAMA_MODEL, provider: 'Ollama Local', dims: 1024 }
    },
    candidate_pool: {
      total_chunks: poolIds.length,
      pool_k: POOL_K,
      selection: 'top-50 NVIDIA + golds per query'
    },
    aggregate: {
      nvidia: aggNVIDIA,
      mxbai: aggMxbai,
      delta: {
        mrr: +(aggMxbai.mrr - aggNVIDIA.mrr).toFixed(4),
        r5: +(aggMxbai.r5 - aggNVIDIA.r5).toFixed(4),
        r10: +(aggMxbai.r10 - aggNVIDIA.r10).toFixed(4),
        r20: +(aggMxbai.r20 - aggNVIDIA.r20).toFixed(4),
        r50: +(aggMxbai.r50 - aggNVIDIA.r50).toFixed(4)
      }
    },
    per_query: microbenchmark,
    production_guards: { env_guard: 'PASS', read_only: true, no_railway: true, no_embedding_write: true, no_production_modification: true }
  };

  const causalDecisionReport = {
    cycle: 'R6-C10',
    run,
    timestamp: new Date().toISOString(),
    name: 'CAUSAL_DECISION',
    causal_matrix: causalMatrix,
    vector_miss_map: vectorMissMap,
    virtual_corpus: virtualCorpus,
    decision,
    production_guards: { env_guard: 'PASS', read_only: true, no_railway: true, no_production_modification: true }
  };

  // Write artifacts
  const forensicsPath = path.join(OUT_DIR, `r6c10_corpus_forensics_${run.toLowerCase()}.json`);
  const microPath = path.join(OUT_DIR, `r6c10_embedding_model_evaluation_${run.toLowerCase()}.json`);
  const causalPath = path.join(OUT_DIR, `r6c10_causal_decision_${run.toLowerCase()}.json`);

  fs.writeFileSync(forensicsPath, JSON.stringify(corpusForensicsReport, null, 2));
  fs.writeFileSync(microPath, JSON.stringify(microbenchmarkReport, null, 2));
  fs.writeFileSync(causalPath, JSON.stringify(causalDecisionReport, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log('Corpus Forensics:', forensicsPath);
  console.log('Micro-benchmark:', microPath);
  console.log('Causal Decision:', causalPath);
  console.log('NVIDIA agg:', JSON.stringify(aggNVIDIA));
  console.log('MXBAI agg:', JSON.stringify(aggMxbai));
  console.log('Decision:', decision.r6c10_verdict);
  console.log('Corpus gap:', decision.corpus_gap_confirmed);
  console.log('Embedding limitation:', decision.embedding_limitation_confirmed);
  console.log('MXBAI improves:', decision.mxbai_improves_over_nvidia, '(significant:', decision.mxbai_improvement_significant + ')');

  await ragPool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });