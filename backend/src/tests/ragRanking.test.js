// backend/src/tests/ragRanking.test.js
const { rrfFuse, rerankCandidates, RRF_K } = require('../services/ragService');

const row = (chunk_id, similarity = null) => ({ chunk_id, title: `t-${chunk_id}`, content: 'c', similarity });

describe('rrfFuse · fusión Reciprocal Rank Fusion', () => {
  test('un chunk en ambas ramas supera a uno que solo está en una', () => {
    const fused = rrfFuse([row('a', 0.9), row('b', 0.8)], [row('b', null), row('c', null)], { topK: 3 });
    expect(fused[0].chunk_id).toBe('b');
    expect(fused[0].branches.sort()).toEqual(['lexical', 'vector']);
    expect(fused[0].mode).toBe('hybrid');
  });

  test('deduplica por chunk_id y no suma dos veces la misma rama', () => {
    const fused = rrfFuse([row('a'), row('a')], [], { topK: 5 });
    expect(fused).toHaveLength(1);
    expect(fused[0].rrf_score).toBeCloseTo(Number((1 / (RRF_K + 1)).toFixed(3)), 3);
  });

  test('ordena por 1/(k+rank): la primera posición de cada rama pesa igual', () => {
    const fused = rrfFuse([row('v1')], [row('l1')], { topK: 5 });
    expect(fused.map((r) => r.chunk_id).sort()).toEqual(['l1', 'v1']);
    expect(fused[0].rrf_score).toBe(fused[1].rrf_score);
  });

  test('respeta topK', () => {
    const many = Array.from({ length: 10 }, (_, i) => row(`c${i}`));
    expect(rrfFuse(many, [], { topK: 3 })).toHaveLength(3);
  });

  test('conserva la similitud vectorial cuando el léxico no la tiene', () => {
    const fused = rrfFuse([row('a', 0.77)], [row('a', null)], { topK: 1 });
    expect(fused[0].similarity).toBe(0.77);
  });
});

describe('rerankCandidates · reordenamiento por cobertura', () => {
  const base = [
    { chunk_id: 'generico', title: 'Cuidado de la piel', content: 'la piel y el cuidado de la piel', rrf_score: 0.03, similarity: 0.5 },
    { chunk_id: 'melasma', title: 'Melasma y subtono', content: 'melasma tratamiento despigmentante', rrf_score: 0.02, similarity: 0.45 },
  ];

  test('con peso de cobertura alto prioriza el chunk que nombra la consulta', () => {
    const out = rerankCandidates(base, 'melasma subtono tratamiento', { topK: 2, weights: [0.2, 0.6, 0.2] });
    expect(out[0].chunk_id).toBe('melasma');
  });

  test('con pesos puros de RRF mantiene el orden de la fusión', () => {
    const out = rerankCandidates(base, 'melasma subtono tratamiento', { topK: 2, weights: [1, 0, 0] });
    expect(out[0].chunk_id).toBe('generico');
  });

  test('ignora pesos inválidos y cae al default', () => {
    expect(() => rerankCandidates(base, 'melasma', { topK: 2, weights: [-1, 2, 0] })).not.toThrow();
  });
});
