/**
 * INGESTOR DE CHUNKS A RAG (pgvector) — con AUTO-SPLIT de chunks largos
 * Uso: node scripts/ingest_json_chunks.js data/corpus/archivo.json
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { ragPool } = require('../src/config/db');

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/embeddings';
const NVIDIA_EMBEDDING_MODEL = process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nemotron-3-embed-1b';
const EXPECTED_DIMS = 2048;

// ---------- Embedding ----------
async function generateEmbedding(text) {
  const response = await fetch(NVIDIA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + NVIDIA_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: NVIDIA_EMBEDDING_MODEL,
      input: [text],
      input_type: 'passage',
      encoding_format: 'float',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error('NVIDIA API ' + response.status + ': ' + errText.substring(0, 200));
  }

  const data = await response.json();
  const embedding = data.data && data.data[0] && data.data[0].embedding;

  if (!embedding || embedding.length !== EXPECTED_DIMS) {
    throw new Error('Embedding con dimensiones incorrectas');
  }
  return embedding;
}

// Devuelve el embedding, o null si el texto excede el límite de tokens
async function tryEmbed(text) {
  try {
    return await generateEmbedding(text);
  } catch (err) {
    if (String(err.message).indexOf('exceeds maximum allowed token size') !== -1) {
      return null;
    }
    throw err;
  }
}

// ---------- AUTO-SPLIT ----------
function splitText(text) {
  const target = text.length / 2;
  let best = -1;
  const re = /[.!?]\s+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const pos = m.index + 1;
    if (best === -1 || Math.abs(pos - target) < Math.abs(best - target)) best = pos;
    if (pos > target + 300) break;
  }
  if (best <= 0) best = Math.floor(target);
  return [text.slice(0, best).trim(), text.slice(best).trim()];
}

// Divide recursivamente hasta que cada parte quepa en el límite
async function chunkToParts(chunk, depth) {
  depth = depth || 0;
  const emb = await tryEmbed(chunk.title + '\n\n' + chunk.content);
  if (emb) return [{ chunk: chunk, embedding: emb }];

  if (depth >= 3 || chunk.content.length < 200) {
    throw new Error('Chunk demasiado largo incluso después de dividir');
  }

  const halves = splitText(chunk.content);
  const partA = Object.assign({}, chunk, { content: halves[0] });
  const partB = Object.assign({}, chunk, { content: halves[1] });

  const partsA = await chunkToParts(partA, depth + 1);
  const partsB = await chunkToParts(partB, depth + 1);
  return partsA.concat(partsB);
}

// ---------- Esquema de la tabla ----------
async function getTableSchema() {
  const res = await ragPool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'beauty_knowledge_embeddings' ORDER BY ordinal_position;"
  );
  const schema = {};
  for (const row of res.rows) schema[row.column_name] = row.data_type;
  return schema;
}

// ---------- Mapeo JSON -> columnas ----------
function extractValue(chunk, columnName) {
  const md = chunk.metadata || {};
  const joinArray = function (arr) { return (Array.isArray(arr) && arr.length) ? arr.join(', ') : null; };

  switch (columnName) {
    case 'title': return chunk.title;
    case 'content': return chunk.content;
    case 'category': return chunk.category;
    case 'risk_level': return chunk.risk_level || md.risk_level || null;
    case 'skin_type': return joinArray(md.skin_types) || md.skin_type || null;
    case 'season_station': return joinArray(md.season) || md.season_station || null;
    case 'age_range': return joinArray(md.age_ranges) || md.age_range || null;
    case 'fototipos': return joinArray(md.fototipos) || null;
    case 'ingredients': return md.ingredients || null;
    case 'contraindications': return md.contraindications || null;
    case 'sources': return chunk.sources ? JSON.stringify(chunk.sources) : null;
    case 'metadata': return JSON.stringify(md);
    default: return md[columnName] !== undefined ? md[columnName] : null;
  }
}

function escapeForPgArray(value) {
  var texto = String(value);
  texto = texto.split('\\').join('\\\\');
  texto = texto.split('"').join('\\"');
  return texto;
}

function formatValue(value, dataType) {
  if (value === null || value === undefined) return null;

  if (dataType === 'ARRAY') {
    var arr = Array.isArray(value) ? value : String(value).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var partes = arr.map(function (v) { return '"' + escapeForPgArray(v) + '"'; });
    return '{' + partes.join(',') + '}';
  }

  if (dataType === 'jsonb' || dataType === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  return value;
}

// ---------- Insertar una parte ----------
async function insertPart(chunk, embedding, schema) {
  const embeddingStr = '[' + embedding.join(',') + ']';
  const columns = [];
  const values = [];
  const placeholders = [];
  let paramIndex = 1;

  for (const columnName of Object.keys(schema)) {
    if (columnName === 'embedding') continue;
    if (['id', 'created_at', 'updated_at', 'chunk_id'].includes(columnName)) continue;

    const dataType = schema[columnName];
    const rawValue = extractValue(chunk, columnName);
    if (rawValue === null || rawValue === undefined) continue;

    columns.push('"' + columnName + '"');
    values.push(formatValue(rawValue, dataType));
    placeholders.push('$' + paramIndex);
    paramIndex++;
  }

  columns.push('embedding');
  placeholders.push('$' + paramIndex + '::halfvec');
  values.push(embeddingStr);

  const insertSql =
    'INSERT INTO beauty_knowledge_embeddings (' + columns.join(', ') + ') ' +
    'VALUES (' + placeholders.join(', ') + ') ' +
    'ON CONFLICT (title) DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding ' +
    'RETURNING (xmax = 0) AS was_inserted;';

  return ragPool.query(insertSql, values);
}

// ---------- Ingesta principal ----------
async function ingestChunks(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ No encuentro el archivo: ' + jsonPath);
    process.exit(1);
  }

  if (!NVIDIA_API_KEY) {
    console.error('❌ Falta la variable NVIDIA_API_KEY');
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, 'utf8');
  const limpio = (raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw).replace(/[\r\n\t-]+/g, ' ');
  const parsed = JSON.parse(limpio);
  const chunks = Array.isArray(parsed) ? parsed : (parsed.chunks || []);
  console.log('📦 Archivo: ' + path.basename(jsonPath));
  console.log('📦 Chunks a procesar: ' + chunks.length + '\n');

  try {
    const before = await ragPool.query('SELECT COUNT(*)::int AS count FROM beauty_knowledge_embeddings');
    console.log('✅ Conectado a la BD RAG (pgvector). Chunks existentes: ' + before.rows[0].count);
  } catch (err) {
    console.error('❌ No pude conectar a la BD RAG:', err.message);
    process.exit(1);
  }

  const schema = await getTableSchema();
  console.log('🔍 Columnas detectadas: ' + Object.keys(schema).join(', ') + '\n');

  if (!schema.embedding) {
    console.error('❌ La tabla no tiene la columna "embedding".');
    process.exit(1);
  }

  let inserted = 0, updated = 0, failed = 0, splitCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const shortTitle = (chunk.title || 'Sin título').substring(0, 45);
    try {
      console.log('[' + (i + 1) + '/' + chunks.length + '] ' + shortTitle + '...');

      const parts = await chunkToParts(chunk);
      if (parts.length > 1) {
        splitCount++;
        console.log('   ✂️  Chunk largo dividido en ' + parts.length + ' partes');
      }

      for (let j = 0; j < parts.length; j++) {
        const finalChunk = Object.assign({}, parts[j].chunk, {
          title: parts.length > 1
            ? chunk.title + ' (parte ' + (j + 1) + ' de ' + parts.length + ')'
            : chunk.title,
        });

        const result = await insertPart(finalChunk, parts[j].embedding, schema);
        if (result.rows[0].was_inserted) { inserted++; console.log('   ✅ Insertado'); }
        else { updated++; console.log('   🔄 Actualizado (ya existía)'); }

        await new Promise(function (r) { setTimeout(r, 250); });
      }
    } catch (err) {
      failed++;
      console.error('   ❌ Error: ' + err.message);
    }
  }

  console.log('\n' + '='.repeat(55));
  console.log('📊 RESUMEN DE LA INGESTA');
  console.log('   ✅ Insertados nuevos : ' + inserted);
  console.log('   🔄 Actualizados      : ' + updated);
  console.log('   ✂️  Chunks divididos  : ' + splitCount);
  console.log('   ❌ Con error         : ' + failed);
  console.log('   📦 Total procesados  : ' + chunks.length);
  console.log('='.repeat(55));

  if (chunks.length > 0 && chunks[0].category) {
    const cat = chunks[0].category;
    const finalRes = await ragPool.query(
      'SELECT COUNT(*)::int AS count FROM beauty_knowledge_embeddings WHERE category = $1',
      [cat]
    );
    console.log('\n🎯 Chunks de "' + cat + '" ahora en la BD: ' + finalRes.rows[0].count);
  }

  process.exit(0);
}

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('❌ Falta la ruta del archivo JSON.');
  console.error('   Uso: node scripts/ingest_json_chunks.js data/corpus/archivo.json');
  process.exit(1);
}

ingestChunks(jsonPath).catch(function (err) {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
