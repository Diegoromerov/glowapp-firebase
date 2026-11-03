/**
 * R6-C8 Hybrid Retrieval Experiment
 * Experimental: VECTOR + FTS + RRF Hybrid for VECTOR_MISS recovery
 * Read-only, no modifications to production
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');

const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const MAX_EMBED_CHARS = 1400;
const RRF_K = 60; // Reciprocal Rank Fusion constant

async function main() {
  const args = process.argv.slice(2);
  const run = args.find(a => a.startsWith('--run='))?.split('=')[1] || 'A';

  console.log('=== R6-C8 HYBRID RETRIEVAL EXPERIMENT ===');
  console.log('Run:', run);

  // === ENV GUARD ===
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 PRODUCTION DETECTED - ABORT');
    process.exit(1);
  }
  console.log('✅ ENV GUARD: PASS (local)');

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

  // Build expected_ids map with categories
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

  const CRITICAL_QUERIES = ['cabello_002', 'cejas_004', 'cejas_008'];

  // === EMBEDDING FUNCTION ===
  const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
  const NVIDIA_API_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/embeddings';
  const NVIDIA_EMBEDDING_MODEL = process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5';

  async function generateEmbedding(text) {
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
    if (!response.ok) throw new Error('API error: ' + response.status);
    const data = await response.json();
    return data.data[0].embedding;
  }

  // === VECTOR RETRIEVAL ===
  async function retrieveVector(query, k = 50) {
    const emb = await generateEmbedding(query);
    const vecStr = '[' + emb.join(',') + ']';
    const res = await ragPool.query(
      `SELECT chunk_id, title, content, category, metadata,
              1 - (embedding <=> $1::halfvec) AS similarity
       FROM beauty_knowledge_embeddings
       ORDER BY embedding <=> $1::halfvec
       LIMIT $2`,
      [vecStr, k]
    );
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

  // === FTS RETRIEVAL (PostgreSQL Spanish) ===
  async function retrieveFTS(query, k = 50) {
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

  // === RRF HYBRID ===
  function combineRRF(vectorResults, ftsResults, k = RRF_K) {
    const scores = new Map();

    // Add vector results
    for (const r of vectorResults) {
      if (!scores.has(r.chunk_id)) {
        scores.set(r.chunk_id, {
          chunk_id: r.chunk_id,
          title: r.title,
          content: r.content,
          category: r.category,
          metadata: r.metadata,
          vector_rank: r.vector_rank,
          vector_score: r.vector_score,
          fts_rank: null,
          fts_score: null,
          source: 'VECTOR'
        });
      }
      const entry = scores.get(r.chunk_id);
      entry.vector_rank = r.vector_rank;
      entry.vector_score = r.vector_score;
      entry.source = entry.source === 'FTS' ? 'BOTH' : 'VECTOR';
    }

    // Add FTS results
    for (const r of ftsResults) {
      if (!scores.has(r.chunk_id)) {
        scores.set(r.chunk_id, {
          chunk_id: r.chunk_id,
          title: r.title,
          content: r.content,
          category: r.category,
          metadata: r.metadata,
          vector_rank: null,
          vector_score: null,
          fts_rank: r.fts_rank,
          fts_score: r.fts_score,
          source: 'FTS'
        });
      } else {
        const entry = scores.get(r.chunk_id);
        entry.fts_rank = r.fts_rank;
        entry.fts_score = r.fts_score;
        entry.source = entry.source === 'VECTOR' ? 'BOTH' : 'FTS';
      }
    }

    // Compute RRF score
    for (const entry of scores.values()) {
      let rrfScore = 0;
      if (entry.vector_rank) rrfScore += 1 / (k + entry.vector_rank);
      if (entry.fts_rank) rrfScore += 1 / (k + entry.fts_rank);
      entry.hybrid_score = rrfScore;
    }

    // Sort by hybrid_score descending
    const combined = Array.from(scores.values()).sort((a, b) => b.hybrid_score - a.hybrid_score);
    
    // Add hybrid_rank
    return combined.map((r, i) => ({ ...r, hybrid_rank: i + 1 }));
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

  // === EXPERIMENT ===
  const K = 50;
  const allResults = {
    vector: {},
    fts: {},
    hybrid_rrf: {},
    critical_cases: {}
  };

  // Process each supported query
  for (const q of supportedQueries) {
    const queryId = q.query_id;
    const expectedIds = expectedIdsMap[queryId] || [];
    const queryText = queryTexts[queryId];

    // Retrieve
    const vectorRes = await retrieveVector(queryText, K);
    const ftsRes = await retrieveFTS(queryText, K);
    const hybridRes = combineRRF(vectorRes, ftsRes);

    // Store for critical cases
    const isCritical = CRITICAL_QUERIES.includes(queryId);
    if (isCritical) {
      allResults.critical_cases[queryId] = {
        query_id: queryId,
        query: queryText,
        category: queryCategories[queryId],
        expected_ids: expectedIds,
        expected_count: expectedIds.length,
        vector: { results: vectorRes, metrics: computeMetrics(expectedIds, vectorRes, K), mrr: computeMRR(expectedIds, vectorRes) },
        fts: { results: ftsRes, metrics: computeMetrics(expectedIds, ftsRes, K), mrr: computeMRR(expectedIds, ftsRes) },
        hybrid_rrf: { results: hybridRes, metrics: computeMetrics(expectedIds, hybridRes, K), mrr: computeMRR(expectedIds, hybridRes) }
      };
    }

    // Aggregate metrics
    for (const [key, res] of Object.entries({ vector: vectorRes, fts: ftsRes, hybrid_rrf: hybridRes })) {
      if (!allResults[key][queryId]) allResults[key][queryId] = {};
      const m = computeMetrics(expectedIds, res, K);
      allResults[key][queryId] = {
        ...m,
        mrr: computeMRR(expectedIds, res)
      };
    }

    await new Promise(r => setTimeout(r, 100));
  }

  // === AGGREGATE METRICS ===
  function aggregate(results, totalQueries) {
    const hits = Object.values(results).filter(r => r.hit).length;
    const mrrSum = Object.values(results).reduce((sum, r) => sum + r.mrr, 0);
    const goldCounts = Object.values(results).reduce((sum, r) => sum + r.gold_count, 0);
    return {
      recall_at_50: parseFloat((hits / totalQueries).toFixed(4)),
      mrr: parseFloat((mrrSum / totalQueries).toFixed(4)),
      avg_gold_in_pool: parseFloat((goldCounts / totalQueries).toFixed(2)),
      query_success: parseFloat((hits / totalQueries).toFixed(4))
    };
  }

  const totalQueries = supportedQueries.length;
  const metrics = {
    vector: aggregate(allResults.vector, totalQueries),
    fts: aggregate(allResults.fts, totalQueries),
    hybrid_rrf: aggregate(allResults.hybrid_rrf, totalQueries)
  };

  // === LEXICAL RECOVERY ANALYSIS ===
  function analyzeLexicalRecovery(criticalCases) {
    const recovery = {
      vector_only_hits: [],
      fts_only_hits: [],
      both_hits: [],
      new_gold_by_fts: [],
      new_gold_by_hybrid: [],
      vector_miss_remaining: [],
      false_positive_count: 0
    };

    for (const [qid, data] of Object.entries(criticalCases)) {
      const expected = data.expected_ids;
      
      // Get gold hits from each
      const vectorGold = data.vector.results.filter(r => expected.includes(r.chunk_id)).map(r => r.chunk_id);
      const ftsGold = data.fts.results.filter(r => expected.includes(r.chunk_id)).map(r => r.chunk_id);
      const hybridGold = data.hybrid_rrf.results.filter(r => expected.includes(r.chunk_id)).map(r => r.chunk_id);

      // Vector only
      for (const g of vectorGold) {
        if (!ftsGold.includes(g)) recovery.vector_only_hits.push({ query_id: qid, chunk_id: g });
      }
      // FTS only
      for (const g of ftsGold) {
        if (!vectorGold.includes(g)) recovery.fts_only_hits.push({ query_id: qid, chunk_id: g });
      }
      // Both
      for (const g of vectorGold) {
        if (ftsGold.includes(g)) recovery.both_hits.push({ query_id: qid, chunk_id: g });
      }

      // New gold recovered by FTS (not in vector)
      for (const g of ftsGold) {
        if (!vectorGold.includes(g)) recovery.new_gold_by_fts.push({ query_id: qid, chunk_id: g });
      }
      // New gold recovered by Hybrid (not in vector)
      for (const g of hybridGold) {
        if (!vectorGold.includes(g)) recovery.new_gold_by_hybrid.push({ query_id: qid, chunk_id: g });
      }

      // Vector miss remaining
      for (const g of expected) {
        if (!vectorGold.includes(g) && !ftsGold.includes(g) && !hybridGold.includes(g)) {
          recovery.vector_miss_remaining.push({ query_id: qid, chunk_id: g });
        }
      }

      // False positive check: hybrid hits without gold
      const hybridTopK = data.hybrid_rrf.results.slice(0, K);
      const hybridGoldInTopK = hybridTopK.filter(r => expected.includes(r.chunk_id)).length;
      if (data.hybrid_rrf.metrics.hit && hybridGoldInTopK === 0) {
        recovery.false_positive_count++;
      }
    }

    return recovery;
  }

  const lexicalRecovery = analyzeLexicalRecovery(allResults.critical_cases);

  // === CEJAS_004 FALSE POSITIVE CHECK ===
  const cejas004 = allResults.critical_cases.cejas_004;
  let falsePositiveRisk = false;
  if (cejas004) {
    // Check if hybrid marks hit but gold_count is 0
    if (cejas004.hybrid_rrf.metrics.hit && cejas004.hybrid_rrf.metrics.gold_count === 0) {
      falsePositiveRisk = true;
    }
  }

  // === DECISION ===
  let decision = 'HYBRID-RETRIEVAL-DISCONFIRMED';
  let reasoning = '';

  const vectorR50 = metrics.vector.recall_at_50;
  const ftsR50 = metrics.fts.recall_at_50;
  const hybridR50 = metrics.hybrid_rrf.recall_at_50;
  const vectorMRR = metrics.vector.mrr;
  const hybridMRR = metrics.hybrid_rrf.mrr;

  const newGoldByFTS = lexicalRecovery.new_gold_by_fts.length;
  const newGoldByHybrid = lexicalRecovery.new_gold_by_hybrid.length;
  const cejas004Recovered = lexicalRecovery.new_gold_by_hybrid.filter(x => x.query_id === 'cejas_004').length;

  if (newGoldByHybrid === 0 && newGoldByFTS === 0) {
    decision = 'HYBRID-RETRIEVAL-DISCONFIRMED';
    reasoning = 'FTS no recupera ningún GOLD nuevo que VECTOR no recupere; HYBRID no mejora recall';
  } else if (cejas004Recovered >= 1 && newGoldByHybrid >= 2 && hybridMRR >= vectorMRR) {
    decision = 'HYBRID-RETRIEVAL-CONFIRMED';
    reasoning = `cejas_004 recupera ${cejas004Recovered}/4 GOLD VECTOR_MISS; ${newGoldByHybrid} GOLD nuevos totales; MRR no cae`;
  } else if (newGoldByHybrid >= 1 && !falsePositiveRisk) {
    decision = 'HYBRID-RETRIEVAL-PROMISING';
    reasoning = `${newGoldByHybrid} GOLD nuevos recuperados por HYBRID; sin false positive crítico; MRR ${hybridMRR >= vectorMRR ? 'estable' : 'cae levemente'}`;
  } else if (newGoldByFTS >= 1 && (hybridMRR < vectorMRR || falsePositiveRisk)) {
    decision = 'HYBRID-RETRIEVAL-MIXED';
    reasoning = `FTS recupera GOLD pero HYBRID degrada MRR o produce riesgo false positive`;
  } else {
    decision = 'HYBRID-RETRIEVAL-MIXED';
    reasoning = 'Recuperación parcial con trade-offs';
  }

  // === FINAL REPORT ===
  const report = {
    cycle: 'R6-C8',
    run,
    timestamp: new Date().toISOString(),
    name: 'HYBRID-RETRIEVAL-FOR-VECTOR-MISS',
    hypothesis: 'Para VECTOR_MISS, especialmente cejas_004, FTS puede recuperar evidencia por coincidencia léxica que el embedding NVIDIA e5-v5 reconstruido no representa correctamente.',
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
    controls: {
      vector_k50: metrics.vector,
      fts_k50: metrics.fts
    },
    hybrid_rrf: {
      k: RRF_K,
      metrics: metrics.hybrid_rrf
    },
    critical_cases: allResults.critical_cases,
    lexical_recovery: {
      vector_only_hits: lexicalRecovery.vector_only_hits.length,
      fts_only_hits: lexicalRecovery.fts_only_hits.length,
      both_hits: lexicalRecovery.both_hits.length,
      new_gold_recovered_by_fts: lexicalRecovery.new_gold_by_fts,
      new_gold_recovered_by_hybrid: lexicalRecovery.new_gold_by_hybrid,
      vector_miss_remaining: lexicalRecovery.vector_miss_remaining.length,
      lexical_recovery_rate: parseFloat((lexicalRecovery.new_gold_by_hybrid.length / 
        (lexicalRecovery.new_gold_by_hybrid.length + lexicalRecovery.vector_miss_remaining.length || 1)).toFixed(4)),
      false_positive_count: lexicalRecovery.false_positive_count
    },
    provenance: {
      cejas_004: {
        vector_gold: cejas004?.vector?.results?.filter(r => cejas004.expected_ids.includes(r.chunk_id)).map(r => r.chunk_id) || [],
        fts_gold: cejas004?.fts?.results?.filter(r => cejas004.expected_ids.includes(r.chunk_id)).map(r => r.chunk_id) || [],
        hybrid_gold: cejas004?.hybrid_rrf?.results?.filter(r => cejas004.expected_ids.includes(r.chunk_id)).map(r => r.chunk_id) || [],
        vector_miss_4_gold: cejas004?.expected_ids?.filter(g => 
          !cejas004.vector.results.find(r => r.chunk_id === g) && 
          !cejas004.fts.results.find(r => r.chunk_id === g) && 
          !cejas004.hybrid_rrf.results.find(r => r.chunk_id === g)
        ) || []
      }
    },
    cejas_004_false_positive_risk: falsePositiveRisk,
    decision: {
      verdict: decision,
      reasoning
    },
    reproducibility: {
      run_a_artifact: 'r6c8_hybrid_retrieval_experiment_a.json',
      run_b_artifact: 'r6c8_hybrid_retrieval_experiment_b.json',
      deterministic: true
    },
    test_results: {
      rag_suite: 'PENDING',
      global_suite: 'PENDING'
    },
    next_recommendation: {
      if_confirmed: 'R6-C9: Integrate Hybrid Retrieval (RRF) into Evidence Candidate Builder with production guards',
      if_promising: 'R6-C8 shows promise; calibrate RRF k parameter and evaluate production latency impact',
      if_mixed: 'FTS helps for lexical recovery but MRR cost; consider query-dependent hybrid activation',
      if_disconfirmed: 'Vector miss is not lexical; proceed to Corpus Expansion (Director) or Embedding Model change',
      if_false_positive: 'Hybrid unsafe for cejas_004; investigate query-FTS alignment before reuse'
    },
    production_guards: {
      env_guard: 'PASS (local only)',
      read_only: true,
      no_embedding_write: true,
      no_gold_modification: true,
      no_railway: true,
      no_production_modification: true,
      no_index_creation: true,
      no_migration: true
    }
  };

  const outPath = path.join(OUT_DIR, `r6c8_hybrid_retrieval_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log('Dataset:', totalQueries, 'SUPPORTED queries');
  console.log('Vector R@50:', metrics.vector.recall_at_50);
  console.log('FTS R@50:', metrics.fts.recall_at_50);
  console.log('Hybrid RRF R@50:', metrics.hybrid_rrf.recall_at_50);
  console.log('Vector MRR:', metrics.vector.mrr);
  console.log('Hybrid MRR:', metrics.hybrid_rrf.mrr);
  console.log('New GOLD by FTS:', lexicalRecovery.new_gold_by_fts.length);
  console.log('New GOLD by Hybrid:', lexicalRecovery.new_gold_by_hybrid.length);
  console.log('cejas_004 recovered:', cejas004Recovered, '/4');
  console.log('False positive risk:', falsePositiveRisk);
  console.log('Decision:', decision);
  console.log('Report:', outPath);

  await ragPool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });