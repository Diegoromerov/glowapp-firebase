require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/embeddings';
const NVIDIA_EMBEDDING_MODEL = process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5';
const MAX_EMBED_CHARS = 1400;

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

async function main() {
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('PRODUCTION DETECTED - ABORT');
    process.exit(1);
  }

  const goldPath = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
  const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
  const queries = gold.queries.filter(q => q.support_status !== 'UNSUPPORTED');
  
  let hitsAt5 = 0, totalReciprocalRank = 0;
  
  for (const q of queries) {
    const emb = await generateEmbedding(q.query);
    const vecStr = '[' + emb.join(',') + ']';
    const res = await ragPool.query(
      `SELECT chunk_id FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT 100`,
      [vecStr]
    );
    const top100 = res.rows.map(r => r.chunk_id);
    const goldIds = [...(q.expected_chunks?.core || []), ...(q.expected_chunks?.supporting || [])];
    
    let hit = false;
    for (let i = 0; i < Math.min(5, top100.length); i++) {
      if (goldIds.includes(top100[i])) {
        hitsAt5++;
        totalReciprocalRank += 1 / (i + 1);
        hit = true;
        break;
      }
    }
    if (!hit) {
      // Check for MRR beyond 5
      for (let i = 5; i < top100.length; i++) {
        if (goldIds.includes(top100[i])) {
          totalReciprocalRank += 1 / (i + 1);
          break;
        }
      }
    }
    console.log(`${q.query_id}: hit@5=${hit}, gold=${goldIds.length}`);
  }
  
  const rAt5 = hitsAt5 / queries.length;
  const mrr = totalReciprocalRank / queries.length;
  
  console.log('\n=== GOLD-V5 RESULTS ===');
  console.log(`Queries evaluated: ${queries.length}`);
  console.log(`R@5: ${rAt5.toFixed(4)} (baseline: 0.7885, delta: ${(rAt5 - 0.7885).toFixed(4)})`);
  console.log(`MRR: ${mrr.toFixed(4)} (baseline: 0.7179, delta: ${(mrr - 0.7179).toFixed(4)})`);
  
  await ragPool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
