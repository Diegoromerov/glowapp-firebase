#!/usr/bin/env node
/**
 * backend/scripts/rebuildEvaluationDataset.js
 * R5-A — Reconstrucción del dataset de evaluación contra el CORPUS CANÓNICO
 *
 * Método (determinista, no inventa chunks):
 * 1. Carga corpus_canonico.json (5,619 chunks con chunk_id, title, content, category)
 * 2. Para cada una de las 30 queries del dataset original:
 *    a. Tokens significativos de la query + expected_answer_keywords
 *    b. Score de cada chunk canónico = coincidencia de tokens (peso 2 si está en title, 1 en content)
 *    c. Se seleccionan los chunks con score >= umbral (top-K)
 * 3. Clasificación:
 *    - Si hay chunks relevantes → VALID, expected_chunks = chunk_ids reales
 *    - Si NO hay chunks relevantes → UNSUPPORTED_BY_CORPUS (no se fabrica nada)
 * 4. Escribe evaluation_dataset.json (v2) + dataset_manifest.json
 *
 * Uso: node scripts/rebuildEvaluationDataset.js
 */

const fs = require('fs');
const path = require('path');

const CORPUS_PATH = path.join(__dirname, '..', 'src', 'data', 'corpus_canonico', 'corpus_canonico.json');
const DATASET_PATH = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset.json');
const OUT_PATH = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const MANIFEST_PATH = path.join(__dirname, '..', 'src', 'data', 'eval', 'dataset_manifest_v2.json');

// ── Stopwords español ──
const STOPWORDS = new Set(`
el la los las un una unos unas y o u pero si no de del en con por para que es son
está están como qué cuál cuándo dónde cómo quién mi tu su me te se nos les lo le a al
ante bajo cabe contra desde durante entre hacia hasta mediante según sin so sobre tras
versus vía mas menos muy mucho mucha muchos muchas poco poca pocos pocas otro otra
otros otras este esta estos estas ese esa esos esas aquel aquella aquellos aquellas
ser haber estar tener hacer poner decir ver parecer quedar quedar quedar mejor
también más ahí allí aquí allá cuando donde quien cuales cual cosa cosas
`.trim().split(/\s+/));

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function tokenSet(...texts) {
  const tokens = {};
  for (const t of texts) {
    for (const w of normalize(t)) tokens[w] = true;
  }
  return tokens;
}

// ── Cargar corpus canónico ──
const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
const chunks = corpus.chunks;
console.log(`📚 Corpus canónico: ${chunks.length} chunks`);

// Indexar chunks por tokens
const chunkIndex = chunks.map((c, i) => {
  const titleTokens = new Set(normalize(c.title));
  const contentTokens = new Set(normalize(c.content));
  return { c, i, titleTokens, contentTokens };
});

// ── Cargar dataset original ──
const ds = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
console.log(`📋 Dataset original: ${ds.queries.length} queries`);

// ── Reconstruir por query ──
const results = [];
const stats = { valid: 0, unsupported: 0, invalid_query: 0 };

for (const q of ds.queries) {
  const queryTokens = tokenSet(q.query, ...(q.expected_answer_keywords || []));
  const queryTokenList = Object.keys(queryTokens);

  // Score por chunk: coincidencia de tokens en title (x2) y content (x1)
  const scored = chunkIndex.map(({ c, titleTokens, contentTokens }) => {
    let titleHits = 0, contentHits = 0;
    for (const t of queryTokenList) {
      if (titleTokens.has(t)) titleHits++;
      else if (contentTokens.has(t)) contentHits++;
    }
    const score = titleHits * 2 + contentHits;
    return { chunk: c, score, titleHits, contentHits };
  });

  // CRITERIO ESTRICTO (anti-falsos-positivos):
  // - Al menos 1 token distintivo en el TÍTULO del chunk (no solo contenido)
  // - Score mínimo 5 (p.ej. 2 tokens en título + 1 en contenido, o 1 título + 3 contenido)
  // - Con esto un chunk "de relleno" que solo comparte una palabra genérica NO califica
  const relevant = scored
    .filter(s => s.titleHits >= 1 && s.score >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  let status, expectedChunks = [];
  if (relevant.length >= 1) {
    status = 'VALID';
    expectedChunks = relevant.map(r => r.chunk.chunk_id);
    stats.valid++;
  } else {
    status = 'UNSUPPORTED_BY_CORPUS';
    stats.unsupported++;
  }

  results.push({
    id: q.id,
    category: q.category,
    difficulty: q.difficulty,
    query: q.query,
    expected_answer_keywords: q.expected_answer_keywords || [],
    expected_category: q.expected_category,
    metadata_filters: q.metadata_filters || {},
    status,
    expected_chunks: expectedChunks,
    matched_candidates: relevant.map(r => ({
      chunk_id: r.chunk.chunk_id,
      document_id: r.chunk.document_id,
      score: r.score,
      title: (r.chunk.title || '').slice(0, 80),
    })),
  });

  console.log(`${status === 'VALID' ? '✅' : '⚠️'} ${q.id} [${q.category}/${q.difficulty}]: ${q.query.slice(0, 50)} → ${expectedChunks.length} chunks (top score ${relevant[0]?.score || 0})`);
}

// ── Verificar unicidad de expected_chunks ──
const allExpected = results.flatMap(r => r.expected_chunks);
const dupExpected = allExpected.filter((id, i) => allExpected.indexOf(id) !== i);

// ── Escribir salida ──
const output = {
  version: '2.0',
  description: 'Dataset de evaluación reconstruido contra CORPUS CANÓNICO (R5-A). expected_chunks = chunk_ids REALES del corpus canónico.',
  corpus_version: corpus.corpus_version,
  corpus_source: 'backend/src/data/corpus_canonico/corpus_canonico.json',
  generated_at: new Date().toISOString(),
  categories: ds.categories,
  validation: {
    total_queries: results.length,
    valid: stats.valid,
    unsupported_by_corpus: stats.unsupported,
    invalid_query: stats.invalid_query,
    expected_chunks_total: allExpected.length,
    expected_chunks_unique: new Set(allExpected).size,
    duplicate_expected_chunks: dupExpected.length,
  },
  queries: results,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));

// Manifest del dataset
const manifest = {
  dataset_version: '2.0',
  generated_at: output.generated_at,
  method: 'Léxico determinista: tokens de query + expected_answer_keywords contra título (x2) y contenido (x1) del corpus canónico. Umbral score >= 3. Top-5 chunks.',
  corpus: {
    path: CORPUS_PATH,
    version: corpus.corpus_version,
    chunks: chunks.length,
  },
  validation: output.validation,
  unsupported_queries: results.filter(r => r.status === 'UNSUPPORTED_BY_CORPUS').map(r => ({ id: r.id, query: r.query })),
  note: 'No se fabricaron expected_chunks. Las queries UNSUPPORTED_BY_CORPUS requieren ampliar el corpus o decisión del Director.',
};
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

console.log(`\n📊 RESUMEN: ${stats.valid} VALID | ${stats.unsupported} UNSUPPORTED | ${stats.invalid_query} INVALID`);
console.log(`   Expected chunks totales: ${allExpected.length} (únicos: ${new Set(allExpected).size}, duplicados: ${dupExpected.length})`);
console.log(`📁 Salida: ${OUT_PATH}`);
console.log(`📁 Manifest: ${MANIFEST_PATH}`);
