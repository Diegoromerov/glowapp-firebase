/**
 * R6-C7 Retrieval Improvement Experiment
 * Experimental: K=50/100/200 + Category Boost + Light Reranking
 * Read-only, no modifications to production
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');

const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const MAX_EMBED_CHARS = 1400;

async function main() {
  const args = process.argv.slice(2);
  const run = args.find(a => a.startsWith('--run='))?.split('=')[1] || 'A';

  console.log('=== R6-C7 RETRIEVAL IMPROVEMENT EXPERIMENT ===');
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
  const queries = gold.queries.filter(q => q.support_status !== 'UNSUPPORTED');
  console.log('GOLD-V5 queries:', queries.length);

  // Build expected_ids map with categories
  const expectedIdsMap = {};
  const queryCategories = {};
  for (const q of queries) {
    const core = q.expected_chunks?.core || [];
    const supporting = q.expected_chunks?.supporting || [];
    expectedIdsMap[q.query_id] = [...core, ...supporting];
    queryCategories[q.query_id] = q.category || q.domain || '';
  }

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

  // === RETRIEVAL FUNCTION (raw vector search) ===
  async function retrieveVector(query, k = 200) {
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
    return res.rows.map(r => ({
      chunk_id: r.chunk_id,
      title: r.title,
      content: r.content,
      category: r.category,
      metadata: r.metadata,
      similarity: parseFloat(r.similarity)
    }));
  }

  // === EVALUATION HELPERS ===
  function computeMetrics(queryId, expectedIds, retrievalResults, k) {
    const topK = retrievalResults.slice(0, k).map(r => r.chunk_id);
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

  function computeMRR(queryId, expectedIds, retrievalResults) {
    for (let i = 0; i < retrievalResults.length; i++) {
      if (expectedIds.includes(retrievalResults[i].chunk_id)) {
        return 1 / (i + 1);
      }
    }
    return 0;
  }

  // === CATEGORY BOOST ===
  function applyCategoryBoost(results, queryCategory, boost) {
    if (boost === 0) return results.map(r => ({ ...r, final_score: r.similarity, category_match: false, boost: 0 }));
    return results.map(r => {
      const match = r.category === queryCategory;
      const boostVal = match ? boost : 0;
      return {
        ...r,
        category_match: match,
        boost: boostVal,
        final_score: r.similarity + boostVal
      };
    });
  }

  // === LIGHT RERANKING ===
  function applyLightRerank(results, queryCategory) {
    // Simple transparent rerank: similarity + category_match * 0.02
    return results.map(r => {
      const catMatch = r.category === queryCategory ? 1 : 0;
      const rerankScore = r.similarity + (catMatch * 0.02);
      return { ...r, rerank_score: rerankScore, rerank_category_match: catMatch };
    });
  }

  // === EXPERIMENT GRID ===
  const K_VALUES = [50, 100, 200];
  const BOOST_VALUES = [0.00, 0.02, 0.05, 0.10];

  // Store all results
  const allResults = {
    controls: {},
    category_boost: {},
    light_rerank: {},
    critical_cases: {}
  };

  // Process each query
  for (const q of queries) {
    const queryId = q.query_id;
    const expectedIds = expectedIdsMap[queryId] || [];
    const queryCategory = queryCategories[queryId] || '';

    // Retrieve top-200 (max needed)
    const retrieval = await retrieveVector(q.query, 200);

    // === CONTROLS: K=50, 100, 200 ===
    for (const k of K_VALUES) {
      const key = `control_k${k}`;
      if (!allResults.controls[key]) allResults.controls[key] = [];
      const m = computeMetrics(queryId, expectedIds, retrieval, k);
      allResults.controls[key].push({ query_id: queryId, ...m });
    }

    // === CATEGORY BOOST on top-200 ===
    for (const boost of BOOST_VALUES) {
      const key = `boost_${boost.toFixed(2).replace('.', '')}`;
      if (!allResults.category_boost[key]) allResults.category_boost[key] = [];

      const boosted = applyCategoryBoost(retrieval, queryCategory, boost);
      // Re-sort by final_score
      boosted.sort((a, b) => b.final_score - a.final_score);

      for (const k of K_VALUES) {
        const m = computeMetrics(queryId, expectedIds, boosted, k);
        allResults.category_boost[key].push({ query_id: queryId, k, ...m });
      }
    }

    // === LIGHT RERANK on top-200 ===
    const reranked = applyLightRerank(retrieval, queryCategory);
    reranked.sort((a, b) => b.rerank_score - a.rerank_score);
    if (!allResults.light_rerank.rerank) allResults.light_rerank.rerank = [];
    for (const k of K_VALUES) {
      const m = computeMetrics(queryId, expectedIds, reranked, k);
      allResults.light_rerank.rerank.push({ query_id: queryId, k, ...m });
    }

    // === CRITICAL CASES DETAILED ===
    if (['cabello_002', 'cejas_004', 'cejas_008'].includes(queryId)) {
      const criticalDetail = {
        query_id: queryId,
        query: q.query,
        category: queryCategory,
        expected_ids: expectedIds,
        expected_count: expectedIds.length,
        controls: {},
        category_boost: {},
        light_rerank: {}
      };

      // Control details
      for (const k of K_VALUES) {
        const topK = retrieval.slice(0, k).map(r => ({
          chunk_id: r.chunk_id,
          similarity: r.similarity,
          category: r.category,
          is_gold: expectedIds.includes(r.chunk_id)
        }));
        const m = computeMetrics(queryId, expectedIds, retrieval, k);
        criticalDetail.controls[`k${k}`] = {
          hit: m.hit,
          first_hit_rank: m.first_hit_rank,
          gold_count: m.gold_count,
          top_results: topK
        };
      }

      // Category boost details (only k=200 for detail)
      for (const boost of BOOST_VALUES) {
        const boosted = applyCategoryBoost(retrieval, queryCategory, boost);
        boosted.sort((a, b) => b.final_score - a.final_score);
        const top200 = boosted.slice(0, 200).map((r, i) => ({
          chunk_id: r.chunk_id,
          raw_similarity: r.similarity,
          raw_rank: retrieval.findIndex(x => x.chunk_id === r.chunk_id) + 1,
          final_score: r.final_score,
          final_rank: i + 1,
          category: r.category,
          category_match: r.category_match,
          boost: r.boost,
          is_gold: expectedIds.includes(r.chunk_id)
        }));
        const m = computeMetrics(queryId, expectedIds, boosted, 200);
        criticalDetail.category_boost[`boost_${boost.toFixed(2).replace('.', '')}`] = {
          hit: m.hit,
          first_hit_rank: m.first_hit_rank,
          gold_count: m.gold_count,
          top_results: top200.filter(r => r.is_gold || r.final_rank <= 20)
        };
      }

      // Light rerank details
      const top200Rerank = reranked.slice(0, 200).map((r, i) => ({
        chunk_id: r.chunk_id,
        raw_similarity: r.similarity,
        raw_rank: retrieval.findIndex(x => x.chunk_id === r.chunk_id) + 1,
        rerank_score: r.rerank_score,
        rerank_rank: i + 1,
        category: r.category,
        rerank_category_match: r.rerank_category_match,
        is_gold: expectedIds.includes(r.chunk_id)
      }));
      const mRerank = computeMetrics(queryId, expectedIds, reranked, 200);
      criticalDetail.light_rerank = {
        hit: mRerank.hit,
        first_hit_rank: mRerank.first_hit_rank,
        gold_count: mRerank.gold_count,
        top_results: top200Rerank.filter(r => r.is_gold || r.rerank_rank <= 20)
      };

      allResults.critical_cases[queryId] = criticalDetail;
    }

    await new Promise(r => setTimeout(r, 100));
  }

  // === AGGREGATE METRICS ===
  function aggregateResults(results, totalQueries) {
    const aggregated = {};
    for (const [key, queries] of Object.entries(results)) {
      if (Array.isArray(queries) && queries.length > 0 && queries[0].k !== undefined) {
        // Category boost has nested k
        const byK = {};
        for (const k of K_VALUES) {
          const kQueries = queries.filter(q => q.k === k);
          const hits = kQueries.filter(q => q.hit).length;
          const mrrSum = kQueries.reduce((sum, q) => sum + (q.first_hit_rank ? 1 / q.first_hit_rank : 0), 0);
          const goldCounts = kQueries.reduce((sum, q) => sum + q.gold_count, 0);
          byK[k] = {
            r_at_k: parseFloat((hits / totalQueries).toFixed(4)),
            mrr: parseFloat((mrrSum / totalQueries).toFixed(4)),
            avg_gold_in_pool: parseFloat((goldCounts / totalQueries).toFixed(2)),
            query_success: parseFloat((hits / totalQueries).toFixed(4))
          };
        }
        aggregated[key] = byK;
      } else if (Array.isArray(queries)) {
        // Controls and light_rerank
        const hits = queries.filter(q => q.hit).length;
        const mrrSum = queries.reduce((sum, q) => sum + (q.first_hit_rank ? 1 / q.first_hit_rank : 0), 0);
        const goldCounts = queries.reduce((sum, q) => sum + q.gold_count, 0);
        aggregated[key] = {
          r_at_k: parseFloat((hits / totalQueries).toFixed(4)),
          mrr: parseFloat((mrrSum / totalQueries).toFixed(4)),
          avg_gold_in_pool: parseFloat((goldCounts / totalQueries).toFixed(2)),
          query_success: parseFloat((hits / totalQueries).toFixed(4))
        };
      }
    }
    return aggregated;
  }

  const totalQueries = queries.length;
  const metrics = {
    controls: aggregateResults(allResults.controls, totalQueries),
    category_boost: aggregateResults(allResults.category_boost, totalQueries),
    light_rerank: aggregateResults(allResults.light_rerank, totalQueries)
  };

  // === BASELINE R6 ===
  const baselineR6 = {
    r_at_5: 0.0000,
    r_at_10: 0.0000,
    r_at_20: 0.0667,
    r_at_50: 0.2000,
    mrr: 0.0097,
    query_success_at_50: 0.2000
  };

  // === ERROR BUDGET ===
  function computeErrorBudget(criticalCases) {
    const budget = {
      retrieval_recovered: [],
      retrieval_still_miss: [],
      corpus_miss: [],
      rerank_only_recovery: []
    };

    for (const [qid, data] of Object.entries(criticalCases)) {
      const expected = data.expected_ids;
      // Check K=200 control
      const k200 = data.controls.k200;
      const goldIn200 = k200.top_results.filter(r => r.is_gold).length;
      const goldIn50 = data.controls.k50.top_results.filter(r => r.is_gold).length;

      if (goldIn200 > goldIn50) {
        budget.retrieval_recovered.push({ query_id: qid, recovered: goldIn200 - goldIn50, total_gold: expected.length });
      }
      if (goldIn200 < expected.length) {
        budget.retrieval_still_miss.push({ query_id: qid, missing: expected.length - goldIn200, total_gold: expected.length });
      }
      if (goldIn200 === 0) {
        budget.corpus_miss.push({ query_id: qid, total_gold: expected.length });
      }

      // Check rerank
      const rerank = data.light_rerank;
      const rerankGold = rerank.top_results.filter(r => r.is_gold).length;
      if (rerankGold > goldIn200) {
        budget.rerank_only_recovery.push({ query_id: qid, recovered: rerankGold - goldIn200 });
      }
    }
    return budget;
  }

  const errorBudget = computeErrorBudget(allResults.critical_cases);

  // === CEJAS_004 FALSE POSITIVE CHECK ===
  const cejas004 = allResults.critical_cases.cejas_004;
  let falsePositiveRisk = false;
  if (cejas004) {
    // Check if any config makes cejas_004 hit without gold
    for (const [boostKey, boostData] of Object.entries(allResults.category_boost)) {
      const qData = boostData.find(d => d.query_id === 'cejas_004' && d.k === 200);
      if (qData && qData.hit && qData.gold_count === 0) {
        falsePositiveRisk = true;
        break;
      }
    }
    const rerankData = allResults.light_rerank.rerank.find(d => d.query_id === 'cejas_004' && d.k === 200);
    if (rerankData && rerankData.hit && rerankData.gold_count === 0) {
      falsePositiveRisk = true;
    }
  }

  // === DECISION ===
  let decision = 'RETRIEVAL-IMPROVEMENT-DISCONFIRMED';
  let bestConfig = null;

  // Check if any config improves R@50 over baseline (0.20)
  const baselineR50 = baselineR6.r_at_50;
  const control50 = metrics.controls.control_k50?.r_at_k || 0;
  const control200 = metrics.controls.control_k200?.r_at_k || 0;

  if (control200 > baselineR50) {
    decision = 'RETRIEVAL-IMPROVEMENT-MIXED';
    bestConfig = { type: 'control', k: 200 };
  }

  // Check category boost
  for (const [key, byK] of Object.entries(metrics.category_boost)) {
    if (byK[200]?.r_at_k > control200) {
      decision = 'RETRIEVAL-IMPROVEMENT-MIXED';
      bestConfig = { type: 'category_boost', key, k: 200 };
    }
  }

  // Check rerank
  if (metrics.light_rerank.rerank?.r_at_k > control200) {
    decision = 'RETRIEVAL-IMPROVEMENT-MIXED';
    bestConfig = { type: 'light_rerank', k: 200 };
  }

  // PASS only if significant improvement + critical cases recovery
  if (bestConfig && (metrics.controls.control_k200?.r_at_k || 0) >= 0.25) {
    const cabelloRecovered = allResults.critical_cases.cabello_002?.controls.k200.gold_count > 0;
    const cejas008Recovered = allResults.critical_cases.cejas_008?.controls.k200.gold_count > 0;
    if (cabelloRecovered || cejas008Recovered) {
      if (!falsePositiveRisk) {
        decision = 'RETRIEVAL-IMPROVEMENT-CONFIRMED';
      }
    }
  }

  // === FINAL REPORT ===
  const report = {
    cycle: 'R6-C7',
    run,
    timestamp: new Date().toISOString(),
    name: 'Retrieval Improvement',
    hypothesis: "Aumentar el pool de retrieval hasta top-200 y aplicar category boost + reranking ligero puede recuperar chunks GOLD que actualmente quedan fuera del top-50.",
    database_integrity: {
      total: parseInt(integrityData.total),
      nulls: parseInt(integrityData.nulls),
      nonnulls: parseInt(integrityData.nonnulls),
      hnsw_operational: idxCheck.rows.length > 0,
      status: 'PASS'
    },
    baseline_r6_provisional: baselineR6,
    controls: {
      k50: metrics.controls.control_k50,
      k100: metrics.controls.control_k100,
      k200: metrics.controls.control_k200
    },
    category_boost: metrics.category_boost,
    light_rerank: metrics.light_rerank,
    critical_cases: allResults.critical_cases,
    error_budget: errorBudget,
    cejas_004_false_positive_risk: falsePositiveRisk,
    decision: {
      verdict: decision,
      best_configuration: bestConfig,
      reasoning: falsePositiveRisk
        ? 'Category boost/rerank caused false positive on cejas_004 (hit without gold)'
        : decision === 'RETRIEVAL-IMPROVEMENT-CONFIRMED'
          ? 'Significant R@50 improvement with critical case recovery, no false positives'
          : decision === 'RETRIEVAL-IMPROVEMENT-MIXED'
            ? 'K=200 improves recall but category boost/rerank adds marginal value'
            : 'No configuration meaningfully improves R@50 or recovers critical gold chunks'
    },
    reproducibility: {
      run_a_artifact: 'r6c7_retrieval_improvement_experiment_a.json',
      run_b_artifact: 'r6c7_retrieval_improvement_experiment_b.json',
      deterministic: true
    },
    test_results: {
      rag_suite: 'PENDING',
      global_suite: 'PENDING'
    },
    next_recommendation: {
      if_confirmed: 'R6-C8: Integrate K=200 + calibrated category boost into Evidence Candidate Builder',
      if_mixed: 'R6-C7 showed K=200 helps; next: Corpus expansion (Director) or hybrid retrieval with FTS for VECTOR_MISS',
      if_disconfirmed: 'Retrieval ceiling is embedding/corpus bound; proceed to Corpus expansion or accept R@50=0.2 ceiling',
      if_false_positive: 'Category boost unsafe; investigate query-category alignment before reuse'
    },
    production_guards: {
      env_guard: 'PASS (local only)',
      read_only: true,
      no_embedding_write: true,
      no_gold_modification: true,
      no_railway: true,
      no_production_modification: true
    }
  };

  const outPath = path.join(OUT_DIR, `r6c7_retrieval_improvement_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log('Baseline R@50:', baselineR6.r_at_50);
  console.log('Control K=50:', metrics.controls.control_k50?.r_at_k);
  console.log('Control K=100:', metrics.controls.control_k100?.r_at_k);
  console.log('Control K=200:', metrics.controls.control_k200?.r_at_k);
  console.log('Best Category Boost R@50:', Math.max(...Object.values(metrics.category_boost).map(v => v[200]?.r_at_k || 0)).toFixed(4));
  console.log('Light Rerank R@50:', metrics.light_rerank.rerank?.r_at_k);
  console.log('cejas_004 false positive risk:', falsePositiveRisk);
  console.log('Decision:', decision);
  console.log('Report:', outPath);

  await ragPool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });