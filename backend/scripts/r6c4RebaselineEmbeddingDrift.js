/**
 * R6-C4 Rebaseline Vector Drift / New Embedding Baseline
 * Establish provisional baseline on reconstructed embeddings
 * Read-only validation, no modifications
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

  // === 1. BD INTEGRIDAD ===
  const integrity = await ragPool.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE embedding IS NULL) AS nulls,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS nonnulls
    FROM beauty_knowledge_embeddings
  `);
  const idxCheck = await ragPool.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='beauty_knowledge_embeddings' AND indexname LIKE '%hnsw%'");
  const sampleDims = await ragPool.query('SELECT vector_dims(embedding) AS dims FROM beauty_knowledge_embeddings WHERE embedding IS NOT NULL LIMIT 5');
  
  const bdIntegridad = {
    total: parseInt(integrity.rows[0].total),
    nulls: parseInt(integrity.rows[0].nulls),
    nonnulls: parseInt(integrity.rows[0].nonnulls),
    hnsw_exists: idxCheck.rows.length > 0,
    hnsw_def: idxCheck.rows[0]?.indexdef || '',
    sample_dims: sampleDims.rows.map(r => r.dims).filter(d => d === 1024).length === 5,
    all_1024d: sampleDims.rows.map(r => r.dims)
  };
  console.log('BD INTEGRIDAD:', JSON.stringify(bdIntegridad));

  // === 2. CARGAR GOLD-V5 ===
  const goldPath = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
  const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
  const queries = gold.queries.filter(q => q.support_status !== 'UNSUPPORTED');
  console.log('GOLD-V5 queries evaluadas:', queries.length);

  // === 3. EMBEDDING FUNCTION ===
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

  // === 4. EVALUACIÓN COMPLETA ===
  const results = [];
  let hitsAt5 = 0, hitsAt10 = 0, hitsAt20 = 0, hitsAt50 = 0;
  let totalReciprocalRank = 0;
  let querySuccess = 0;

  for (const q of queries) {
    const expectedIds = [...(q.expected_chunks?.core || []), ...(q.expected_chunks?.supporting || [])];
    
    // Generate query embedding
    const queryEmb = await generateEmbedding(q.query);
    const vecStr = '[' + queryEmb.join(',') + ']';
    
    // Retrieve top 100
    const top100Res = await ragPool.query(
      `SELECT chunk_id, 1 - (embedding <=> $1::halfvec) AS similarity
       FROM beauty_knowledge_embeddings
       ORDER BY embedding <=> $1::halfvec
       LIMIT 100`,
      [vecStr]
    );
    const top100 = top100Res.rows.map(r => ({ chunk_id: r.chunk_id, similarity: parseFloat(r.similarity).toFixed(4) }));
    
    // Find ranks of expected chunks
    const expectedRanks = {};
    let firstHitRank = null;
    for (const expectedId of expectedIds) {
      const rank = top100.findIndex(r => r.chunk_id === expectedId);
      expectedRanks[expectedId] = rank >= 0 ? rank + 1 : '>100';
      if (rank >= 0 && (firstHitRank === null || rank < firstHitRank)) {
        firstHitRank = rank;
      }
    }
    
    // Check hits at different K
    let hit5 = false, hit10 = false, hit20 = false, hit50 = false;
    for (let i = 0; i < Math.min(5, top100.length); i++) {
      if (expectedIds.includes(top100[i].chunk_id)) { hit5 = true; break; }
    }
    for (let i = 0; i < Math.min(10, top100.length); i++) {
      if (expectedIds.includes(top100[i].chunk_id)) { hit10 = true; break; }
    }
    for (let i = 0; i < Math.min(20, top100.length); i++) {
      if (expectedIds.includes(top100[i].chunk_id)) { hit20 = true; break; }
    }
    for (let i = 0; i < Math.min(50, top100.length); i++) {
      if (expectedIds.includes(top100[i].chunk_id)) { hit50 = true; break; }
    }
    
    if (hit5) hitsAt5++;
    if (hit10) hitsAt10++;
    if (hit20) hitsAt20++;
    if (hit50) hitsAt50++;
    
    // MRR
    if (firstHitRank !== null) {
      totalReciprocalRank += 1 / (firstHitRank + 1);
    }
    
    // Query success (any expected in top 50)
    const qSuccess = hit50;
    if (qSuccess) querySuccess++;
    
    // Classification
    let classification = 'CORPUS-GAP';
    if (expectedIds.length === 0) classification = 'NO-EXPECTED';
    else if (hit5) classification = 'HIT-AT-5';
    else if (hit20) classification = 'HIT-AT-20';
    else if (hit50) classification = 'HIT-AT-50';
    else if (firstHitRank !== null) classification = 'RETRIEVAL-MISS';
    else classification = 'VECTOR-DRIFT';
    
    results.push({
      query_id: q.query_id,
      query: q.query,
      category: q.category,
      domain: q.domain,
      support_status: q.support_status,
      expected_count: expectedIds.length,
      expected_ids: expectedIds,
      expected_ranks: expectedRanks,
      first_hit_rank: firstHitRank !== null ? firstHitRank + 1 : null,
      hit_at_5: hit5,
      hit_at_10: hit10,
      hit_at_20: hit20,
      hit_at_50: hit50,
      query_success: qSuccess,
      classification,
      top1: top100[0] || null,
      top5: top100.slice(0, 5),
      top10: top100.slice(0, 10),
      top20: top100.slice(0, 20),
      top50: top100.slice(0, 50)
    });
    
    await new Promise(r => setTimeout(r, 100));
  }
  
  // === 5. MÉTRICAS AGREGADAS ===
  const totalQueries = queries.length;
  const metrics = {
    queries_evaluated: totalQueries,
    r_at_5: parseFloat((hitsAt5 / totalQueries).toFixed(4)),
    r_at_10: parseFloat((hitsAt10 / totalQueries).toFixed(4)),
    r_at_20: parseFloat((hitsAt20 / totalQueries).toFixed(4)),
    r_at_50: parseFloat((hitsAt50 / totalQueries).toFixed(4)),
    mrr: parseFloat((totalReciprocalRank / totalQueries).toFixed(4)),
    query_success_rate: parseFloat((querySuccess / totalQueries).toFixed(4)),
    historical_baseline: { r_at_5: 0.7885, mrr: 0.7179 },
    delta: {
      r_at_5: parseFloat(((hitsAt5 / totalQueries) - 0.7885).toFixed(4)),
      mrr: parseFloat(((totalReciprocalRank / totalQueries) - 0.7179).toFixed(4))
    },
    classifications: results.reduce((acc, r) => {
      acc[r.classification] = (acc[r.classification] || 0) + 1;
      return acc;
    }, {}),
    queries_changed: results.filter(r => !r.hit_at_5 && r.classification !== 'NO-EXPECTED').map(r => r.query_id)
  };
  
  console.log('\n=== MÉTRICAS R6 BASELINE ===');
  console.log('R@5:', metrics.r_at_5, '(histórico: 0.7885, delta:', metrics.delta.r_at_5 + ')');
  console.log('R@10:', metrics.r_at_10);
  console.log('R@20:', metrics.r_at_20);
  console.log('R@50:', metrics.r_at_50);
  console.log('MRR:', metrics.mrr, '(histórico: 0.7179, delta:', metrics.delta.mrr + ')');
  console.log('Query Success @50:', metrics.query_success_rate);
  console.log('Clasificaciones:', JSON.stringify(metrics.classifications));
  console.log('Queries que cambiaron (no hit@5):', metrics.queries_changed.length, '/', totalQueries);

  // === 6. REPORTE FINAL ===
  const report = {
    cycle: 'R6-C4',
    run,
    timestamp: new Date().toISOString(),
    bd_integridad: bdIntegridad,
    gold_v5_version: gold.dataset_version || 'unknown',
    metrics,
    query_results: results,
    production_guard: { status: 'PASS', note: 'Local BD only, read-only, no modifications' }
  };

  const outPath = path.join(OUT_DIR, `r6c4_rebaseline_embedding_drift_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\nREPORT:', outPath);
  console.log('VERDICT: PENDING_RUN_B_COMPARISON');

  await ragPool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });