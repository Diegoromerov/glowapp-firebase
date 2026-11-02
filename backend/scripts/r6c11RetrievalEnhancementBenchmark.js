/**
 * R6-C11 NVIDIA e5-v5 Retrieval Enhancement Benchmark
 * Experimental: Query expansion, multi-query, HyDE, dense+sparse, fusion, routing, reranking
 * Read-only, no modifications to production, NVIDIA e5-v5 remains official embedding
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const axios = require('axios');

const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const MAX_EMBED_CHARS = 1400;
const K = 200;
const RRF_K = 60;
const POOL_K = 50;

// NVIDIA config (OFFICIAL EMBEDDING - DO NOT CHANGE)
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/embeddings';
const NVIDIA_EMBEDDING_MODEL = process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5';

// Ollama config for LLM-based query expansion / HyDE (local, no cost)
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'llama3.2';

const CRITICAL_QUERIES = ['cabello_002', 'cejas_004', 'cejas_005', 'cejas_008', 'cabello_006', 'skincare_003', 'skincare_007'];

// === RETRY WRAPPER ===
async function fetchWithRetry(url, options = {}, maxRetries = 4, baseDelayMs = 2000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
      console.warn(`  ⚠️ fetch retry ${attempt}/${maxRetries} (${err.message}) — retrying in ${Math.round(delay)}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

async function main() {
  const args = process.argv.slice(2);
  const run = args.find(a => a.startsWith('--run='))?.split('=')[1] || 'A';

  console.log('=== R6-C11 NVIDIA e5-v5 RETRIEVAL ENHANCEMENT BENCHMARK ===');
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
    const response = await fetchWithRetry(NVIDIA_API_URL, {
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
    const data = await response.json();
    return data.data[0].embedding;
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

  // === RRF FUSION FOR MULTIPLE VECTOR QUERIES ===
  function combineRRFMultiple(vectorResultArrays, k = RRF_K) {
    const scores = new Map();
    for (const results of vectorResultArrays) {
      for (const r of results) {
        if (!scores.has(r.chunk_id)) {
          scores.set(r.chunk_id, { ...r, query_ranks: [], sources: [] });
        }
        const entry = scores.get(r.chunk_id);
        entry.query_ranks.push(r.vector_rank);
        entry.sources.push('VECTOR');
        entry.vector_score = Math.max(entry.vector_score || 0, r.vector_score);
      }
    }
    for (const entry of scores.values()) {
      let rrfScore = 0;
      for (const rank of entry.query_ranks) {
        rrfScore += 1 / (k + rank);
      }
      entry.hybrid_score = rrfScore;
    }
    return Array.from(scores.values()).sort((a, b) => b.hybrid_score - a.hybrid_score)
      .map((r, i) => ({ ...r, hybrid_rank: i + 1 }));
  }

  // === LLM CALL (Ollama) ===
  async function ollamaGenerate(prompt, temperature = 0.1, maxTokens = 200) {
    const res = await fetchWithRetry(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature, num_predict: maxTokens }
      }),
    }, 3, 3000);
    const data = await res.json();
    return data.response.trim();
  }

  // === QUERY EXPANSION (Estrategia A) ===
  async function expandQuery(query, category) {
    const prompt = `Eres un experto en belleza y dermatología. Expande la siguiente consulta del usuario agregando términos técnicos, sinónimos y conceptos relacionados que ayudarían a recuperar información técnica relevante de una base de conocimientos especializada.

Consulta original: "${query}"
Categoría: ${category}

Genera SOLO la consulta expandida en español, sin explicaciones, sin formato, una sola línea.`;
    return await ollamaGenerate(prompt, 0.1, 150);
  }

  // === MULTI-QUERY GENERATION (Estrategia B) ===
  async function generateMultiQueries(query, category) {
    const prompt = `Eres un experto en belleza y dermatología. Genera 3 formulaciones alternativas de la siguiente consulta, cada una con un enfoque diferente, para maximizar la recuperación de información técnica.

Consulta original: "${query}"
Categoría: ${category}

Genera EXACTAMENTE 3 líneas, una por formulación:
1. Formulación técnica/científica
2. Formulación con sinónimos y términos relacionados
3. Formulación centrada en conceptos/mecanismos

Sin numeración, sin explicaciones, solo las 3 consultas.`;
    const response = await ollamaGenerate(prompt, 0.2, 200);
    const lines = response.split('\n').filter(l => l.trim()).slice(0, 3);
    return lines.length === 3 ? lines : [query, query, query];
  }

  // === HYDE - HYPOTHETICAL DOCUMENT EMBEDDING (Estrategia C) ===
  async function generateHyDE(query, category) {
    const prompt = `Eres un experto en belleza y dermatología. Escribe un documento técnico hipotético que respondería perfectamente a la siguiente consulta. El documento debe usar lenguaje técnico preciso, terminología del dominio y cubrir los conceptos clave.

Consulta: "${query}"
Categoría: ${category}

Escribe SOLO el documento hipotético en español (máximo 200 palabras), sin introducción, sin conclusión, sin meta-comentarios.`;
    return await ollamaGenerate(prompt, 0.3, 300);
  }

  // === QUERY ROUTING (Estrategia F) ===
  async function detectComplexQuery(query, category) {
    const complexTerms = [
      'asimétric', 'simetr', 'muscul', 'orbicular', 'arquitectura', 'envejecim', 'psicolog',
      'electrolis', 'laser', 'láser', 'erbio', 'tyndall', 'fotoprotecc', 'glucem', 'cicatriz',
      'SERS', 'Raman', 'autofag', 'péptid', 'homeostas', 'viscoelastic', 'metamerism', 'metamerismo',
      'queratolisis', 'queratinocit', 'fibroblast', 'melanocit', 'dermis', 'epidermis',
      'microbioma', 'microbiota', 'inflamac', 'oxidac', 'antioxid', 'radical libre'
    ];
    const queryLower = query.toLowerCase();
    const hits = complexTerms.filter(t => queryLower.includes(t));
    return {
      is_complex: hits.length > 0,
      matched_terms: hits,
      complexity_score: hits.length
    };
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

  function evaluateStrategy(name, expectedIds, results) {
    const r5 = computeMetrics(expectedIds, results, 5);
    const r10 = computeMetrics(expectedIds, results, 10);
    const r20 = computeMetrics(expectedIds, results, 20);
    const r50 = computeMetrics(expectedIds, results, 50);
    const r200 = computeMetrics(expectedIds, results, 200);
    const mrr = computeMRR(expectedIds, results);

    // Vector miss analysis
    const goldInTop200 = expectedIds.filter(id => results.slice(0, 200).map(r => r.chunk_id).includes(id));
    const vectorMiss = expectedIds.filter(id => !results.slice(0, 200).map(r => r.chunk_id).includes(id));

    return {
      name,
      mrr: +mrr.toFixed(4),
      r5: +(r5.gold_count / Math.max(1, expectedIds.length)).toFixed(4),
      r10: +(r10.gold_count / Math.max(1, expectedIds.length)).toFixed(4),
      r20: +(r20.gold_count / Math.max(1, expectedIds.length)).toFixed(4),
      r50: +(r50.gold_count / Math.max(1, expectedIds.length)).toFixed(4),
      r200: +(r200.gold_count / Math.max(1, expectedIds.length)).toFixed(4),
      vector_miss_count: vectorMiss.length,
      vector_miss_ids: vectorMiss,
      gold_recovered: goldInTop200,
      first_hit_rank: r5.first_hit_rank,
      candidate_count: results.length
    };
  }

  // === LLM GENERATION CACHE (per query, reused across strategies) ===
  const llmCache = {}; // { queryId: { expanded, multi, hyde } }
  async function cachedExpansion(queryId, queryText, category) {
    if (!llmCache[queryId]) llmCache[queryId] = {};
    if (!llmCache[queryId].expanded) {
      llmCache[queryId].expanded = await expandQuery(queryText, category);
    }
    return llmCache[queryId].expanded;
  }
  async function cachedMultiQueries(queryId, queryText, category) {
    if (!llmCache[queryId]) llmCache[queryId] = {};
    if (!llmCache[queryId].multi) {
      llmCache[queryId].multi = await generateMultiQueries(queryText, category);
    }
    return llmCache[queryId].multi;
  }
  async function cachedHyDE(queryId, queryText, category) {
    if (!llmCache[queryId]) llmCache[queryId] = {};
    if (!llmCache[queryId].hyde) {
      llmCache[queryId].hyde = await generateHyDE(queryText, category);
    }
    return llmCache[queryId].hyde;
  }

  // === CHECKPOINT / RESUME ===
  const checkpointPath = path.join(OUT_DIR, `r6c11_checkpoint_${run.toLowerCase()}.json`);
  let results = {};
  if (fs.existsSync(checkpointPath)) {
    try {
      results = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
      console.log(`🔄 RESUMING from checkpoint: ${Object.keys(results).length} queries already done`);
    } catch (e) {
      console.warn('⚠️ Checkpoint corrupt, starting fresh');
    }
  }

  // ============================================
  // BASELINE + STRATEGIES EVALUATION
  // ============================================
  console.log('\n=== BASELINE + STRATEGIES EVALUATION ===');

  const baselineMisses = new Set();

  for (const q of supportedQueries) {
    const queryId = q.query_id;
    if (results[queryId] && results[queryId].baseline) {
      console.log(`\n--- ${queryId}: SKIPPED (checkpoint) ---`);
      continue;
    }
    const expectedIds = expectedIdsMap[queryId] || [];
    const queryText = queryTexts[queryId];
    const category = queryCategories[queryId];

    console.log(`\n--- ${queryId}: ${queryText} ---`);

    // BASELINE: NVIDIA only
    console.log('  BASELINE...');
    const baselineVec = await retrieveVector(queryText, null, K);
    const baselineEval = evaluateStrategy('baseline', expectedIds, baselineVec);
    baselineMisses.add(...baselineEval.vector_miss_ids);
    results[queryId] = { baseline: baselineEval };

    // STRATEGY A: Query Expansion (cached)
    console.log('  QUERY EXPANSION...');
    try {
      const expandedQuery = await cachedExpansion(queryId, queryText, category);
      const expandedVec = await retrieveVector(expandedQuery, null, K);
      const dualVec = combineRRFMultiple([baselineVec, expandedVec]);
      results[queryId].query_expansion = evaluateStrategy('query_expansion', expectedIds, dualVec);
      results[queryId].query_expansion.expanded_query = expandedQuery;
    } catch (e) {
      console.warn('    Query expansion failed:', e.message);
      results[queryId].query_expansion = { error: e.message };
    }
    await new Promise(r => setTimeout(r, 200));

    // STRATEGY B: Multi-Query (cached)
    console.log('  MULTI-QUERY...');
    try {
      const multiQueries = await cachedMultiQueries(queryId, queryText, category);
      const multiVecs = [];
      for (const mq of multiQueries) {
        multiVecs.push(await retrieveVector(mq, null, K));
        await new Promise(r => setTimeout(r, 100));
      }
      const fusedMulti = combineRRFMultiple(multiVecs);
      results[queryId].multi_query = evaluateStrategy('multi_query', expectedIds, fusedMulti);
      results[queryId].multi_query.queries = multiQueries;
    } catch (e) {
      console.warn('    Multi-query failed:', e.message);
      results[queryId].multi_query = { error: e.message };
    }

    // STRATEGY C: HyDE (cached)
    console.log('  HYDE...');
    try {
      const hydeDoc = await cachedHyDE(queryId, queryText, category);
      const hydeVec = await retrieveVector(hydeDoc, null, K);
      const dualHyde = combineRRFMultiple([baselineVec, hydeVec]);
      results[queryId].hyde = evaluateStrategy('hyde', expectedIds, dualHyde);
      results[queryId].hyde.hypothetical_doc = hydeDoc.substring(0, 200);
    } catch (e) {
      console.warn('    HyDE failed:', e.message);
      results[queryId].hyde = { error: e.message };
    }
    await new Promise(r => setTimeout(r, 200));

    // STRATEGY D: Dense + Sparse (FTS)
    console.log('  DENSE + SPARSE...');
    const ftsRes = await retrieveFTS(queryText, K);
    const denseSparse = combineRRF(baselineVec, ftsRes);
    results[queryId].dense_sparse = evaluateStrategy('dense_sparse', expectedIds, denseSparse);

    // STRATEGY E: Candidate Fusion (all cached sources + sparse)
    console.log('  CANDIDATE FUSION...');
    const fusionArrays = [baselineVec];
    try {
      const expandedQuery = await cachedExpansion(queryId, queryText, category);
      fusionArrays.push(await retrieveVector(expandedQuery, null, K));
    } catch (e) {}
    try {
      const multiQueries = await cachedMultiQueries(queryId, queryText, category);
      for (const mq of multiQueries) {
        fusionArrays.push(await retrieveVector(mq, null, K));
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (e) {}
    try {
      const hydeDoc = await cachedHyDE(queryId, queryText, category);
      fusionArrays.push(await retrieveVector(hydeDoc, null, K));
    } catch (e) {}
    fusionArrays.push(ftsRes);
    const fusion = combineRRFMultiple(fusionArrays);
    results[queryId].candidate_fusion = evaluateStrategy('candidate_fusion', expectedIds, fusion);

    // STRATEGY F: Query Routing (only apply enhanced for complex queries)
    console.log('  QUERY ROUTING...');
    const routingInfo = await detectComplexQuery(queryText, category);
    if (routingInfo.is_complex) {
      // Use candidate fusion for complex queries
      results[queryId].routing = { ...results[queryId].candidate_fusion, routed: true, complexity: routingInfo };
    } else {
      // Use baseline for simple queries
      results[queryId].routing = { ...results[queryId].baseline, routed: false, complexity: routingInfo };
    }

    // === CHECKPOINT after each query ===
    fs.writeFileSync(checkpointPath, JSON.stringify(results, null, 2));
    console.log(`  💾 checkpoint saved (${queryId})`);

    await new Promise(r => setTimeout(r, 500));
  }

  // ============================================
  // AGGREGATE METRICS
  // ============================================
  console.log('\n=== AGGREGATE METRICS ===');

  const strategies = ['baseline', 'query_expansion', 'multi_query', 'hyde', 'dense_sparse', 'candidate_fusion', 'routing'];
  const aggregate = {};

  for (const strat of strategies) {
    const queries = supportedQueries.length;
    const mrrSum = supportedQueries.reduce((sum, q) => sum + (results[q.query_id][strat]?.mrr || 0), 0);
    const r5Sum = supportedQueries.reduce((sum, q) => sum + (results[q.query_id][strat]?.r5 || 0), 0);
    const r10Sum = supportedQueries.reduce((sum, q) => sum + (results[q.query_id][strat]?.r10 || 0), 0);
    const r20Sum = supportedQueries.reduce((sum, q) => sum + (results[q.query_id][strat]?.r20 || 0), 0);
    const r50Sum = supportedQueries.reduce((sum, q) => sum + (results[q.query_id][strat]?.r50 || 0), 0);
    const r200Sum = supportedQueries.reduce((sum, q) => sum + (results[q.query_id][strat]?.r200 || 0), 0);
    const missSum = supportedQueries.reduce((sum, q) => sum + (results[q.query_id][strat]?.vector_miss_count || 0), 0);
    const missIds = new Set();
    for (const q of supportedQueries) {
      (results[q.query_id][strat]?.vector_miss_ids || []).forEach(id => missIds.add(id));
    }

    aggregate[strat] = {
      mrr: +(mrrSum / queries).toFixed(4),
      r5: +(r5Sum / queries).toFixed(4),
      r10: +(r10Sum / queries).toFixed(4),
      r20: +(r20Sum / queries).toFixed(4),
      r50: +(r50Sum / queries).toFixed(4),
      r200: +(r200Sum / queries).toFixed(4),
      total_vector_miss: missSum,
      unique_vector_miss: missIds.size,
      vector_miss_ids: [...missIds]
    };

    console.log(`${strat}: MRR=${aggregate[strat].mrr}, R@5=${aggregate[strat].r5}, R@10=${aggregate[strat].r10}, R@20=${aggregate[strat].r20}, R@50=${aggregate[strat].r50}, Misses=${aggregate[strat].unique_vector_miss}`);
  }

  // ============================================
  // MISS RECOVERY ANALYSIS (13 canonical VECTOR_MISS from R6-C10)
  // ============================================
  console.log('\n=== 13 VECTOR MISS RECOVERY ANALYSIS ===');

  // Load canonical 13 VECTOR_MISS from R6-C10 forensics
  const canonicalMissPath = path.join(OUT_DIR, 'r6c11_canonical_misses.json');
  let canonicalMisses = [];
  if (fs.existsSync(canonicalMissPath)) {
    canonicalMisses = JSON.parse(fs.readFileSync(canonicalMissPath, 'utf8')).map(m => m.chunk_id);
  } else {
    // Fallback: derive from R6-C10 forensics artifact
    const r6c10Forensics = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'r6c10_corpus_forensics_a.json'), 'utf8'));
    for (const [qid, entry] of Object.entries(r6c10Forensics.corpus_forensics)) {
      for (const g of entry.gold_chunks) {
        if (g.status === 'CORPUS_PRESENT_VECTOR_MISS') canonicalMisses.push(g.chunk_id);
      }
    }
  }
  const r6c10Misses = new Set(canonicalMisses);
  console.log('R6-C10 canonical VECTOR_MISS:', r6c10Misses.size, [...r6c10Misses]);

  const missRecovery = {};
  for (const strat of strategies.slice(1)) { // skip baseline
    const missIds = new Set();
    for (const q of supportedQueries) {
      (results[q.query_id][strat]?.vector_miss_ids || []).forEach(id => missIds.add(id));
    }
    const resolved = [...r6c10Misses].filter(id => !missIds.has(id));
    const newMisses = [...missIds].filter(id => !r6c10Misses.has(id));
    missRecovery[strat] = {
      recovery_rate: +(resolved.length / r6c10Misses.size).toFixed(4),
      resolved_count: resolved.length,
      resolved_ids: resolved,
      new_misses_count: newMisses.length,
      new_miss_ids: newMisses,
      regression: newMisses.length > 0
    };
    console.log(`${strat}: recovered ${resolved.length}/${r6c10Misses.size} (${missRecovery[strat].recovery_rate}), new misses: ${newMisses.length}`);
  }

  // ============================================
  // PER-GOLD ANALYSIS FOR CRITICAL QUERIES
  // ============================================
  console.log('\n=== PER-GOLD ANALYSIS ===');
  const goldAnalysis = {};

  // Pre-compute retrieval results for all strategies for critical queries
  const criticalRetrievals = {};
  for (const qid of CRITICAL_QUERIES) {
    const queryText = queryTexts[qid];
    criticalRetrievals[qid] = {
      baseline: await retrieveVector(queryText, null, 200),
      dense_sparse: await combineRRF(await retrieveVector(queryText, null, 200), await retrieveFTS(queryText, 200))
    };
  }

  for (const qid of CRITICAL_QUERIES) {
    const q = supportedQueries.find(q => q.query_id === qid);
    if (!q) continue;
    const expectedIds = expectedIdsMap[qid] || [];

    goldAnalysis[qid] = {
      query: queryTexts[qid],
      category: queryCategories[qid],
      gold_chunks: expectedIds,
      strategies: {}
    };

    for (const strat of strategies) {
      const res = results[qid][strat];
      if (!res) continue;

      // Use pre-computed retrievals for rank finding
      let vecResults = null;
      if (strat === 'baseline') {
        vecResults = criticalRetrievals[qid]?.baseline;
      } else if (strat === 'dense_sparse') {
        vecResults = criticalRetrievals[qid]?.dense_sparse;
      }

      const chunkDetails = expectedIds.map(goldId => {
        let actualRank = null;
        if (vecResults) {
          const found = vecResults.find(r => r.chunk_id === goldId);
          if (found) actualRank = found.vector_rank || found.hybrid_rank || found.fts_rank;
        }
        return {
          chunk_id: goldId,
          retrieved: !res.vector_miss_ids.includes(goldId),
          rank: actualRank
        };
      });

      goldAnalysis[qid].strategies[strat] = {
        mrr: res.mrr,
        r5: res.r5,
        r10: res.r10,
        r20: res.r20,
        r50: res.r50,
        vector_miss_count: res.vector_miss_count,
        chunk_details: chunkDetails
      };
    }
  }

  // ============================================
  // COST / LATENCY ESTIMATION
  // ============================================
  console.log('\n=== COST ESTIMATION ===');
  const costEstimate = {
    baseline: { nvidia_calls: 1, ollama_calls: 0, estimated_latency_ms: 500 },
    query_expansion: { nvidia_calls: 2, ollama_calls: 1, estimated_latency_ms: 1500 },
    multi_query: { nvidia_calls: 4, ollama_calls: 1, estimated_latency_ms: 2500 },
    hyde: { nvidia_calls: 2, ollama_calls: 1, estimated_latency_ms: 2000 },
    dense_sparse: { nvidia_calls: 1, ollama_calls: 0, estimated_latency_ms: 800 },
    candidate_fusion: { nvidia_calls: 7, ollama_calls: 3, estimated_latency_ms: 5000 },
    routing: { nvidia_calls: '1-7 (adaptive)', ollama_calls: '0-3 (adaptive)', estimated_latency_ms: '500-5000 (adaptive)' }
  };
  console.log(JSON.stringify(costEstimate, null, 2));

  // ============================================
  // DECISION
  // ============================================
  console.log('\n=== DECISION ANALYSIS ===');
  const decision = {
    r6c11_verdict: '',
    best_strategy: '',
    baseline_mrr: aggregate.baseline.mrr,
    baseline_vector_miss: aggregate.baseline.unique_vector_miss,
    best_mrr: 0,
    best_vector_miss: 0,
    misses_recovered: 0,
    miss_recovery_rate: 0,
    regressions: 0,
    additional_latency_ms: 0,
    additional_nvidia_calls: 0,
    recommendation: ''
  };

  // Find best strategy by miss recovery rate, then MRR, with REGRESSION GATE
  // Criterion #3: MRR, R@5, R@10 must stay >= 95% of baseline (no significant regression)
  let bestStrat = 'baseline';
  let bestRecovery = -1;
  let bestMRR = -1;

  const baselineMRR = aggregate.baseline.mrr;
  const baselineR5 = aggregate.baseline.r5;
  const baselineR10 = aggregate.baseline.r10;

  for (const strat of strategies.slice(1)) {
    const recovery = missRecovery[strat]?.recovery_rate || 0;
    const mrr = aggregate[strat].mrr;
    const regression = missRecovery[strat]?.regression || false;
    const newMisses = missRecovery[strat]?.new_misses_count || 0;
    const agg = aggregate[strat];

    // REGRESSION GATE: must not degrade MRR/R@5/R@10 significantly (<95% of baseline)
    const mrrOk = mrr >= baselineMRR * 0.95;
    const r5Ok = agg.r5 >= baselineR5 * 0.95;
    const r10Ok = agg.r10 >= baselineR10 * 0.95;
    const passesGate = mrrOk && r5Ok && r10Ok && !regression;

    console.log(`${strat}: recovery=${recovery} mrr=${mrr} (gate ${mrrOk?'✅':'❌'}) r5=${agg.r5} (${r5Ok?'✅':'❌'}) r10=${agg.r10} (${r10Ok?'✅':'❌'}) newMisses=${newMisses} => ${passesGate ? 'PASSES GATE' : 'FAILS GATE'}`);

    if (!passesGate) continue;

    if (recovery > bestRecovery || (recovery === bestRecovery && mrr > bestMRR)) {
      bestRecovery = recovery;
      bestMRR = mrr;
      bestStrat = strat;
    }
  }

  decision.best_strategy = bestStrat;
  decision.best_mrr = aggregate[bestStrat].mrr;
  decision.best_vector_miss = aggregate[bestStrat].unique_vector_miss;
  decision.misses_recovered = missRecovery[bestStrat]?.resolved_count || 0;
  decision.miss_recovery_rate = missRecovery[bestStrat]?.recovery_rate || 0;
  decision.regressions = missRecovery[bestStrat]?.new_misses_count || 0;
  decision.additional_latency_ms = costEstimate[bestStrat]?.estimated_latency_ms - costEstimate.baseline.estimated_latency_ms || 0;
  decision.additional_nvidia_calls = (typeof costEstimate[bestStrat]?.nvidia_calls === 'number' ? costEstimate[bestStrat].nvidia_calls : 1) - 1;

  // Determine verdict
  if (bestStrat === 'baseline') {
    decision.r6c11_verdict = 'NVIDIA_BASELINE_CONFIRMED';
    decision.recommendation = 'Ninguna estrategia recupera misses canónicos sin regresión significativa en MRR/R@5/R@10. NVIDIA e5-v5 baseline confirmado. Los conceptos especializados requieren adaptación del espacio semántico (fine-tuning / domain adaptation).';
  } else if (decision.miss_recovery_rate >= 0.3 && decision.regressions === 0) {
    decision.r6c11_verdict = 'ADOPT_' + bestStrat.toUpperCase();
    decision.recommendation = `Adoptar ${bestStrat}: recupera ${(decision.miss_recovery_rate*100).toFixed(1)}% de misses canónicos sin regresión en MRR/R@5/R@10.`;
  } else if (decision.miss_recovery_rate > 0) {
    decision.r6c11_verdict = 'INSUFFICIENT_EVIDENCE';
    decision.recommendation = `Mejoras marginales con ${bestStrat} pero no suficientes para adopción automática.`;
  } else {
    decision.r6c11_verdict = 'NVIDIA_BASELINE_CONFIRMED';
    decision.recommendation = 'Ninguna estrategia mejora el baseline sin regresión. NVIDIA e5-v5 baseline confirmado.';
  }

  // Check if fine-tuning should be next
  if (decision.r6c11_verdict === 'NVIDIA_BASELINE_CONFIRMED' || decision.r6c11_verdict === 'INSUFFICIENT_EVIDENCE') {
    decision.next_cycle = 'R6-C12: Fine-tuning / Domain Adaptation Research';
  } else {
    decision.next_cycle = `R6-C12: Implement ${bestStrat} + Evaluate Production Readiness`;
  }

  console.log('DECISION:', JSON.stringify(decision, null, 2));

  // ============================================
  // FINAL REPORTS
  // ============================================
  const strategyReport = {
    cycle: 'R6-C11',
    run,
    timestamp: new Date().toISOString(),
    name: 'RETRIEVAL_ENHANCEMENT_BENCHMARK',
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
    baseline_misses: [...baselineMisses],
    strategies: {},
    aggregate,
    miss_recovery: missRecovery,
    gold_analysis: goldAnalysis,
    cost_estimate: costEstimate,
    decision,
    production_guards: { env_guard: 'PASS', read_only: true, no_railway: true, no_production_modification: true, nvidia_unchanged: true }
  };

  for (const strat of strategies) {
    strategyReport.strategies[strat] = {
      aggregate: aggregate[strat],
      per_query: {}
    };
    for (const q of supportedQueries) {
      strategyReport.strategies[strat].per_query[q.query_id] = results[q.query_id][strat];
    }
  }

  const causalReport = {
    cycle: 'R6-C11',
    run,
    timestamp: new Date().toISOString(),
    name: 'CAUSAL_DECISION',
    baseline: aggregate.baseline,
    strategies_evaluated: strategies.slice(1),
    comparison_matrix: strategies.map(s => ({
      strategy: s,
      mrr: aggregate[s].mrr,
      r5: aggregate[s].r5,
      r10: aggregate[s].r10,
      r20: aggregate[s].r20,
      r50: aggregate[s].r50,
      vector_miss: aggregate[s].unique_vector_miss,
      recovery_rate: missRecovery[s]?.recovery_rate || 0,
      regressions: missRecovery[s]?.new_misses_count || 0,
      estimated_latency_ms: costEstimate[s]?.estimated_latency_ms || 0
    })),
    miss_analysis: {
      r6c10_baseline_misses: [...r6c10Misses],
      recovery_by_strategy: missRecovery
    },
    decision,
    production_guards: { env_guard: 'PASS', read_only: true, no_railway: true, no_production_modification: true, nvidia_unchanged: true }
  };

  // Write artifacts
  const strategyPath = path.join(OUT_DIR, `r6c11_retrieval_enhancement_${run.toLowerCase()}.json`);
  const causalPath = path.join(OUT_DIR, `r6c11_causal_decision_${run.toLowerCase()}.json`);

  fs.writeFileSync(strategyPath, JSON.stringify(strategyReport, null, 2));
  fs.writeFileSync(causalPath, JSON.stringify(causalReport, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log('Strategy Report:', strategyPath);
  console.log('Causal Decision:', causalPath);
  console.log('Verdict:', decision.r6c11_verdict);
  console.log('Best Strategy:', decision.best_strategy);
  console.log('Miss Recovery Rate:', decision.miss_recovery_rate);
  console.log('Regressions:', decision.regressions);

  await ragPool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });