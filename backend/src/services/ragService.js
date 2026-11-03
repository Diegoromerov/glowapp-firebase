/**
 * Servicio RAG (Retrieval-Augmented Generation) para GlowApp
 * Busca conocimiento técnico y regulatorio de belleza con aislamiento Multi-Tenant (BUS-RAG-001)
 *
 * Pipeline:
 *   1. embedding real de la consulta vía embeddingService (NVIDIA NIM + circuit breaker, SIN dummy)
 *   2. búsqueda vectorial pgvector (HNSW, similitud coseno) con filtros de metadata, tenant y vigencia
 *   3. si el paso 1 o 2 fallan → fallback full-text (tsvector español) sobre la misma tabla
 *   El tenant viaja SIEMPRE como parámetro ligado ($n), nunca interpolado en el SQL.
 *
 * Evidence Layer (Fase C, AUD-RAGAURA-01 · P0 #2):
 *   El retrieval se envuelve con la capa de evidencia:
 *     chunks → Evidence (identidad, rank, provenance) → Sufficiency Gate
 *     (SUPPORTED / PARTIAL / UNSUPPORTED / RETRIEVAL_UNCERTAIN) → EvidencePacket
 *   `searchWithEvidence()` es el punto de integración; el contrato de
 *   `searchBeautyKnowledge()` no cambia.
 *
 * Filtros (Fase 1, 2026-09-23):
 *   - Los predicados apuntan a los CAMPOS QUE LA INGESTA REALMENTE ESCRIBE. La ingesta
 *     canónica (`ingestCanonicalCorpus.js`) escribe: title, category, content, metadata,
 *     embedding, document_id, document_version, chunk_id, content_hash, fuente, seccion.
 *     Las columnas `skin_type`, `ingredients` y `contraindications` quedan NULL: los datos
 *     viven en `metadata->'skin_types' | 'ingredients' | 'contraindications'`.
 *   - Un `category` fuera del vocabulario canónico (`config/knowledgeCategories.js`) NO se
 *     aplica como filtro: se registra en la traza y se busca sin él (fail-open). Antes
 *     devolvía 0 filas en silencio, con apariencia de "no hay información".
 *   - Si la búsqueda filtrada devuelve 0 filas, se reintenta UNA vez sin filtros de metadata
 *     (la condición de tenant y la vigencia NUNCA se relajan) y se marca `relaxed`.
 *   - El fallback full-text ya no inventa `similarity = 0.5`: devuelve `similarity = null`
 *     y `mode = 'fts'`, para que nadie presente una similitud que no se midió.
 */

require('dotenv').config();
const crypto = require('crypto');
const { ragPool, pool } = require('../config/db');
const { RAG_SIMILARITY_THRESHOLD } = require('../config/ragConfig');
const { generateEmbedding: generateQueryEmbedding } = require('./embeddingService');
const { resolveCategory } = require('../config/knowledgeCategories');

// Dimensión del modelo de embeddings VIVO (nvidia/nemotron-3-embed-1b, 2048d).
// Debe coincidir con embeddingService.expectedDimension y con el DDL de la columna
// beauty_knowledge_embeddings.embedding (migración 073). Ver tests/rag.embedding-dimension.test.js.
const EXPECTED_DIMS = 2048;

/**
 * Filtros de ALCANCE: acotan de qué trata la respuesta (normativa vs belleza). NO se relajan
 * nunca: si el dominio no tiene documentos, devolver contenido de otro dominio rotulado como
 * regulatorio sería peor que no devolver nada. El resto de filtros (category, skin_type,
 * ingredients, contraindications) son PISTAS de relevancia y sí pueden relajarse.
 */
const SCOPE_FILTERS = ['domain', 'jurisdiction'];

// ─── Generar embedding de la consulta ───────────────────────────────
async function generateEmbedding(text) {
  // Sin vector fabricado: si NVIDIA no está disponible, esto lanza y el retrieval
  // degrada a full-text (nunca se busca con un embedding sin valor semántico).
  const embedding = await generateQueryEmbedding(text, 'query');

  if (!Array.isArray(embedding) || embedding.length !== EXPECTED_DIMS) {
    throw new Error(`Embedding inválido: ${Array.isArray(embedding) ? embedding.length : 0} dims`);
  }

  return embedding;
}

/**
 * Predicado para un filtro sobre una lista JSONB de metadata (skin_types, ingredients,
 * contraindications). Compara cada elemento de la lista, no el JSON entero: el ILIKE
 * sobre `metadata::text` coincidía con nombres de archivo y textos no relacionados.
 *
 * @param {string} key - clave de metadata (ej. 'skin_types')
 * @param {number} paramIndex
 * @param {object} options - { includeUniversal: boolean } añade los valores universales
 *                           ('all' | 'todas' | 'todos'), que marcan contenido válido para
 *                           cualquier caso: 4.526 de 5.619 chunks están etiquetados 'all'.
 * @returns {string} condición SQL con `$n` ligado
 */
function jsonbListMatch(key, paramIndex, options = {}) {
  const universal = options.includeUniversal
    ? ` OR lower(st) IN ('all', 'todas', 'todos')`
    : '';
  return `EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(COALESCE(metadata->'${key}', '[]'::jsonb)) AS st
            WHERE st ILIKE $${paramIndex}${universal}
          )`;
}

// ─── Construir filtros de metadata ───────────────────────────────────
/**
 * @param {object} filters - filtros solicitados
 * @param {number} startIndex - primer índice de parámetro disponible
 * @param {object} [trace] - objeto de traza que se completa con lo aplicado/descartado
 * @returns {{whereClause: string, params: Array, nextIndex: number, applied: object, dropped: Array}}
 */
function buildMetadataFilters(filters = {}, startIndex = 1, trace = null) {
  const conditions = [];
  const params = [];
  let paramIndex = startIndex;
  const applied = {};
  const dropped = [];

  if (filters.skin_type && filters.skin_type !== 'all') {
    conditions.push(jsonbListMatch('skin_types', paramIndex, { includeUniversal: true }));
    params.push(`%${filters.skin_type}%`);
    applied.skin_type = filters.skin_type;
    paramIndex++;
  }

  if (filters.category) {
    const category = resolveCategory(filters.category);
    if (category) {
      conditions.push(`category = $${paramIndex}`);
      params.push(category);
      applied.category = category;
      paramIndex++;
    } else {
      // Fail-open: filtrar por un valor inexistente devolvía 0 filas sin explicación.
      dropped.push({ filter: 'category', value: String(filters.category), reason: 'not_in_canonical_vocabulary' });
    }
  }

  if (filters.domain) {
    // `domain` se compara contra los campos que existen: la categoría canónica o los
    // módulos aplicables. El corpus NO tiene `metadata->>'domain'` (0 de 5.619 chunks):
    // ese predicado devolvía vacío siempre. Si el dominio no existe en el corpus, la
    // búsqueda puede quedar vacía legítimamente (p. ej. 'BUSINESS': el corpus canónico
    // no contiene documentos regulatorios), y la traza lo deja registrado.
    const domain = resolveCategory(filters.domain);
    conditions.push(`(category = $${paramIndex} OR metadata->'applicable_modules' ? $${paramIndex})`);
    params.push(domain || String(filters.domain));
    applied.domain = domain || String(filters.domain);
    paramIndex++;
  }

  if (filters.jurisdiction) {
    // `metadata->>'jurisdiction'` no existe en el corpus canónico (0 de 5.619): se mantiene
    // el predicado por contrato, pero queda registrado en la traza para que un resultado
    // vacío sea diagnosticable en lugar de silencioso.
    conditions.push(`metadata->>'jurisdiction' = $${paramIndex}`);
    params.push(filters.jurisdiction);
    applied.jurisdiction = filters.jurisdiction;
    paramIndex++;
  }

  if (filters.contraindications && Array.isArray(filters.contraindications)) {
    filters.contraindications.forEach(c => {
      conditions.push(jsonbListMatch('contraindications', paramIndex));
      params.push(`%${c}%`);
      paramIndex++;
    });
    applied.contraindications = filters.contraindications;
  }

  if (filters.ingredients && Array.isArray(filters.ingredients)) {
    filters.ingredients.forEach(i => {
      conditions.push(jsonbListMatch('ingredients', paramIndex));
      params.push(`%${i}%`);
      paramIndex++;
    });
    applied.ingredients = filters.ingredients;
  }

  if (trace) {
    trace.filters_applied = applied;
    trace.filters_dropped = dropped;
  }

  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '';

  return { whereClause, params, nextIndex: paramIndex, applied, dropped };
}

/**
 * Añade la condición de aislamiento multi-tenant con parámetro LIGADO ($n).
 * Con tenantId: conocimiento GLOBAL (tenant_id IS NULL) o propio del tenant.
 * Sin tenantId: solo GLOBAL.
 * Devuelve el siguiente índice de parámetro disponible.
 */
function appendTenantCondition(additionalConditions, params, paramIndex, tenantId) {
  if (tenantId) {
    additionalConditions.push(`(tenant_id IS NULL OR tenant_id::text = $${paramIndex})`);
    params.push(String(tenantId));
    return paramIndex + 1;
  }

  additionalConditions.push(`tenant_id IS NULL`);
  return paramIndex;
}

// Columnas que devuelve todo retrieval: identidad del chunk para citar en la respuesta.
const SELECTED_COLUMNS = `
        id,
        title,
        content,
        category,
        metadata,
        tenant_id,
        expires_at,
        chunk_id,
        document_id,
        fuente,
        seccion`;

/**
 * Búsqueda vectorial. `useMetadataFilters = false` permite el reintento relajado.
 * La condición de tenant y la vigencia (soft delete / expiración) NUNCA se relajan.
 */
async function runVectorSearch({ queryEmbedding, filters, tenantId, threshold, topK, useMetadataFilters = true }) {
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  // $1 = vector de la consulta; los filtros de metadata empiezan en $2
  const { whereClause, params: filterParams, nextIndex, applied, dropped } =
    buildMetadataFilters(useMetadataFilters ? filters : {}, 2, null);

  const additionalConditions = [];
  if (whereClause) {
    additionalConditions.push(`(${whereClause})`);
  }

  // MULTI-TENANT ISOLATION BOUNDARY (BUS-RAG-001):
  // Permite conocimiento GLOBAL (tenant_id IS NULL) O conocimiento propio del tenant especificado.
  // IMPIDE terminantemente la filtración de documentos privados de otros tenants.
  const queryParams = [embeddingStr, ...filterParams];
  let paramIndex = appendTenantCondition(additionalConditions, queryParams, nextIndex, tenantId);

  // Soft delete & Expiration
  additionalConditions.push(`deleted_at IS NULL`);
  additionalConditions.push(`(expires_at IS NULL OR expires_at > NOW())`);

  const thresholdIndex = paramIndex;
  const limitIndex = paramIndex + 1;
  queryParams.push(threshold, topK);

  const finalWhere = additionalConditions.length > 0 ? `WHERE ${additionalConditions.join(' AND ')}` : '';

  const sql = `
      SELECT${SELECTED_COLUMNS},
        1 - (embedding <=> $1::halfvec) AS similarity
      FROM beauty_knowledge_embeddings
      ${finalWhere}
      ${finalWhere ? 'AND' : 'WHERE'} 1 - (embedding <=> $1::halfvec) >= $${thresholdIndex}
      ORDER BY embedding <=> $1::halfvec
      LIMIT $${limitIndex};
    `;

  const dbPool = ragPool || pool;
  const result = await dbPool.query(sql, queryParams);

  return {
    rows: result.rows.map(r => ({ ...r, similarity: parseFloat(r.similarity), mode: 'hnsw' })),
    applied,
    dropped,
  };
}

/** Fallback full-text. Sin filtros de metadata cuando `useMetadataFilters = false`. */
async function runFullTextSearch({ query, filters, tenantId, topK, useMetadataFilters = true }) {
  // $1 = query, $2 = patrón ILIKE, $3 = LIMIT; los filtros de metadata empiezan en $4
  const { whereClause, params: filterParams, nextIndex, applied, dropped } =
    buildMetadataFilters(useMetadataFilters ? filters : {}, 4, null);
  const textCondition = `(to_tsvector('spanish', title || ' ' || content) @@ plainto_tsquery('spanish', $1) OR title ILIKE $2 OR content ILIKE $2)`;

  const additionalConditions = [textCondition];
  if (whereClause) {
    additionalConditions.push(`(${whereClause})`);
  }

  const fallbackParams = [query, `%${query}%`, topK, ...filterParams];
  appendTenantCondition(additionalConditions, fallbackParams, nextIndex, tenantId);

  additionalConditions.push(`deleted_at IS NULL`);
  additionalConditions.push(`(expires_at IS NULL OR expires_at > NOW())`);

  const finalWhere = `WHERE ${additionalConditions.join(' AND ')}`;

  const fallbackSql = `
        SELECT${SELECTED_COLUMNS},
          NULL::double precision AS similarity
        FROM beauty_knowledge_embeddings
        ${finalWhere}
        LIMIT $3;
      `;

  const dbPool = ragPool || pool;
  const fallbackResult = await dbPool.query(fallbackSql, fallbackParams);

  // similarity null: el full-text no mide similitud coseno y no se inventa un valor.
  return {
    rows: fallbackResult.rows.map(r => ({ ...r, similarity: r.similarity === null ? null : parseFloat(r.similarity), mode: 'fts' })),
    applied,
    dropped,
  };
}

// ─── FASE 2: ranking léxico + fusión RRF ────────────────────────────────────────────────
/** Tamaño del pool de candidatos por rama antes de fusionar (el "top-50" del plan). */
const RRF_POOL = 50;
/**
 * Constante de RRF y peso del brazo léxico, elegidos por barrido sobre GOLD-V5
 * (18 consultas, topK=5, umbral 0.30):
 *
 *   k   | peso léxico | R@5    | recall core | MRR
 *   60  | 1.0         | 0.3426 | 0.3333      | 0.3889
 *   60  | 0.6         | 0.3657 | 0.3333      | 0.3704
 *   20  | 1.0         | 0.3287 | 0.3111      | 0.4028
 *   20  | 0.6         | 0.3519 | 0.3556      | 0.3843   <- única que no baja ninguna métrica
 *   10  | 0.6         | 0.3380 | 0.3333      | 0.4120
 *
 * El léxico pesa menos que el vectorial porque en preguntas naturales aporta ruido
 * (términos frecuentes como "piel" o "tratamiento"), pero sigue subiendo el recall.
 */
const RRF_K = 20;
const DEFAULT_LEXICAL_WEIGHT = 0.6;

/**
 * Búsqueda léxica ordenada por relevancia.
 * Diferencias con `runFullTextSearch` (que sigue siendo el fallback de emergencia):
 *   - `websearch_to_tsquery` entiende preguntas naturales mejor que `plainto_tsquery`
 *   - ordena por `ts_rank_cd`, no por el orden físico de la tabla
 *   - conserva ILIKE como red cuando el tsquery sale vacío (preguntas con solo stopwords)
 */
async function runLexicalSearch({ query, filters, tenantId, topK, useMetadataFilters = true }) {
  const { whereClause, params: filterParams, nextIndex, applied, dropped } =
    buildMetadataFilters(useMetadataFilters ? filters : {}, 4, null);

  // Columna generada (migración 115): el tsvector se calcula al escribir, no en cada consulta.
  const vectorText = 'search_vector';

  // `websearch_to_tsquery` une los términos con AND, y con una pregunta real eso deja
  // 3 candidatos de 5.619. Se pasan los términos unidos por OR (sintaxis de websearch)
  // para que la rama léxica aporte un pool comparable al vectorial y RRF tenga de dónde elegir.
  const terms = extractQueryTerms(query);
  const tsQueryText = terms.length ? terms.join(' or ') : query;

  const additionalConditions = [`${vectorText} @@ websearch_to_tsquery('spanish', $1)`];
  if (whereClause) additionalConditions.push(`(${whereClause})`);

  const params = [tsQueryText, topK, ...filterParams];
  appendTenantCondition(additionalConditions, params, nextIndex, tenantId);
  additionalConditions.push('deleted_at IS NULL');
  additionalConditions.push('(expires_at IS NULL OR expires_at > NOW())');

  const sql = `
        SELECT${SELECTED_COLUMNS},
          ts_rank_cd(${vectorText}, websearch_to_tsquery('spanish', $1))::double precision AS lexical_score
        FROM beauty_knowledge_embeddings
        WHERE ${additionalConditions.join(' AND ')}
        ORDER BY lexical_score DESC, id
        LIMIT $2::int;
      `;

  const dbPool = ragPool || pool;
  const result = await dbPool.query(sql, params);
  return {
    rows: result.rows.map(r => ({
      ...r,
      lexical_score: Number(r.lexical_score) || 0,
      similarity: null,
      mode: 'lexical',
    })),
    applied,
    dropped,
  };
}

/**
 * Reciprocal Rank Fusion: cada rama aporta 1/(k + rank). No compara escalas
 * (coseno vs ts_rank) — solo posiciones, que es exactamente el problema a resolver.
 * Deduplica por `chunk_id` quedándose con la mejor posición de cada rama.
 */
function rrfFuse(vectorRows, lexicalRows, { k = RRF_K, topK = 5, lexicalWeight = 1 } = {}) {
  const byId = new Map();

  const add = (rows, branch) => {
    const branchWeight = branch === 'lexical' ? lexicalWeight : 1;
    rows.forEach((row, index) => {
      const id = row.chunk_id || `id:${row.id}`;
      const contribution = branchWeight / (k + index + 1);
      const current = byId.get(id) || { row: { ...row }, rrf: 0, branches: [] };
      if (!current.branches.includes(branch)) {
        current.rrf += contribution;
        current.branches.push(branch);
      }
      // La similitud coseno, si existe, manda para mostrar; el léxico no la inventa.
      if (row.similarity !== null && row.similarity !== undefined) {
        current.row.similarity = row.similarity;
      }
      if (row.lexical_score !== undefined) {
        current.row.lexical_score = row.lexical_score;
      }
      byId.set(id, current);
    });
  };

  add(vectorRows, 'vector');
  add(lexicalRows, 'lexical');

  return [...byId.values()]
    .sort((a, b) => b.rrf - a.rrf || (b.row.similarity || 0) - (a.row.similarity || 0))
    .slice(0, topK)
    .map(({ row, rrf, branches }) => ({
      ...row,
      rrf_score: round3(rrf),
      branches,
      mode: branches.length > 1 ? 'hybrid' : branches[0],
    }));
}

/**
 * Rerank determinista del pool fusionado (FASE 2.3).
 *
 * El pool llega con R@50 = 0.664 pero R@5 = 0.317: los aciertos están ahí, el orden
 * no. Este rerank no inventa señal nueva, pondera tres que ya existen y que RRF
 * ignora: cuánto de la consulta aparece en el texto, si aparece en el título, y la
 * posición que dio la fusión.
 *
 * Pesos elegidos por barrido sobre GOLD-V5 (ver docs/rag-audit-2026-09-22/FASE2_RANKING.md);
 * sin dependencias externas, ~0 ms y reproducible.
 */
const DEFAULT_RERANK_WEIGHTS = { rrf: 0.5, coverage: 0.3, title: 0.2 };

function resolveWeights(weights) {
  if (Array.isArray(weights) && weights.length === 3 && weights.every((n) => Number.isFinite(n) && n >= 0)) {
    const [rrf, coverage, title] = weights;
    if (rrf + coverage + title > 0) return { rrf, coverage, title };
  }
  return DEFAULT_RERANK_WEIGHTS;
}

function rerankCandidates(candidates, query, { topK = 5, weights = null } = {}) {
  if (!candidates.length) return candidates;

  const terms = extractQueryTerms(query);
  const maxRrf = Math.max(...candidates.map((c) => c.rrf_score || 0), 1e-9);
  const W = resolveWeights(weights);

  const scored = candidates.map((c) => {
    const normRrf = (c.rrf_score || 0) / maxRrf;
    const text = normalizeForMatching(`${c.title || ''} ${c.content || ''}`);
    const titleText = normalizeForMatching(c.title || '');

    const coverage = terms.length ? terms.filter((t) => text.includes(t)).length / terms.length : 1;
    const titleHit = terms.length ? terms.filter((t) => titleText.includes(t)).length / terms.length : 0;

    return {
      ...c,
      rerank_score: round3(W.rrf * normRrf + W.coverage * coverage + W.title * titleHit),
      rerank: { coverage: round3(coverage), title_hit: round3(titleHit) },
    };
  });

  scored.sort(
    (a, b) => b.rerank_score - a.rerank_score || (b.similarity || 0) - (a.similarity || 0)
  );
  return scored.slice(0, topK);
}

// ─── Búsqueda principal con aislamiento Multi-Tenant ────────────────────────────────────
/**
 * @param {string} query - consulta del usuario
 * @param {object} [options] - { topK, threshold, filters, tenantId, trace }
 *   `trace` (opcional) se completa con: mode, threshold_used, filters_applied,
 *   filters_dropped, filters_relaxed, fallback_triggered, fallback_reason, all_scores.
 * @returns {Promise<Array>} chunks con similarity (null si vino del fallback full-text)
 */
async function searchBeautyKnowledge(query, options = {}) {
  const {
    topK = 5,
    threshold = RAG_SIMILARITY_THRESHOLD,
    filters = {},
    tenantId = null,
    trace = null,
    mode = 'hybrid',
  } = options;

  if (trace) {
    trace.threshold_used = threshold;
    trace.top_k = topK;
    trace.ranking = mode;
    trace.fallback_triggered = false;
    trace.filters_relaxed = false;
    trace.mode = null;
  }

  // Sólo se relaja si hay filtros que son pistas de relevancia (nunca filtros de alcance).
  const hasRelaxableFilters = Object.keys(filters || {}).some(k => !SCOPE_FILTERS.includes(k));
  const poolSize = mode === 'hybrid' ? Math.max(topK, RRF_POOL) : topK;
  // Rerank apagado por defecto: el barrido de pesos mostró que cambia recall por MRR
  // (mejor caso 0.7/0.2/0.1 → MRR 0.479 pero R@5 0.284; baseline R@5 0.306). Se activa
  // con `rerank: true` + `rerankWeights` cuando el producto priorice el primer acierto.
  const wantsRerank = mode === 'hybrid' && options.rerank === true;

  try {
    const embStart = Date.now();
    const queryEmbedding = await generateEmbedding(query);
    if (trace) {
      trace.query_embedding_latency_ms = Date.now() - embStart;
    }

    // Rama léxica + fusión RRF (FASE 2). Si la rama léxica falla, el híbrido
    // degrada a vectorial: un problema del índice de texto no puede tumbar la búsqueda.
    const runHybrid = async (useMetadataFilters) => {
      const vector = await runVectorSearch({
        queryEmbedding, filters, tenantId, threshold, topK: poolSize, useMetadataFilters,
      });
      let lexical = { rows: [], applied: [] };
      try {
        lexical = await runLexicalSearch({
          query, filters, tenantId, topK: poolSize, useMetadataFilters,
        });
      } catch (lexError) {
        if (trace) trace.lexical_error = lexError.message;
      }
      const fused = rrfFuse(vector.rows, lexical.rows, {
        topK: poolSize,
        k: options.rrfK || RRF_K,
        lexicalWeight: options.lexicalWeight === undefined ? DEFAULT_LEXICAL_WEIGHT : options.lexicalWeight,
      });
      return {
        rows: wantsRerank ? rerankCandidates(fused, query, { topK, weights: options.rerankWeights }) : fused.slice(0, topK),
        fused_count: fused.length,
        applied: vector.applied,
        dropped: vector.dropped,
        candidates: { vector: vector.rows.length, lexical: lexical.rows.length },
      };
    };

    if (mode === 'hybrid') {
      let attempt = await runHybrid(true);

      // Misma red de seguridad que la ruta vectorial: un filtro de metadata que el
      // corpus no tiene devolvía 0 filas como si no hubiera conocimiento.
      if (attempt.rows.length === 0 && hasRelaxableFilters) {
        const relaxed = await runHybrid(false);
        if (relaxed.rows.length > 0) {
          if (trace) {
            trace.filters_relaxed = true;
            trace.relaxed_reason = '0 filas con filtros de metadata; reintento sin filtros (tenant y vigencia intactos)';
          }
          attempt = { ...relaxed, dropped: attempt.dropped };
        }
      }

      if (trace) {
        trace.mode = 'hybrid';
        trace.candidates = attempt.candidates;
        trace.fused_count = attempt.fused_count;
        trace.rerank_applied = wantsRerank;
        trace.rrf_config = { k: options.rrfK || RRF_K, lexical_weight: options.lexicalWeight === undefined ? DEFAULT_LEXICAL_WEIGHT : options.lexicalWeight };
        trace.filters_applied = attempt.applied;
        trace.filters_dropped = attempt.dropped;
        trace.all_scores = attempt.rows.map(r => r.similarity);
        trace.rrf = attempt.rows.map(r => ({ chunk_id: r.chunk_id, rrf: r.rrf_score, branches: r.branches }));
      }
      return attempt.rows;
    }

    // mode === 'vector': comportamiento previo, se conserva para experimentos y A/B.
    let attempt = await runVectorSearch({ queryEmbedding, filters, tenantId, threshold, topK });

    if (attempt.rows.length === 0 && hasRelaxableFilters) {
      const relaxed = await runVectorSearch({ queryEmbedding, filters, tenantId, threshold, topK, useMetadataFilters: false });
      if (relaxed.rows.length > 0) {
        if (trace) {
          trace.filters_relaxed = true;
          trace.relaxed_reason = '0 filas con filtros de metadata; reintento sin filtros (tenant y vigencia intactos)';
        }
        attempt = { ...relaxed, dropped: attempt.dropped };
      }
    }

    if (trace) {
      trace.mode = 'hnsw';
      trace.filters_applied = attempt.applied;
      trace.filters_dropped = attempt.dropped;
      trace.all_scores = attempt.rows.map(r => r.similarity);
    }

    return attempt.rows;
  } catch (error) {
    if (trace) {
      trace.fallback_triggered = true;
      trace.fallback_reason = error.message;
    }
    console.warn('⚠️ [RAG] Vectorial falló o DB desatendida, ejecutando fallback full-text:', error.message);

    try {
      let attempt = await runFullTextSearch({ query, filters, tenantId, topK });

      if (attempt.rows.length === 0 && hasRelaxableFilters) {
        const relaxed = await runFullTextSearch({ query, filters, tenantId, topK, useMetadataFilters: false });
        if (relaxed.rows.length > 0) {
          if (trace) {
            trace.filters_relaxed = true;
            trace.relaxed_reason = '0 filas con filtros de metadata; reintento sin filtros (tenant y vigencia intactos)';
          }
          attempt = { ...relaxed, dropped: attempt.dropped };
        }
      }

      if (trace) {
        trace.mode = 'fts';
        trace.filters_applied = attempt.applied;
        trace.filters_dropped = attempt.dropped;
        trace.all_scores = [];
      }

      return attempt.rows;

    } catch (fallbackError) {
      if (trace) {
        trace.mode = 'unavailable';
        trace.fallback_error = fallbackError.message;
      }
      console.warn('⚠️ [RAG] Fallback full-text también falló, devolviendo array vacío:', fallbackError.message);
      return [];
    }
  }
}

// ─── Evidence Layer (AUD-RAGAURA-01 · P0 #2) ─────────────────────────
/**
 * La capa de retrieval devuelve chunks crudos; inyectarlos así al LLM no permitía
 * certificar el «Estado 7»: sin identidad de evidencia, sin estado de suficiencia y sin
 * provenance estructurada, una respuesta parcial pasaba por certeza.
 *
 * Esta sección implementa el CONTRATO de la Evidence Layer diseñado en R6-C1
 * (`backend/scripts/r6c1EvidenceArchitectureAnalysis.js`):
 *   chunks → Evidence Candidate Builder → Sufficiency Gate → EvidencePacket
 *
 * El retrieval (`searchBeautyKnowledge`) NO cambia: se envuelve. `searchWithEvidence`
 * es el punto de integración para `auraToolExecutor`.
 */

/**
 * Estados de suficiencia del EvidencePacket (contrato R6-C1).
 *   SUPPORTED            cobertura ≥ umbral y ≥1 evidencia con gate fuerte (score ≥ 0.55)
 *   PARTIAL              hay evidencia relevante pero falta el gate fuerte o cobertura
 *   UNSUPPORTED          no hay evidencia que sostenga la respuesta
 *   RETRIEVAL_UNCERTAIN  la señal no permite decidir (fallback FTS: similarity = null)
 */
const EVIDENCE_STATES = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  PARTIAL: 'PARTIAL',
  UNSUPPORTED: 'UNSUPPORTED',
  RETRIEVAL_UNCERTAIN: 'RETRIEVAL_UNCERTAIN',
});

/**
 * Umbrales del Sufficiency Gate. `strong_score` = 0.55 es el «gate fuerte» validado en
 * R5-C25/C28/C29 (evita el falso SUFFICIENT de cejas_004 con cobertura léxica alta).
 * Es interpretable, no un score-único: la decisión combina cobertura + gate fuerte.
 */
const SUFFICIENCY_POLICY = Object.freeze({
  strong_score: 0.55,
  coverage_supported: 0.5,
  coverage_partial: 0.2,
});

/** Restricciones anti-alucinación que viajan en el packet hacia el generador. */
const ANTI_HALLUCINATION_CONSTRAINTS = Object.freeze([
  'No afirmar información sin evidencia en el packet (corpus-grounded)',
  'No completar gaps con conocimiento externo',
  'No usar hard negatives como evidencia',
  'No mezclar categorías incorrectamente',
  'No ocultar insuficiencia: PARTIAL/UNSUPPORTED se comunican explícitamente',
  'No convertir evidencia parcial en certeza (confidence refleja cobertura)',
]);

const RETRIEVAL_STOPWORDS = new Set([
  'para', 'por', 'con', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'del', 'que', 'como',
  'mas', 'pero', 'sin', 'sobre', 'entre', 'este', 'esta', 'estos', 'estas', 'ese', 'esa',
  'esos', 'esas', 'son', 'sus', 'ser', 'hay', 'muy', 'mis', 'tus', 'puedo', 'puede',
]);

