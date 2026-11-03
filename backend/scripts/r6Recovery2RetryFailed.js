/**
 * R6-RECOVERY-2 Retry Failed Embeddings
 * Retries only the chunks that have NULL embeddings
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');

const CORPUS_PATH = path.join(__dirname, '..', 'src', 'data', 'corpus_canonico', 'corpus_canonico.json');
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/embeddings';
const NVIDIA_EMBEDDING_MODEL = process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5';
const EXPECTED_DIMS = 1024;
const DELAY_MS = 150; // slightly longer delay for retries
const MAX_EMBED_CHARS = 1400;
const MAX_RETRIES = 3;

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
  // ENV GUARD
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 PRODUCTION DETECTED - ABORT');
    process.exit(1);
  }
  console.log('✅ ENV GUARD: PASS (local)');

  if (!NVIDIA_API_KEY) {
    console.error('❌ Falta NVIDIA_API_KEY');
    process.exit(1);
  }
  if (!fs.existsSync(CORPUS_PATH)) {
    console.error('❌ Corpus no existe:', CORPUS_PATH);
    process.exit(1);
  }

  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
  const chunksMap = new Map(corpus.chunks.map(c => [c.chunk_id, c]));

  // Get NULL chunks from DB
  const nullRes = await ragPool.query('SELECT chunk_id FROM beauty_knowledge_embeddings WHERE embedding IS NULL ORDER BY id');
  const nullChunkIds = nullRes.rows.map(r => r.chunk_id);
  console.log('NULL chunks in DB:', nullChunkIds.length);

  // Match with corpus
  const matched = [];
  const legacy = [];
  for (const id of nullChunkIds) {
    const chunk = chunksMap.get(id);
    if (chunk) {
      matched.push(chunk);
    } else {
      legacy.push(id);
    }
  }
  console.log('Matched with corpus:', matched.length);
  console.log('Legacy (hash IDs not in corpus):', legacy.length);

  // Process matched chunks with retries
  let success = 0, failed = 0;
  const errors = [];

  for (let i = 0; i < matched.length; i++) {
    const c = matched[i];
    let retries = 0;
    let done = false;

    while (retries < MAX_RETRIES && !done) {
      try {
        const text = (c.title || '') + '\n\n' + (c.content || '').substring(0, 4000);
        const embedding = await generateEmbedding(text);
        await upsertChunk({ ...c, embedding });
        success++;
        done = true;
        console.log(`  [${i+1}/${matched.length}] ${c.chunk_id} ✓`);
      } catch (err) {
        retries++;
        console.log(`  [${i+1}/${matched.length}] ${c.chunk_id} retry ${retries}/${MAX_RETRIES}: ${err.message}`);
        if (retries >= MAX_RETRIES) {
          failed++;
          errors.push({ chunk_id: c.chunk_id, error: err.message });
        }
        await new Promise(r => setTimeout(r, DELAY_MS * retries));
      }
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // For legacy chunks, we need to get their content from DB
  if (legacy.length > 0) {
    console.log('\nProcessing legacy chunks...');
    for (const chunkId of legacy) {
      const dbRes = await ragPool.query(
        'SELECT title, category, content, metadata, document_id, document_version, chunk_id, content_hash, fuente, seccion FROM beauty_knowledge_embeddings WHERE chunk_id = $1',
        [chunkId]
      );
      if (dbRes.rows.length > 0) {
        const c = dbRes.rows[0];
        let retries = 0;
        let done = false;
        while (retries < MAX_RETRIES && !done) {
          try {
            const text = (c.title || '') + '\n\n' + (c.content || '').substring(0, 4000);
            const embedding = await generateEmbedding(text);
            await upsertChunk({ ...c, embedding });
            success++;
            done = true;
            console.log(`  LEGACY ${chunkId} ✓`);
          } catch (err) {
            retries++;
            console.log(`  LEGACY ${chunkId} retry ${retries}/${MAX_RETRIES}: ${err.message}`);
            if (retries >= MAX_RETRIES) {
              failed++;
              errors.push({ chunk_id: chunkId, error: err.message });
            }
            await new Promise(r => setTimeout(r, DELAY_MS * retries));
          }
        }
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }
  }

  console.log('\n=== RETRY SUMMARY ===');
  console.log('Total NULL chunks:', nullChunkIds.length);
  console.log('Matched with corpus:', matched.length);
  console.log('Legacy:', legacy.length);
  console.log('Success:', success);
  console.log('Failed:', failed);
  if (errors.length > 0) console.log('Errors:', JSON.stringify(errors, null, 2));

  // Final state
  const finalState = await ragPool.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE embedding IS NULL) AS nulls,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS nonnulls
    FROM beauty_knowledge_embeddings
  `);
  console.log('FINAL STATE:', JSON.stringify(finalState.rows[0]));

  await ragPool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });