/**
 * Test suite para ragService (Retrieval vectorial NVIDIA + Fallback FTS PostgreSQL)
 * Rescatado y adaptado de codex/rag-aura-r1-r4
 *
 * Port R1-R4 (2026-09-22): el embedding de consulta se pide a embeddingService
 * (breaker NVIDIA incluido, sin dummy) y el tenantId viaja como parámetro ligado.
 *
 * Fase 1 (2026-09-23): filtros apuntando a los campos que la ingesta escribe de verdad,
 * fail-open para categorías fuera del vocabulario canónico, reintento relajado, identidad
 * del chunk en el SELECT, sin similitud inventada en el fallback y traza completa.
 */

// El fixture de embedding usa 2048 dimensiones: es la dimension del unico modelo NVIDIA vivo
// (`nvidia/nemotron-3-embed-1b`). El antecesor de 1024 (`nvidia/nv-embedqa-e5-v5`) murio el
// 2026-08-25 con HTTP 410 Gone. Un mock de 1024 hace que ragService rechace el embedding por
// dimension (EXPECTED_DIMS = 2048) y degrade a full-text, dejando la ruta vectorial sin
// ejercitar. Ver tests/rag.embedding-dimension.test.js.
process.env.NVIDIA_API_KEY = 'test-mock-nvidia-key';

jest.mock('../config/db', () => ({
  ragPool: { query: jest.fn() },
  pool: { query: jest.fn() },
}));

jest.mock('../services/embeddingService', () => ({
  generateNvidiaEmbedding: jest.fn(),
  generateEmbedding: jest.fn(),
}));

const { ragPool } = require('../config/db');
const { generateEmbedding } = require('../services/embeddingService');
const { searchBeautyKnowledge, RRF_POOL, formatKnowledgeContext } = require('../services/ragService');
const { RAG_SIMILARITY_THRESHOLD } = require('../config/ragConfig');

describe('ragService retrieval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses a NVIDIA query embedding for pgvector retrieval', async () => {
    generateEmbedding.mockResolvedValue(new Array(2048).fill(0.1));
    ragPool.query.mockResolvedValue({
      rows: [
        { id: 1, title: 'Niacinamida', content: 'Info niacinamida', similarity: '0.83', metadata: {} },
      ],
    });

    const result = await searchBeautyKnowledge('niacinamida');
    expect(generateEmbedding).toHaveBeenCalledWith('niacinamida', 'query');
    expect(ragPool.query.mock.calls[0][0]).toContain('embedding <=>');
    expect(result[0].similarity).toBe(0.83);
  });

  test('uses PostgreSQL full-text search when NVIDIA fails; no vector query is made', async () => {
    generateEmbedding.mockRejectedValue(new Error('NVIDIA unavailable'));
    ragPool.query.mockResolvedValue({
      rows: [
        { id: 2, title: 'Retinol', content: 'Guía de uso', similarity: '0.5', metadata: {} },
      ],
    });

    const result = await searchBeautyKnowledge('retinol');
    expect(ragPool.query).toHaveBeenCalledTimes(1);
    expect(ragPool.query.mock.calls[0][0]).toContain('to_tsvector');
    expect(ragPool.query.mock.calls[0][0]).not.toContain('embedding <=>');
    expect(result[0].title).toBe('Retinol');
  });

  test('rejects embeddings with wrong dimensions and degrades to full-text', async () => {
    generateEmbedding.mockResolvedValue(new Array(768).fill(0.1));
    ragPool.query.mockResolvedValue({ rows: [] });

    await searchBeautyKnowledge('acido hialuronico');

    expect(ragPool.query.mock.calls[0][0]).toContain('to_tsvector');
  });

  test('binds tenantId as a query parameter and never interpolates it (BUS-RAG-001)', async () => {
    const maliciousTenantId = "10') OR TRUE --";
    generateEmbedding.mockResolvedValue(new Array(2048).fill(0.1));
    ragPool.query.mockResolvedValue({ rows: [] });

    await searchBeautyKnowledge('consulta', { tenantId: maliciousTenantId });

    const [sql, params] = ragPool.query.mock.calls[0];

    // El payload no puede aparecer en el SQL y el predicado va parametrizado
    expect(sql).not.toContain('OR TRUE');
    expect(sql).not.toContain(maliciousTenantId);
    expect(sql).toContain('tenant_id::text = $2');

    // Y el tenant es un parámetro ligado, con el threshold/limit desplazados
    expect(params[1]).toBe(maliciousTenantId);
    expect(params[2]).toBe(RAG_SIMILARITY_THRESHOLD);
    expect(params[3]).toBe(RRF_POOL); // pool del híbrido, no el topK final
  });

  test('without tenantId only GLOBAL knowledge is searched (tenant_id IS NULL)', async () => {
    generateEmbedding.mockResolvedValue(new Array(2048).fill(0.1));
    ragPool.query.mockResolvedValue({ rows: [] });

    await searchBeautyKnowledge('consulta');

    const [sql, params] = ragPool.query.mock.calls[0];

    expect(sql).toContain('tenant_id IS NULL');
    expect(sql).not.toContain('tenant_id::text =');
    expect(params).toHaveLength(3); // embedding + threshold + topK
  });

  test('keeps the tenant isolation in the full-text fallback too', async () => {
    const maliciousTenantId = "10') OR TRUE --";
    generateEmbedding.mockRejectedValue(new Error('NVIDIA unavailable'));
    ragPool.query.mockResolvedValue({ rows: [] });

    await searchBeautyKnowledge('consulta', {
      tenantId: maliciousTenantId,
      // Categoría REAL del corpus: el filtro se aplica y el índice de parámetros se desplaza
      filters: { category: 'guias_unas' },
    });

    const [sql, params] = ragPool.query.mock.calls[0];

    expect(sql).toContain('to_tsvector');
    expect(sql).not.toContain('OR TRUE');
    // $1=query, $2=patrón, $3=LIMIT, $4=category, $5=tenantId
    expect(sql).toContain('category = $4');
    expect(sql).toContain('tenant_id::text = $5');
    expect(params[4]).toBe(maliciousTenantId);
  });
});

describe('ragService · filtros contra los campos reales (Fase 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    generateEmbedding.mockResolvedValue(new Array(2048).fill(0.1));
  });

  test('una categoría fuera del vocabulario NO se aplica (fail-open) y se registra en la traza', async () => {
    ragPool.query.mockResolvedValue({ rows: [{ id: 1, title: 'X', content: 'y', similarity: '0.8', metadata: {} }] });
    const trace = {};

    await searchBeautyKnowledge('consulta', { filters: { category: 'skincare' }, trace });

    const [sql] = ragPool.query.mock.calls[0];
    expect(sql).not.toContain('category = $');
    expect(trace.filters_applied).toEqual({});
    expect(trace.filters_dropped).toEqual([
      { filter: 'category', value: 'skincare', reason: 'not_in_canonical_vocabulary' },
    ]);
  });

  test('normaliza variantes con acentos y mayúsculas ("Guías Uñas" → guias_unas)', async () => {
    ragPool.query.mockResolvedValue({ rows: [{ id: 1, title: 'X', content: 'y', similarity: '0.8', metadata: {} }] });
    const trace = {};

    await searchBeautyKnowledge('consulta', { filters: { category: 'Guías Uñas' }, trace });

    const [sql, params] = ragPool.query.mock.calls[0];
    expect(sql).toContain('category = $2');
    expect(params[1]).toBe('guias_unas');
    expect(trace.filters_applied).toEqual({ category: 'guias_unas' });
  });

  test('skin_type filtra sobre metadata->skin_types e incluye el contenido universal ("all")', async () => {
    ragPool.query.mockResolvedValue({ rows: [] });

    await searchBeautyKnowledge('consulta', { filters: { skin_type: 'seca' } });

    const [sql] = ragPool.query.mock.calls[0];
    // La columna `skin_type` queda NULL en toda la ingesta canónica: el dato real está en metadata
    expect(sql).not.toContain('skin_type ILIKE');
    expect(sql).toContain("jsonb_array_elements_text(COALESCE(metadata->'skin_types'");
    expect(sql).toContain("lower(st) IN ('all', 'todas', 'todos')");
  });

  test('el filtro domain ya no apunta a metadata->>domain (inexistente) y usa category + applicable_modules', async () => {
    ragPool.query.mockResolvedValue({ rows: [] });

    await searchBeautyKnowledge('consulta', { filters: { domain: 'BUSINESS' } });

    const [sql] = ragPool.query.mock.calls[0];
    expect(sql).not.toContain("metadata->>'domain'");
    expect(sql).toContain("metadata->'applicable_modules' ? $2");
  });

  test('devuelve la identidad del chunk (chunk_id, document_id, fuente, seccion) para poder citar', async () => {
    ragPool.query.mockResolvedValue({ rows: [] });

    await searchBeautyKnowledge('consulta');

    const [sql] = ragPool.query.mock.calls[0];
    for (const col of ['chunk_id', 'document_id', 'fuente', 'seccion']) {
      expect(sql).toContain(col);
    }
  });

  test('si la búsqueda filtrada devuelve 0 filas, reintenta sin filtros de metadata pero SIN relajar el tenant', async () => {
    const tenantId = "10') OR TRUE --";
    ragPool.query
      .mockResolvedValueOnce({ rows: [] })                                     // vector con filtros: vacío
      .mockResolvedValueOnce({ rows: [] })                                     // léxico con filtros: vacío
      .mockResolvedValueOnce({ rows: [{ id: 9, title: 'Z', content: 'c', similarity: '0.7', metadata: {}, chunk_id: 'z-1' }] })  // vector sin filtros
      .mockResolvedValueOnce({ rows: [] });                                    // léxico sin filtros
    const trace = {};

    const rows = await searchBeautyKnowledge('consulta', {
      tenantId,
      // skin_type es una PISTA de relevancia: se puede relajar (jurisdiction/domain no)
      filters: { skin_type: 'seca' },
      trace,
    });

    expect(ragPool.query).toHaveBeenCalledTimes(4);
    const [sql1] = ragPool.query.mock.calls[0];
    const [sql3, params3] = ragPool.query.mock.calls[2];

    expect(sql1).toContain("metadata->'skin_types'");
    expect(sql3).not.toContain("metadata->'skin_types'");
    // El aislamiento NO se relaja en el reintento
    expect(sql3).toContain('tenant_id::text = $2');
    expect(params3[1]).toBe(tenantId);
    expect(params3).not.toContain('OR TRUE');
    expect(rows).toHaveLength(1);
    expect(trace.filters_relaxed).toBe(true);
  });

  test('los filtros de ALCANCE (domain/jurisdiction) NO se relajan: nunca se devuelve otro dominio', async () => {
    ragPool.query.mockResolvedValue({ rows: [] });
    const trace = {};

    const rows = await searchBeautyKnowledge('normativa invima', {
      filters: { domain: 'BUSINESS', jurisdiction: 'NATIONAL' },
      trace,
      mode: 'vector',
    });

    // Una sola consulta: no hay reintento sin filtros para un filtro de alcance
    expect(ragPool.query).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(0);
    expect(trace.filters_relaxed).toBe(false);
  });

  test('el fallback full-text no inventa similitud: devuelve null y modo fts', async () => {
    generateEmbedding.mockRejectedValue(new Error('NVIDIA unavailable'));
    ragPool.query.mockResolvedValue({
      rows: [{ id: 3, title: 'Regla', content: 'c', similarity: null, metadata: {}, chunk_id: 'x-1' }],
    });
    const trace = {};

    const rows = await searchBeautyKnowledge('regla', { trace });

    expect(rows[0].similarity).toBeNull();
    expect(rows[0].mode).toBe('fts');
    expect(trace.mode).toBe('fts');
    expect(trace.fallback_triggered).toBe(true);
    expect(trace.all_scores).toEqual([]);
  });

  test('la traza registra el umbral realmente usado y la latencia del embedding', async () => {
    ragPool.query.mockResolvedValue({ rows: [{ id: 1, title: 'X', content: 'y', similarity: '0.66', metadata: {} }] });
    const trace = {};

    await searchBeautyKnowledge('consulta', { threshold: 0.3, trace, mode: 'vector' });

    expect(trace.threshold_used).toBe(0.3);
    expect(trace.mode).toBe('hnsw');
    expect(trace.all_scores).toEqual([0.66]);
    expect(typeof trace.query_embedding_latency_ms).toBe('number');
  });
});

describe('ragService · formatKnowledgeContext cita con datos reales', () => {
  test('usa fuente/seccion/chunk_id y omite la similitud cuando no se midió', () => {
    const out = formatKnowledgeContext([
      {
        title: 'Fotoprotección diaria',
        content: 'Contenido…',
        fuente: 'canon/cuidado_corporal_y_spa',
        seccion: 'prevencion',
        chunk_id: 'foto-diaria-001',
        category: 'cuidado_corporal_y_spa',
        similarity: null,
        metadata: {},
      },
    ]);

    expect(out).toContain('Fuente: canon/cuidado_corporal_y_spa');
    expect(out).toContain('[Sección: prevencion]');
    expect(out).toContain('[Chunk: foto-diaria-001]');
    expect(out).not.toContain('Similitud');
  });

  test('muestra la similitud sólo cuando es un número', () => {
    const out = formatKnowledgeContext([
      { title: 'Niacinamida', content: 'c', similarity: 0.83, category: 'textura_poros', metadata: {} },
    ]);

    expect(out).toContain('(Similitud: 83%)');
  });
});