function normalizeForMatching(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Términos (claims léxicos) de la consulta: sin stopwords, sin duplicados, length ≥ 3. */
function extractQueryTerms(query) {
  const seen = new Set();
  const terms = [];
  for (const raw of normalizeForMatching(query).split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || RETRIEVAL_STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    terms.push(raw);
  }
  return terms;
}

/** Fracción de claims de la query presentes en el texto de la evidencia (0..1). */
function computeCoverage(query, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return 0;
  const terms = extractQueryTerms(query);
  if (terms.length === 0) return 1;
  const haystack = normalizeForMatching(
    evidence.map((e) => `${e.title || ''} ${e.content || ''}`).join(' ')
  );
  const covered = terms.filter((t) => haystack.includes(t)).length;
  return covered / terms.length;
}

function hashQuery(query) {
  if (query === undefined || query === null) return null;
  return crypto.createHash('sha256').update(String(query)).digest('hex').slice(0, 16);
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Evidence Candidate Builder: convierte los chunks recuperados en `Evidence` con
 * identidad trazable (`evidence_id`, `chunk_id`, `source_id`), rank ordinal, la
 * similitud realmente medida y provenance estructurada.
 *
 * @param {Array} chunks - filas de `searchBeautyKnowledge` (o cualquier chunk con title/content)
 * @param {object} [options] - { query }
 * @returns {Array} Evidence[]
 */
function buildEvidenceCandidates(chunks, options = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  const queryHash = options.query !== undefined ? hashQuery(options.query) : null;

  return chunks.map((chunk, index) => {
    const rank = index + 1;
    const retrievalScore =
      typeof chunk.similarity === 'number' && !Number.isNaN(chunk.similarity)
        ? chunk.similarity
        : (typeof chunk.retrieval_score === 'number' ? chunk.retrieval_score : null);

    return {
      evidence_id: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `ev-${Date.now()}-${rank}`,
      chunk_id: chunk.chunk_id !== undefined ? chunk.chunk_id : (chunk.id !== undefined ? chunk.id : null),
      source_id: chunk.document_id !== undefined ? chunk.document_id : null,
      category: chunk.category !== undefined ? chunk.category : null,
      title: chunk.title || '',
      content: chunk.content || '',
      retrieval_score: retrievalScore,
      similarity: retrievalScore, // compatibilidad con formatKnowledgeContext
      rank,
      mode: chunk.mode || null,
      fuente: chunk.fuente !== undefined ? chunk.fuente : null,
      seccion: chunk.seccion !== undefined ? chunk.seccion : null,
      metadata: chunk.metadata || {},
      provenance: {
        chunk_id: chunk.chunk_id !== undefined ? chunk.chunk_id : null,
        source_id: chunk.document_id !== undefined ? chunk.document_id : null,
        category: chunk.category !== undefined ? chunk.category : null,
        fuente: chunk.fuente !== undefined ? chunk.fuente : null,
        seccion: chunk.seccion !== undefined ? chunk.seccion : null,
        retrieval_rank: rank,
        retrieval_score: retrievalScore,
        query_hash: queryHash,
        source: 'vector_retrieval',
      },
    };
  });
}

/**
 * Sufficiency Gate: decide si la evidencia recuperada sostiene una respuesta, con un
 * modelo interpretable (cobertura de claims + gate fuerte). No es `score > threshold`.
 *
 * @param {Array} evidence - Evidence[] (o chunks, que se adaptan internamente)
 * @param {object} [options] - { query, policy, corpusGap }
 * @returns {{state:string, confidence:number, coverage:number, strong_gate:boolean,
 *            strong_evidence_count:number, candidate_count:number,
 *            retrieval_measured:boolean, unsupported_reason:?string}}
 */
function evaluateSufficiency(evidence, options = {}) {
  const list = Array.isArray(evidence) ? evidence : [];
  const query = options.query || '';
  const policy = { ...SUFFICIENCY_POLICY, ...(options.policy || {}) };

  const coverage = computeCoverage(query, list);
  const measured = list.filter((e) => typeof e.retrieval_score === 'number');
  const strong = measured.filter((e) => e.retrieval_score >= policy.strong_score);
  const strongGate = strong.length > 0;
  const hasMeasuredRetrieval = measured.length > 0;

  let state;
  let unsupported_reason = null;

  if (list.length === 0) {
    state = EVIDENCE_STATES.UNSUPPORTED;
    unsupported_reason = options.corpusGap ? 'CORPUS_GAP' : 'EVIDENCE_INSUFFICIENT';
  } else if (!hasMeasuredRetrieval) {
    // Fallback full-text: similarity = null. No se puede distinguir corpus gap de miss.
    state = EVIDENCE_STATES.RETRIEVAL_UNCERTAIN;
    unsupported_reason = 'RETRIEVAL_UNCERTAIN';
  } else if (coverage >= policy.coverage_supported && strongGate) {
    state = EVIDENCE_STATES.SUPPORTED;
  } else if (coverage >= policy.coverage_partial) {
    state = EVIDENCE_STATES.PARTIAL;
  } else {
    state = EVIDENCE_STATES.UNSUPPORTED;
    unsupported_reason = options.corpusGap ? 'CORPUS_GAP' : 'EVIDENCE_INSUFFICIENT';
  }

  let confidence;
  if (state === EVIDENCE_STATES.SUPPORTED) {
    confidence = round3(coverage * 0.7 + 0.3);
  } else if (state === EVIDENCE_STATES.PARTIAL) {
    confidence = round3(coverage * 0.7);
  } else if (state === EVIDENCE_STATES.RETRIEVAL_UNCERTAIN) {
    confidence = 0;
  } else {
    confidence = round3(Math.min(coverage, 0.2));
  }

  return {
    state,
    confidence,
    coverage: round3(coverage),
    strong_gate: strongGate,
    strong_evidence_count: strong.length,
    candidate_count: list.length,
    retrieval_measured: hasMeasuredRetrieval,
    unsupported_reason,
  };
}

/**
 * EvidencePacket: contrato entre la Evidence Layer y el Answer Generator. Contiene SOLO
 * evidencia autorizada + estado de suficiencia + provenance + restricciones.
 *
 * @param {Array} chunks - chunks recuperados, o Evidence[] ya construida
 * @param {object} [options] - { query, mode, corpusGap }
 * @returns {object} EvidencePacket
 */
function buildEvidencePacket(chunks, options = {}) {
  const alreadyEvidence = Array.isArray(chunks) && chunks.length > 0 && chunks[0] && chunks[0].evidence_id;
  const evidence = alreadyEvidence ? chunks : buildEvidenceCandidates(chunks, options);
  const sufficiency = evaluateSufficiency(evidence, options);
  const mode = options.mode || (evidence[0] && evidence[0].mode) || null;

  return {
    evidence,
    state: sufficiency.state,
    confidence: sufficiency.confidence,
    provenance: {
      query_hash: options.query !== undefined ? hashQuery(options.query) : null,
      retrieval_mode: mode,
      candidate_count: sufficiency.candidate_count,
      strong_evidence_count: sufficiency.strong_evidence_count,
      coverage: sufficiency.coverage,
      gate: {
        strong_score: SUFFICIENCY_POLICY.strong_score,
        coverage_supported: SUFFICIENCY_POLICY.coverage_supported,
        coverage_partial: SUFFICIENCY_POLICY.coverage_partial,
      },
    },
    constraints: [...ANTI_HALLUCINATION_CONSTRAINTS],
    sufficiency,
    unsupported_reason: sufficiency.unsupported_reason,
  };
}

/**
 * Integración: retrieval real + Evidence Layer en una sola llamada.
 * `trace` (opcional) se propaga a `searchBeautyKnowledge` y su `mode` alimenta el packet.
 *
 * @param {string} query
 * @param {object} [options] - mismos que `searchBeautyKnowledge` (+ trace)
 * @returns {Promise<object>} EvidencePacket
 */
async function searchWithEvidence(query, options = {}) {
  const trace = options.trace || null;
  const chunks = await searchBeautyKnowledge(query, options);
  const mode = (trace && trace.mode) || (chunks[0] && chunks[0].mode) || null;
  return buildEvidencePacket(chunks, { ...options, query, mode });
}

// ─── Formatear chunks para inyección en prompt ───────────────────────
/**
 * Cita con los campos reales del corpus: `fuente` y `seccion` (columnas que escribe la
 * ingesta). `metadata.source | legal_basis | jurisdiction | authority | version` existen en
 * 0 de 5.619 chunks, así que la "Fuente" que se mostraba antes era el slug de categoría o
 * el literal 'GlowApp Canon'. La similitud sólo se muestra cuando se midió de verdad
 * (el fallback full-text devuelve null).
 */
function formatKnowledgeContext(chunks) {
  if (!chunks || chunks.length === 0) return '';

  return chunks.map((chunk, idx) => {
    const sourceFiles = Array.isArray(chunk.metadata?._source_files) ? chunk.metadata._source_files : [];
    const source = chunk.fuente || chunk.metadata?.source || sourceFiles[0] || chunk.category || 'Corpus canónico GlowApp';
    const seccion = chunk.seccion ? ` [Sección: ${chunk.seccion}]` : '';
    const chunkRef = chunk.chunk_id ? ` [Chunk: ${chunk.chunk_id}]` : '';
    const rankRef = typeof chunk.rank === 'number' ? ` [Rank: ${chunk.rank}]` : '';
    const similarity = typeof chunk.similarity === 'number' ? ` (Similitud: ${(chunk.similarity * 100).toFixed(0)}%)` : '';

    return `[${idx + 1}] ${chunk.title}${similarity}\n   📚 Fuente: ${source}${seccion}${chunkRef}${rankRef}\n   ${chunk.content}`;
  }).join('\n\n');
}

module.exports = {
  searchBeautyKnowledge,
  formatKnowledgeContext,
  generateEmbedding,
  // Evidence Layer (AUD-RAGAURA-01 · P0 #2)
  EVIDENCE_STATES,
  SUFFICIENCY_POLICY,
  buildEvidenceCandidates,
  evaluateSufficiency,
  buildEvidencePacket,
  searchWithEvidence,
  // Ranking (FASE 2) — expuesto para pruebas unitarias de la fusión
  rrfFuse,
  rerankCandidates,
  RRF_K,
  RRF_POOL,
};
