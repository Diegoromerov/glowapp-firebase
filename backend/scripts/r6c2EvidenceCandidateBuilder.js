/**
 * R6-C2 Evidence Candidate Builder
 * Experimental layer: Vector retrieval → Evidence Candidates
 * Read-only, no modifications to production
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');

const MAX_EMBED_CHARS = 1400;
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

async function main() {
  const args = process.argv.slice(2);
  const run = args.find(a => a.startsWith('--run='))?.split('=')[1] || 'A';

  // === ENV GUARD ===
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 PRODUCTION DETECTED - ABORT');
    process.exit(1);
  }
  console.log('✅ ENV GUARD: PASS (local)');

  // === BD INTEGRITY ===
  const integrity = await ragPool.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE embedding IS NULL) AS nulls,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS nonnulls
    FROM beauty_knowledge_embeddings
  `);
  console.log('BD INTEGRITY:', JSON.stringify(integrity.rows[0]));

  // === LOAD GOLD-V5 ===
  const goldPath = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
  const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
  const queries = gold.queries.filter(q => q.support_status !== 'UNSUPPORTED');
  console.log('GOLD-V5 queries:', queries.length);

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
        input_type: 'passage',
        encoding_format: 'float',
      }),
    });
    if (!response.ok) throw new Error('API error: ' + response.status);
    const data = await response.json();
    return data.data[0].embedding;
  }

  // === RETRIEVAL FUNCTION ===
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
    return res.rows.map(r => ({
      chunk_id: r.chunk_id,
      title: r.title,
      content: r.content,
      category: r.category,
      metadata: r.metadata,
      similarity: parseFloat(r.similarity)
    }));
  }

  // === EVIDENCE CANDIDATE BUILDER ===
  function buildCandidates(retrievalResults, queryId) {
    if (!retrievalResults || retrievalResults.length === 0) return [];

    // Group by category for semantic coherence
    const byCategory = {};
    for (const r of retrievalResults) {
      const cat = r.category || 'unknown';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(r);
    }

    const candidates = [];
    let candidateId = 0;

    for (const [category, chunks] of Object.entries(byCategory)) {
      // Sort chunks by similarity descending
      chunks.sort((a, b) => b.similarity - a.similarity);

      // Create candidate from top chunks in this category
      const topChunks = chunks.slice(0, 3); // Max 3 chunks per category candidate
      if (topChunks.length === 0) continue;

      const candidate = {
        candidate_id: `cand_${queryId}_${candidateId++}`,
        query_id: queryId,
        chunk_ids: topChunks.map(c => c.chunk_id),
        category: category,
        titles: topChunks.map(c => c.title),
        retrieval_scores: topChunks.map(c => parseFloat(c.similarity.toFixed(4))),
        evidence_text: topChunks.map(c => c.content).join(' | '),
        provenance: {
          source: 'vector_retrieval',
          retrieval_count: topChunks.length,
          categories_represented: 1,
          max_score: parseFloat(topChunks[0].similarity.toFixed(4)),
          min_score: parseFloat(topChunks[topChunks.length - 1].similarity.toFixed(4)),
          score_spread: parseFloat((topChunks[0].similarity - topChunks[topChunks.length - 1].similarity).toFixed(4))
        },
        candidate_score: parseFloat(topChunks[0].similarity.toFixed(4)), // Lead score
        evidence_count: topChunks.length,
        confidence_signals: {
          has_high_score: topChunks[0].similarity > 0.6,
          score_above_threshold: topChunks[0].similarity > 0.45,
          multiple_chunks: topChunks.length > 1,
          category_coherent: true
        }
      };
      candidates.push(candidate);
    }

    // Sort candidates by candidate_score descending
    candidates.sort((a, b) => b.candidate_score - a.candidate_score);
    return candidates;
  }

  // === CONTROL: Raw Vector Retrieval Evaluation ===
  function evaluateControl(queryId, expectedIds, retrievalResults, k) {
    const topK = retrievalResults.slice(0, k).map(r => r.chunk_id);
    let hit = false;
    for (const id of expectedIds) {
      if (topK.includes(id)) { hit = true; break; }
    }
    return hit;
  }

  // === EXPERIMENT: Candidate Builder Evaluation ===
  function evaluateExperiment(queryId, expectedIds, candidates, k = 5) {
    // Flatten candidate chunks up to k candidates
    const candidateChunks = candidates
      .slice(0, k)
      .flatMap(c => c.chunk_ids);
    let hit = false;
    for (const id of expectedIds) {
      if (candidateChunks.includes(id)) { hit = true; break; }
    }
    return hit;
  }

  // === MAIN EVALUATION LOOP ===
  const controlResults = [];
  const experimentResults = [];
  const candidateData = [];

  let controlHits5 = 0, controlHits10 = 0, controlHits20 = 0, controlHits50 = 0;
  let expHits5 = 0, expHits10 = 0, expHits20 = 0, expHits50 = 0;
  let totalReciprocalRankControl = 0, totalReciprocalRankExp = 0;
  let querySuccessControl = 0, querySuccessExp = 0;

  for (const q of queries) {
    const expectedIds = [...(q.expected_chunks?.core || []), ...(q.expected_chunks?.supporting || [])];
    
    // Raw retrieval
    const retrieval = await retrieveVector(q.query, 50);
    
    // Build candidates
    const candidates = buildCandidates(retrieval, q.query_id);
    
    // Store candidate data
    candidateData.push({
      query_id: q.query_id,
      candidates: candidates.map(c => ({
        candidate_id: c.candidate_id,
        chunk_ids: c.chunk_ids,
        category: c.category,
        candidate_score: c.candidate_score,
        evidence_count: c.evidence_count,
        provenance: c.provenance,
        confidence_signals: c.confidence_signals
      }))
    });

    // Control evaluation (raw retrieval)
    const firstHitControl = retrieval.findIndex(r => expectedIds.includes(r.chunk_id));
    const hit5Control = evaluateControl(q.query_id, expectedIds, retrieval, 5);
    const hit10Control = evaluateControl(q.query_id, expectedIds, retrieval, 10);
    const hit20Control = evaluateControl(q.query_id, expectedIds, retrieval, 20);
    const hit50Control = evaluateControl(q.query_id, expectedIds, retrieval, 50);
    if (hit5Control) controlHits5++;
    if (hit10Control) controlHits10++;
    if (hit20Control) controlHits20++;
    if (hit50Control) controlHits50++;
    if (firstHitControl >= 0) totalReciprocalRankControl += 1 / (firstHitControl + 1);
    if (hit50Control) querySuccessControl++;

    // Experiment evaluation (candidates)
    const candidateChunks = candidates.flatMap(c => c.chunk_ids);
    const firstHitExp = candidateChunks.findIndex(id => expectedIds.includes(id));
    const hit5Exp = evaluateExperiment(q.query_id, expectedIds, candidates, 5);
    const hit10Exp = evaluateExperiment(q.query_id, expectedIds, candidates, 10);
    const hit20Exp = evaluateExperiment(q.query_id, expectedIds, candidates, 20);
    const hit50Exp = evaluateExperiment(q.query_id, expectedIds, candidates, 50);
    if (hit5Exp) expHits5++;
    if (hit10Exp) expHits10++;
    if (hit20Exp) expHits20++;
    if (hit50Exp) expHits50++;
    if (firstHitExp >= 0) totalReciprocalRankExp += 1 / (firstHitExp + 1);
    if (hit50Exp) querySuccessExp++;

    // Store detailed results
    controlResults.push({
      query_id: q.query_id,
      expected_ids: expectedIds,
      hit_at_5: hit5Control,
      hit_at_10: hit10Control,
      hit_at_20: hit20Control,
      hit_at_50: hit50Control,
      first_hit_rank: firstHitControl >= 0 ? firstHitControl + 1 : null,
      retrieval_top5: retrieval.slice(0, 5).map(r => ({ chunk_id: r.chunk_id, similarity: r.similarity }))
    });

    experimentResults.push({
      query_id: q.query_id,
      expected_ids: expectedIds,
      hit_at_5: hit5Exp,
      hit_at_10: hit10Exp,
      hit_at_20: hit20Exp,
      hit_at_50: hit50Exp,
      first_hit_rank: firstHitExp >= 0 ? firstHitExp + 1 : null,
      candidate_count: candidates.length,
      candidates_top5: candidates.slice(0, 5).map(c => ({
        candidate_id: c.candidate_id,
        chunk_ids: c.chunk_ids,
        category: c.category,
        candidate_score: c.candidate_score,
        evidence_count: c.evidence_count
      }))
    });

    await new Promise(r => setTimeout(r, 100));
  }

  const total = queries.length;

  // === AGGREGATE METRICS ===
  const controlMetrics = {
    r_at_5: parseFloat((controlHits5 / total).toFixed(4)),
    r_at_10: parseFloat((controlHits10 / total).toFixed(4)),
    r_at_20: parseFloat((controlHits20 / total).toFixed(4)),
    r_at_50: parseFloat((controlHits50 / total).toFixed(4)),
    mrr: parseFloat((totalReciprocalRankControl / total).toFixed(4)),
    query_success_at_50: parseFloat((querySuccessControl / total).toFixed(4))
  };

  const expMetrics = {
    r_at_5: parseFloat((expHits5 / total).toFixed(4)),
    r_at_10: parseFloat((expHits10 / total).toFixed(4)),
    r_at_20: parseFloat((expHits20 / total).toFixed(4)),
    r_at_50: parseFloat((expHits50 / total).toFixed(4)),
    mrr: parseFloat((totalReciprocalRankExp / total).toFixed(4)),
    query_success_at_50: parseFloat((querySuccessExp / total).toFixed(4))
  };

  // Candidate-level metrics
  const candidateMetrics = {
    avg_candidates_per_query: parseFloat((candidateData.reduce((s, c) => s + c.candidates.length, 0) / total).toFixed(2)),
    avg_evidence_per_candidate: parseFloat((candidateData.reduce((s, c) => s + c.candidates.reduce((ss, cc) => ss + cc.evidence_count, 0), 0) / Math.max(1, candidateData.reduce((s, c) => s + c.candidates.length, 0))).toFixed(2)),
    avg_candidate_score: parseFloat((candidateData.reduce((s, c) => s + c.candidates.reduce((ss, cc) => ss + cc.candidate_score, 0), 0) / Math.max(1, candidateData.reduce((s, c) => s + c.candidates.length, 0))).toFixed(4)),
    provenance_completeness: 1.0 // All candidates have provenance
  };

  // Critical cases detail
  const criticalQueries = queries.filter(qq => ['cabello_002', 'cejas_004', 'cejas_008'].includes(qq.query_id));
  const criticalDetail = [];
  for (const q of criticalQueries) {
    const cRes = controlResults.find(r => r.query_id === q.query_id);
    const eRes = experimentResults.find(r => r.query_id === q.query_id);
    const cData = candidateData.find(d => d.query_id === q.query_id);
    criticalDetail.push({
      query_id: q.query_id,
      control: cRes,
      experiment: eRes,
      candidates_full: cData?.candidates || []
    });
  }

  // === FINAL REPORT ===
  const report = {
    cycle: 'R6-C2',
    run,
    timestamp: new Date().toISOString(),
    bd_integrity: integrity.rows[0],
    control_metrics: controlMetrics,
    experiment_metrics: expMetrics,
    candidate_metrics: candidateMetrics,
    delta: {
      r_at_5: parseFloat((expMetrics.r_at_5 - controlMetrics.r_at_5).toFixed(4)),
      r_at_10: parseFloat((expMetrics.r_at_10 - controlMetrics.r_at_10).toFixed(4)),
      r_at_20: parseFloat((expMetrics.r_at_20 - controlMetrics.r_at_20).toFixed(4)),
      r_at_50: parseFloat((expMetrics.r_at_50 - controlMetrics.r_at_50).toFixed(4)),
      mrr: parseFloat((expMetrics.mrr - controlMetrics.mrr).toFixed(4)),
      query_success: parseFloat((expMetrics.query_success_at_50 - controlMetrics.query_success_at_50).toFixed(4))
    },
    control_results: controlResults,
    experiment_results: experimentResults,
    candidate_data: candidateData,
    critical_cases: criticalDetail,
    production_guard: { status: 'PASS', note: 'Local BD only, read-only, no modifications' }
  };

  const outPath = path.join(OUT_DIR, `r6c2_evidence_candidate_builder_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\n=== CONTROL METRICS ===');
  console.log(JSON.stringify(controlMetrics, null, 2));
  console.log('\n=== EXPERIMENT METRICS ===');
  console.log(JSON.stringify(expMetrics, null, 2));
  console.log('\n=== DELTA (EXP - CONTROL) ===');
  console.log(JSON.stringify(report.delta, null, 2));
  console.log('\n=== CANDIDATE METRICS ===');
  console.log(JSON.stringify(candidateMetrics, null, 2));
  console.log('\nREPORT:', outPath);
  console.log('VERDICT: PENDING_RUN_B_COMPARISON');

  await ragPool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });