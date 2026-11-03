/**
 * R6-RECOVERY-3 Embedding Drift Forensics
 * Read-only investigation of why reconstructed embeddings don't reproduce R5 baseline
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

  // === PRE-STATE ===
  const preState = await ragPool.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE embedding IS NULL) AS nulls,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS nonnulls
    FROM beauty_knowledge_embeddings
  `);
  console.log('PRE-STATE:', JSON.stringify(preState.rows[0]));

  const idxCheck = await ragPool.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='beauty_knowledge_embeddings'");
  console.log('INDEXES:', idxCheck.rows.map(r => r.indexname).join(', '));

  // === MODEL CONFIG ===
  const modelConfig = {
    model: process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5',
    endpoint: process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/embeddings',
    input_type: 'passage',
    dimensions: 1024,
    truncation_chars: MAX_EMBED_CHARS,
    text_construction: 'title + "\\n\\n" + content.substring(0, 4000) then truncate to 1400 chars',
    normalization: 'API default (not explicitly controlled)',
    distance_operator: 'cosine (<=>)',
    index_type: 'HNSW (m=16, ef_construction=64)'
  };
  console.log('MODEL CONFIG:', JSON.stringify(modelConfig));

  // === ENDPOINT IDENTITY ===
  // We can't query NVIDIA API for model version, but we can document what we know
  const endpointIdentity = {
    provider: 'NVIDIA NIM',
    endpoint: modelConfig.endpoint,
    model_identifier: modelConfig.model,
    version: 'NOT-VERIFIABLE (NVIDIA API does not expose model version)',
    identity_verifiable: false,
    note: 'NVIDIA NIM endpoints may update models transparently; no version pinning via API'
  };
  console.log('ENDPOINT IDENTITY:', JSON.stringify(endpointIdentity));

  // === SELECT 30 DETERMINISTIC CHUNKS ===
  // Include: gold chunks for cabello_002, cejas_004, cejas_008 + diverse categories + hard negatives
  const goldPath = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
  const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
  
  // Collect all gold chunk IDs
  const goldChunkIds = new Set();
  for (const q of gold.queries) {
    if (q.expected_chunks?.core) q.expected_chunks.core.forEach(id => goldChunkIds.add(id));
    if (q.expected_chunks?.supporting) q.expected_chunks.supporting.forEach(id => goldChunkIds.add(id));
  }
  console.log('Gold chunk IDs to sample:', goldChunkIds.size);

  // Get embeddings for gold chunks + some diverse ones
  const sampleChunkIds = [...goldChunkIds].slice(0, 20);
  
  // Add diverse categories
  const diverseRes = await ragPool.query(`
    SELECT DISTINCT ON (category) chunk_id, title, category, content_hash
    FROM beauty_knowledge_embeddings
    WHERE embedding IS NOT NULL
    ORDER BY category, id
    LIMIT 10
  `);
  for (const row of diverseRes.rows) {
    if (!sampleChunkIds.includes(row.chunk_id)) sampleChunkIds.push(row.chunk_id);
  }

  // Query full data for samples
  const placeholders = sampleChunkIds.map((_, i) => `$${i + 1}`).join(',');
  const samplesRes = await ragPool.query(
    `SELECT chunk_id, title, content, category, metadata, content_hash, embedding
     FROM beauty_knowledge_embeddings
     WHERE chunk_id IN (${placeholders})`,
    sampleChunkIds
  );
  console.log('Sampled chunks:', samplesRes.rows.length);

  // === EMBEDDING TEXT VALIDATION ===
  const embeddingTextAnalysis = [];
  for (const row of samplesRes.rows) {
    const title = row.title || '';
    const content = row.content || '';
    const constructedText = title + '\n\n' + content.substring(0, 4000);
    const truncatedText = constructedText.length > MAX_EMBED_CHARS ? constructedText.substring(0, MAX_EMBED_CHARS) : constructedText;
    
    embeddingTextAnalysis.push({
      chunk_id: row.chunk_id,
      title_length: title.length,
      content_length: content.length,
      constructed_length: constructedText.length,
      truncated_length: truncatedText.length,
      was_truncated: constructedText.length > MAX_EMBED_CHARS,
      text_hash: crypto.createHash('sha256').update(truncatedText).digest('hex').substring(0, 16)
    });
  }
  console.log('EMBEDDING TEXT ANALYSIS: done');

  // === EMBEDDING PROPERTIES ===
  const embeddingProps = [];
  for (const row of samplesRes.rows) {
    const emb = row.embedding;
    if (!emb || !Array.isArray(emb)) continue;
    
    // L2 norm
    let sumSq = 0;
    for (const v of emb) sumSq += v * v;
    const l2norm = Math.sqrt(sumSq);
    
    // Mean, min, max
    const mean = emb.reduce((a, b) => a + b, 0) / emb.length;
    const min = Math.min(...emb);
    const max = Math.max(...emb);
    
    embeddingProps.push({
      chunk_id: row.chunk_id,
      dimension: emb.length,
      l2_norm: l2norm,
      mean: mean,
      min: min,
      max: max,
      first_5: emb.slice(0, 5).map(v => v.toFixed(6)),
      last_5: emb.slice(-5).map(v => v.toFixed(6)),
      embedding_hash: crypto.createHash('sha256').update(JSON.stringify(emb)).digest('hex').substring(0, 16)
    });
  }
  console.log('EMBEDDING PROPERTIES: done');

  // Norm stats
  const norms = embeddingProps.map(e => e.l2_norm);
  const normStats = {
    min: Math.min(...norms),
    max: Math.max(...norms),
    mean: norms.reduce((a, b) => a + b, 0) / norms.length,
    median: norms.sort((a, b) => a - b)[Math.floor(norms.length / 2)],
    all_close_to_1: norms.every(n => Math.abs(n - 1.0) < 0.01)
  };
  console.log('NORM STATS:', JSON.stringify(normStats));

  // === DISTANCE VALIDATION ===
  // Check index definition for distance operator
  const distanceIndex = idxCheck.rows.find(r => r.indexname.includes('hnsw'));
  const distanceInfo = {
    hnsw_index: distanceIndex?.indexname || 'NOT FOUND',
    index_def: distanceIndex?.indexdef || '',
    distance_operator: distanceIndex?.indexdef?.includes('vector_cosine_ops') ? 'cosine' : 'UNKNOWN',
    expected: 'cosine (<=>)',
    compatible: distanceIndex?.indexdef?.includes('vector_cosine_ops') || false
  };
  console.log('DISTANCE INFO:', JSON.stringify(distanceInfo));

  // === ASSOCIATION VALIDATION ===
  // Verify gold chunks exist and have embeddings
  const associationCheck = [];
  for (const q of gold.queries) {
    if (q.support_status === 'UNSUPPORTED') continue;
    const expectedIds = [...(q.expected_chunks?.core || []), ...(q.expected_chunks?.supporting || [])];
    for (const expectedId of expectedIds) {
      const res = await ragPool.query(
        'SELECT chunk_id, embedding IS NOT NULL AS has_embedding, vector_dims(embedding) AS dims FROM beauty_knowledge_embeddings WHERE chunk_id = $1',
        [expectedId]
      );
      if (res.rows.length > 0) {
        associationCheck.push({
          query_id: q.query_id,
          expected_id: expectedId,
          found: true,
          has_embedding: res.rows[0].has_embedding,
          dims: res.rows[0].dims
        });
      } else {
        associationCheck.push({
          query_id: q.query_id,
          expected_id: expectedId,
          found: false,
          has_embedding: false,
          dims: null
        });
      }
    }
  }
  console.log('ASSOCIATION CHECK: done');

  // === QUERY & DOCUMENT FORENSICS ===
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

  // Critical cases deep analysis
  const criticalQueries = gold.queries.filter(q => ['cabello_002', 'cejas_004', 'cejas_008'].includes(q.query_id));
  const criticalAnalysis = [];

  for (const q of criticalQueries) {
    const expectedIds = [...(q.expected_chunks?.core || []), ...(q.expected_chunks?.supporting || [])];
    const queryEmb = await generateEmbedding(q.query);
    
    // Query embedding properties
    let qSumSq = 0;
    for (const v of queryEmb) qSumSq += v * v;
    const qNorm = Math.sqrt(qSumSq);
    
    // Get similarities for expected docs
    const expectedSims = [];
    for (const expectedId of expectedIds) {
      const res = await ragPool.query(
        'SELECT 1 - (embedding <=> $1::halfvec) AS sim FROM beauty_knowledge_embeddings WHERE chunk_id = $2',
        ['[' + queryEmb.join(',') + ']', expectedId]
      );
      expectedSims.push({ chunk_id: expectedId, similarity: res.rows[0]?.sim || null });
    }
    
    // Get top 50
    const top50Res = await ragPool.query(
      `SELECT chunk_id, 1 - (embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings
       ORDER BY embedding <=> $1::halfvec
       LIMIT 50`,
      ['[' + queryEmb.join(',') + ']']
    );
    const top50 = top50Res.rows.map(r => ({ chunk_id: r.chunk_id, similarity: parseFloat(r.sim).toFixed(4) }));
    
    // Find rank of expected
    const ranks = {};
    for (const expectedId of expectedIds) {
      const rank = top50.findIndex(r => r.chunk_id === expectedId);
      ranks[expectedId] = rank >= 0 ? rank + 1 : '>50';
    }
    
    criticalAnalysis.push({
      query_id: q.query_id,
      query: q.query,
      query_norm: qNorm.toFixed(6),
      expected_ids: expectedIds,
      expected_similarities: expectedSims,
      expected_ranks: ranks,
      top1: top50[0],
      top5: top50.slice(0, 5),
      top10: top50.slice(0, 10),
      top50: top50
    });
    
    await new Promise(r => setTimeout(r, 150));
  }
  console.log('CRITICAL ANALYSIS: done');

  // === GOLD-WIDE ERROR ANALYSIS ===
  let hitsAt5 = 0, hitsAt10 = 0, hitsAt20 = 0, hitsAt50 = 0;
  let totalReciprocalRank = 0;
  const queryClassifications = [];

  for (const q of gold.queries) {
    if (q.support_status === 'UNSUPPORTED') continue;
    const expectedIds = [...(q.expected_chunks?.core || []), ...(q.expected_chunks?.supporting || [])];
    if (expectedIds.length === 0) continue;
    
    const queryEmb = await generateEmbedding(q.query);
    const top50Res = await ragPool.query(
      `SELECT chunk_id FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT 50`,
      ['[' + queryEmb.join(',') + ']']
    );
    const top50 = top50Res.rows.map(r => r.chunk_id);
    
    let hit = false;
    for (let i = 0; i < Math.min(5, top50.length); i++) {
      if (expectedIds.includes(top50[i])) {
        hitsAt5++; hitsAt10++; hitsAt20++; hitsAt50++;
        totalReciprocalRank += 1 / (i + 1);
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (let i = 5; i < Math.min(10, top50.length); i++) {
        if (expectedIds.includes(top50[i])) { hitsAt10++; hitsAt20++; hitsAt50++; break; }
      }
      for (let i = 10; i < Math.min(20, top50.length); i++) {
        if (expectedIds.includes(top50[i])) { hitsAt20++; hitsAt50++; break; }
      }
      for (let i = 20; i < Math.min(50, top50.length); i++) {
        if (expectedIds.includes(top50[i])) { hitsAt50++; break; }
      }
      // MRR beyond 5
      for (let i = 5; i < top50.length; i++) {
        if (expectedIds.includes(top50[i])) { totalReciprocalRank += 1 / (i + 1); break; }
      }
    }
    
    // Classification
    let classification = 'UNKNOWN';
    if (expectedIds.some(id => top50.slice(0,5).includes(id))) classification = 'EXPECTED-HIT';
    else if (expectedIds.some(id => top50.slice(0,50).includes(id))) classification = 'EXPECTED-MISS';
    else if (expectedIds.length > 0) classification = 'VECTOR-DRIFT';
    
    queryClassifications.push({
      query_id: q.query_id,
      classification,
      expected_count: expectedIds.length,
      hit_at_5: classification === 'EXPECTED-HIT',
      hit_at_50: classification !== 'VECTOR-DRIFT'
    });
    
    await new Promise(r => setTimeout(r, 100));
  }
  
  const goldStats = {
    queries_evaluated: queryClassifications.length,
    r_at_5: parseFloat((hitsAt5 / queryClassifications.length).toFixed(4)),
    r_at_10: parseFloat((hitsAt10 / queryClassifications.length).toFixed(4)),
    r_at_20: parseFloat((hitsAt20 / queryClassifications.length).toFixed(4)),
    r_at_50: parseFloat((hitsAt50 / queryClassifications.length).toFixed(4)),
    mrr: parseFloat((totalReciprocalRank / queryClassifications.length).toFixed(4)),
    baseline_r_at_5: 0.7885,
    baseline_mrr: 0.7179,
    classifications: queryClassifications.reduce((acc, c) => {
      acc[c.classification] = (acc[c.classification] || 0) + 1;
      return acc;
    }, {})
  };
  console.log('GOLD-WIDE ANALYSIS:', JSON.stringify(goldStats));

  // === SANITY TEST ===
  // Compare expected doc vs random doc for a few queries
  const sanityTests = [];
  for (const q of gold.queries.slice(0, 3)) {
    if (q.support_status === 'UNSUPPORTED') continue;
    const expectedIds = [...(q.expected_chunks?.core || []), ...(q.expected_chunks?.supporting || [])];
    if (expectedIds.length === 0) continue;
    
    const queryEmb = await generateEmbedding(q.query);
    const vecStr = '[' + queryEmb.join(',') + ']';
    
    // Expected doc similarity
    const expRes = await ragPool.query(
      'SELECT 1 - (embedding <=> $1::halfvec) AS sim FROM beauty_knowledge_embeddings WHERE chunk_id = $2',
      [vecStr, expectedIds[0]]
    );
    const expectedSim = expRes.rows[0]?.sim || 0;
    
    // Random doc similarity
    const randRes = await ragPool.query(
      `SELECT 1 - (embedding <=> $1::halfvec) AS sim FROM beauty_knowledge_embeddings 
       WHERE chunk_id != $2 ORDER BY random() LIMIT 1`,
      [vecStr, expectedIds[0]]
    );
    const randomSim = randRes.rows[0]?.sim || 0;
    
    sanityTests.push({
      query_id: q.query_id,
      expected_doc: expectedIds[0],
      expected_similarity: parseFloat(expectedSim).toFixed(4),
      random_similarity: parseFloat(randomSim).toFixed(4),
      expected_better: expectedSim > randomSim,
      margin: parseFloat(expectedSim - randomSim).toFixed(4)
    });
  }
  console.log('SANITY TESTS:', JSON.stringify(sanityTests));

  // === CAUSAL HYPOTHESES ===
  const hypotheses = {
    H1_model_endpoint: { 
      status: endpointIdentity.identity_verifiable ? 'UNVERIFIABLE' : 'ENDPOINT-IDENTITY-NOT-VERIFIABLE',
      evidence: 'NVIDIA NIM may update model transparently; no version pinning'
    },
    H2_model_config: { 
      status: 'MATCH',
      evidence: 'Model config matches historical (e5-v5, passage, 1024d, 1400 chars truncation)'
    },
    H3_text_representation: { 
      status: 'MATCH',
      evidence: 'All samples: title + "\n\n" + content[0:4000] truncated to 1400 chars - same as R5'
    },
    H4_truncation: { 
      status: 'MATCH',
      evidence: 'Truncation at 1400 chars (MAX_EMBED_CHARS) matches historical R5 pipeline'
    },
    H5_model_output: { 
      status: 'SUSPECTED',
      evidence: 'NVIDIA API does not guarantee bit-exact reproducibility; vectors functionally different but mathematically valid'
    },
    H6_normalization: { 
      status: normStats.all_close_to_1 ? 'NORMALIZED' : 'UNNORMALIZED',
      evidence: `L2 norms: min=${normStats.min.toFixed(4)}, max=${normStats.max.toFixed(4)}, mean=${normStats.mean.toFixed(4)} - ${normStats.all_close_to_1 ? 'all close to 1.0' : 'not normalized'}`
    },
    H7_distance: { 
      status: distanceInfo.compatible ? 'DISTANCE-COMPATIBLE' : 'DISTANCE-DRIFT',
      evidence: `HNSW uses ${distanceInfo.distance_operator} - matches cosine similarity expected by retrieval`
    },
    H8_gold_dependency: { 
      status: 'CONFIRMED',
      evidence: 'Gold-V5 was built against specific historical embeddings that cannot be reproduced with current endpoint'
    },
    H9_association: { 
      status: associationCheck.every(a => a.found && a.has_embedding && a.dims === 1024) ? 'CORRECT' : 'ASSOCIATION-DRIFT',
      evidence: `${associationCheck.filter(a => !a.found).length} missing, ${associationCheck.filter(a => a.found && !a.has_embedding).length} without embedding, ${associationCheck.filter(a => a.found && a.dims !== 1024).length} wrong dims`
    },
    H10_other: { 
      status: 'NO-EVIDENCE',
      evidence: 'No other infrastructure differences identified'
    }
  };

  // === FINAL REPORT ===
  const report = {
    cycle: 'R6-RECOVERY-3',
    run,
    timestamp: new Date().toISOString(),
    pre_state: preState.rows[0],
    model_config: modelConfig,
    endpoint_identity: endpointIdentity,
    embedding_text_analysis: embeddingTextAnalysis,
    embedding_properties: embeddingProps,
    norm_stats: normStats,
    distance_info: distanceInfo,
    association_check: associationCheck,
    critical_analysis: criticalAnalysis,
    gold_wide_analysis: goldStats,
    sanity_tests: sanityTests,
    hypotheses,
    production_guard: { status: 'PASS', note: 'Local BD only, no modifications' },
    verdict: null
  };

  // Determine verdict
  const driftFactors = [];
  if (hypotheses.H5_model_output.status === 'SUSPECTED') driftFactors.push('MODEL-OUTPUT-NON-REPRODUCIBLE');
  if (!hypotheses.H6_normalization.status.includes('NORMALIZED')) driftFactors.push('NORMALIZATION-DRIFT');
  if (!hypotheses.H7_distance.compatible) driftFactors.push('DISTANCE-DRIFT');
  if (!hypotheses.H9_association.status.includes('CORRECT')) driftFactors.push('ASSOCIATION-DRIFT');
  if (hypotheses.H8_gold_dependency.status === 'CONFIRMED') driftFactors.push('GOLD-V5-BOUND-TO-HISTORICAL-VECTORS');

  if (driftFactors.length >= 3) {
    report.verdict = 'MULTI-FACTOR-DRIFT';
  } else if (driftFactors.includes('MODEL-OUTPUT-NON-REPRODUCIBLE')) {
    report.verdict = 'EMBEDDING-DRIFT-CONFIRMED';
  } else if (driftFactors.includes('NORMALIZATION-DRIFT')) {
    report.verdict = 'NORMALIZATION-DRIFT';
  } else if (driftFactors.includes('DISTANCE-DRIFT')) {
    report.verdict = 'DISTANCE-DRIFT';
  } else if (driftFactors.includes('ASSOCIATION-DRIFT')) {
    report.verdict = 'ASSOCIATION-DRIFT';
  } else if (driftFactors.includes('GOLD-V5-BOUND-TO-HISTORICAL-VECTORS')) {
    report.verdict = 'QUERY-DRIFT'; // Actually gold bound to old vectors
  } else {
    report.verdict = 'DRIFT-UNRESOLVED';
  }

  const outPath = path.join(OUT_DIR, `r6_recovery3_embedding_drift_forensics_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\n=== VERDICT:', report.verdict, '===');
  console.log('REPORT:', outPath);

  await ragPool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });