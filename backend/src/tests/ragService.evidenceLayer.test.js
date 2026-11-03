/**
 * Test suite de la Evidence Layer en ragService (AUD-RAGAURA-01 · P0 #2 —
 * «Evidence Layer NO implementada: sin EvidencePacket, CandidateBuilder, Sufficiency Gate»).
 *
 * Cubre el contrato diseñado en R6-C1 (`scripts/r6c1EvidenceArchitectureAnalysis.js`):
 *   chunks → Evidence Candidate Builder → Sufficiency Gate → EvidencePacket
 *
 * No toca el retrieval: `searchBeautyKnowledge` conserva su contrato (ver ragService.test.js);
 * aquí se verifica la capa que envuelve sus resultados.
 */

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
const {
  EVIDENCE_STATES,
  SUFFICIENCY_POLICY,
  buildEvidenceCandidates,
  evaluateSufficiency,
  buildEvidencePacket,
  searchWithEvidence,
} = require('../services/ragService');

const QUERY = 'rutina para piel seca con niacinamida';

const strongChunk = (overrides = {}) => ({
  id: 1,
  title: 'Rutina para piel seca',
  content: 'Rutina para piel seca con niacinamida y ácido hialurónico.',
  category: 'skincare_rutinas_por_tipo_piel',
  similarity: 0.82,
  mode: 'hnsw',
  chunk_id: 'sk-1',
  document_id: 'doc-skincare',
  fuente: 'canon/skincare',
  seccion: 'rutinas',
  metadata: {},
  ...overrides,
});

describe('ragService · Evidence Layer — Candidate Builder', () => {
  test('vacío → [] y 1 chunk → 1 Evidence con identidad, rank y provenance', () => {
    expect(buildEvidenceCandidates([])).toEqual([]);

    const [e] = buildEvidenceCandidates([strongChunk()], { query: QUERY });
    expect(typeof e.evidence_id).toBe('string');
    expect(e.evidence_id.length).toBeGreaterThan(0);
    expect(e.chunk_id).toBe('sk-1');
    expect(e.source_id).toBe('doc-skincare');
    expect(e.category).toBe('skincare_rutinas_por_tipo_piel');
    expect(e.title).toBe('Rutina para piel seca');
    expect(e.content).toContain('niacinamida');
    expect(e.retrieval_score).toBe(0.82);
    expect(e.rank).toBe(1);
    expect(e.provenance.chunk_id).toBe('sk-1');
    expect(e.provenance.retrieval_rank).toBe(1);
    expect(e.provenance.query_hash).toBeTruthy();
  });

  test('asigna ranks consecutivos (1-based) y evidence_id único', () => {
    const two = buildEvidenceCandidates([strongChunk(), strongChunk({ chunk_id: 'sk-2', similarity: 0.7 })]);
    expect(two[0].rank).toBe(1);
    expect(two[1].rank).toBe(2);
    expect(two[0].evidence_id).not.toBe(two[1].evidence_id);
  });

  test('normaliza nulos: sin chunk_id/document_id la evidencia sigue siendo válida', () => {
    const [e] = buildEvidenceCandidates([{ title: 't', content: 'c', similarity: 0.6 }]);
    expect(e.chunk_id).toBeNull();
    expect(e.source_id).toBeNull();
    expect(e.retrieval_score).toBe(0.6);
    expect(e.provenance).toBeDefined();
  });
});

describe('ragService · Evidence Layer — Sufficiency Gate', () => {
  test('evidencia fuerte + cobertura → SUPPORTED con confidence y sin motivo de no-soporte', () => {
    const g = evaluateSufficiency(buildEvidenceCandidates([strongChunk()], { query: QUERY }), { query: QUERY });
    expect(g.state).toBe(EVIDENCE_STATES.SUPPORTED);
    expect(g.coverage).toBeGreaterThanOrEqual(SUFFICIENCY_POLICY.coverage_supported);
    expect(g.confidence).toBeGreaterThan(0);
    expect(g.confidence).toBeLessThanOrEqual(1);
    expect(g.strong_gate).toBe(true);
    expect(g.unsupported_reason).toBeNull();
  });

  test('cobertura alta SIN gate fuerte → PARTIAL (no se declara certeza)', () => {
    const g = evaluateSufficiency(buildEvidenceCandidates([strongChunk({ similarity: 0.32 })], { query: QUERY }), { query: QUERY });
    expect(g.state).toBe(EVIDENCE_STATES.PARTIAL);
    expect(g.strong_gate).toBe(false);
  });

  test('sin evidencia → UNSUPPORTED con motivo trazable', () => {
    const g = evaluateSufficiency([], { query: QUERY });
    expect(g.state).toBe(EVIDENCE_STATES.UNSUPPORTED);
    expect(g.unsupported_reason).toBe('EVIDENCE_INSUFFICIENT');
  });

  test('corpusGap explícito → UNSUPPORTED con motivo CORPUS_GAP', () => {
    const g = evaluateSufficiency([], { query: QUERY, corpusGap: true });
    expect(g.state).toBe(EVIDENCE_STATES.UNSUPPORTED);
    expect(g.unsupported_reason).toBe('CORPUS_GAP');
  });

  test('similarity null (fallback FTS) → RETRIEVAL_UNCERTAIN, no se puede distinguir gap de miss', () => {
    const ev = buildEvidenceCandidates([strongChunk({ similarity: null, mode: 'fts' })], { query: QUERY });
    const g = evaluateSufficiency(ev, { query: QUERY });
    expect(g.state).toBe(EVIDENCE_STATES.RETRIEVAL_UNCERTAIN);
    expect(g.unsupported_reason).toBe('RETRIEVAL_UNCERTAIN');
    expect(g.retrieval_measured).toBe(false);
  });

  test('el gate fuerte exige score ≥ 0.55 (evita el falso SUFFICIENT de R5-C25)', () => {
    expect(SUFFICIENCY_POLICY.strong_score).toBeGreaterThanOrEqual(0.55);
    const g = evaluateSufficiency(buildEvidenceCandidates([strongChunk({ similarity: 0.54 })], { query: QUERY }), { query: QUERY });
    expect(g.strong_gate).toBe(false);
    expect(g.state).not.toBe(EVIDENCE_STATES.SUPPORTED);
  });
});

describe('ragService · Evidence Layer — EvidencePacket', () => {
  test('ensambla el contrato del generador (evidence, state, confidence, provenance, constraints)', () => {
    const packet = buildEvidencePacket([strongChunk()], { query: QUERY, mode: 'hnsw' });
    expect(Array.isArray(packet.evidence)).toBe(true);
    expect(packet.evidence).toHaveLength(1);
    expect(packet.state).toBe(EVIDENCE_STATES.SUPPORTED);
    expect(typeof packet.confidence).toBe('number');
    expect(packet.provenance.query_hash).toBeTruthy();
    expect(['hnsw','hybrid','fts']).toContain(packet.provenance.retrieval_mode);
    expect(packet.provenance.gate.strong_score).toBe(SUFFICIENCY_POLICY.strong_score);
    expect(Array.isArray(packet.constraints)).toBe(true);
    expect(packet.constraints.length).toBeGreaterThan(0);
    expect(packet.unsupported_reason).toBeNull();
  });

  test('acepta Evidence[] ya construida sin duplicar identidad', () => {
    const evidence = buildEvidenceCandidates([strongChunk()], { query: QUERY });
    const packet = buildEvidencePacket(evidence, { query: QUERY, mode: 'hnsw' });
    expect(packet.evidence[0].evidence_id).toBe(evidence[0].evidence_id);
  });

  test('packet FTS expone incertidumbre de retrieval', () => {
    const packet = buildEvidencePacket([strongChunk({ similarity: null, mode: 'fts' })], { query: QUERY, mode: 'fts' });
    expect(packet.state).toBe(EVIDENCE_STATES.RETRIEVAL_UNCERTAIN);
    expect(packet.unsupported_reason).toBe('RETRIEVAL_UNCERTAIN');
  });
});

describe('ragService · Evidence Layer — integración con retrieval', () => {
  beforeEach(() => jest.clearAllMocks());

  test('retrieval vectorial → packet SUPPORTED', async () => {
    // 2048 dims (modelo NVIDIA vivo). Con 1024 el servicio rechaza el embedding por
    // dimension y degrada a full-text: el test decia probar la ruta vectorial pero
    // ejercitaba la de fallback, y la asercion laxa ['hnsw','fts'] lo ocultaba.
    generateEmbedding.mockResolvedValue(new Array(2048).fill(0.1));
    ragPool.query.mockResolvedValue({ rows: [strongChunk({ similarity: '0.82' })] });

    const packet = await searchWithEvidence(QUERY, { filters: {} });

    expect(packet.state).toBe(EVIDENCE_STATES.SUPPORTED);
    expect(packet.evidence).toHaveLength(1);
    expect(packet.evidence[0].retrieval_score).toBe(0.82);
    // El default desde FASE 2 es híbrido: vía vectorial + rama léxica fusionadas.
    // Lo que este test protege es que NO se cae al fallback fts (similitud inventada).
    expect(packet.provenance.retrieval_mode).toBe('hybrid');
  });

  test('fallback FTS (NVIDIA caído) → packet RETRIEVAL_UNCERTAIN, sin inventar similitud', async () => {
    generateEmbedding.mockRejectedValue(new Error('NVIDIA unavailable'));
    ragPool.query.mockResolvedValue({ rows: [strongChunk({ similarity: null, mode: 'fts' })] });

    const packet = await searchWithEvidence(QUERY, { filters: {} });

    expect(packet.state).toBe(EVIDENCE_STATES.RETRIEVAL_UNCERTAIN);
    expect(packet.evidence[0].retrieval_score).toBeNull();
  });
});
