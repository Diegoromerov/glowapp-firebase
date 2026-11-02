/**
 * R6-RECOVERY-2 Final Retry for Last NULL chunks (specific document_id)
 */
require('dotenv').config();
const { ragPool } = require('../src/config/db');

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/embeddings';
const NVIDIA_EMBEDDING_MODEL = process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5';
const EXPECTED_DIMS = 1024;
const DELAY_MS = 200;
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
  if (!response.ok) {
    const errText = await response.text();
    throw new Error('NVIDIA API ' + response.status + ': ' + errText.substring(0, 200));
  }
  const data = await response.json();
  const emb = data.data && data.data[0] && data.data[0].embedding;
  if (!emb || emb.length !== EXPECTED_DIMS) {
    throw new Error('Embedding con dimensiones incorrectas: ' + (emb ? emb.length : 0));
  }
  return emb;
}

async function upsertChunk(chunk) {
  const sql = `
    INSERT INTO beauty_knowledge_embeddings
    (title, category, content, metadata, embedding, document_id, document_version, chunk_id, content_hash, fuente, seccion, updated_at)
    VALUES ($1, $2, $3, $4, $5::halfvec, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT (document_id, chunk_id) DO UPDATE SET
      title = EXCLUDED.title,
      category = EXCLUDED.category,
      content = EXCLUDED.content,
      metadata = EXCLUDED.metadata,
      embedding = EXCLUDED.embedding,
      content_hash = EXCLUDED.content_hash,
      fuente = EXCLUDED.fuente,
      seccion = EXCLUDED.seccion,
      updated_at = NOW()
    RETURNING (xmax = 0) AS inserted;
  `;
  const params = [
    chunk.title || '',
    chunk.category || 'general',
    chunk.content || '',
    JSON.stringify(chunk.metadata || {}),
    '[' + (chunk.embedding).join(',') + ']',
    chunk.document_id,
    chunk.document_version || '1.0',
    chunk.chunk_id,
    chunk.content_hash,
    chunk.fuente || 'unknown',
    chunk.seccion || 'unknown',
  ];
  const res = await ragPool.query(sql, params);
  return res.rows[0].inserted ? 'inserted' : 'updated';
}

async function main() {
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 PRODUCTION DETECTED - ABORT');
    process.exit(1);
  }
  console.log('✅ ENV GUARD: PASS (local)');

  // These are the specific (chunk_id, document_id) pairs that are still NULL
  const nullPairs = [
    { chunk_id: 'skincare-neurocosmetica-008', document_id: 'skincare_rutinas_por_tipo_piel' },
    { chunk_id: 'colorimetria-interaccion-farmacos-001', document_id: 'colorimetria_capilar_tinte' },
    { chunk_id: 'skincare-neurocosmetica-005', document_id: 'skincare_rutinas_por_tipo_piel' }
  ];

  for (const pair of nullPairs) {
    const dbRes = await ragPool.query(
      'SELECT title, category, content, metadata, document_id, document_version, chunk_id, content_hash, fuente, seccion FROM beauty_knowledge_embeddings WHERE chunk_id = $1 AND document_id = $2',
      [pair.chunk_id, pair.document_id]
    );
    if (dbRes.rows.length > 0) {
      const c = dbRes.rows[0];
      try {
        const text = (c.title || '') + '\n\n' + (c.content || '').substring(0, 4000);
        const embedding = await generateEmbedding(text);
        await upsertChunk({ ...c, embedding });
        console.log(`${pair.chunk_id} | ${pair.document_id} ✓`);
      } catch (err) {
        console.error(`${pair.chunk_id} | ${pair.document_id} ✗ ${err.message}`);
      }
    } else {
      console.log(`${pair.chunk_id} | ${pair.document_id} NOT FOUND`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  const finalState = await ragPool.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE embedding IS NULL) AS nulls,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS nonnulls
    FROM beauty_knowledge_embeddings
  `);
  console.log('FINAL STATE:', JSON.stringify(finalState.rows[0]));
  await ragPool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });