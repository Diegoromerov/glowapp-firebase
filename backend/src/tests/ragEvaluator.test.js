/**
 * backend/src/tests/ragEvaluator.test.js
 * Tests unitarios para ragEvaluator.js
 * Mínimo 12 casos
 */

// Mock the embeddingService BEFORE requiring ragEvaluator
jest.mock('../services/embeddingService', () => ({
  generateEmbedding: jest.fn(),
}));

const { 
  evaluateRetrieval,
  evaluateFaithfulness,
  evaluateAnswerRelevancy,
  evaluateContextPrecision,
  evaluateContextRecall,
  runEvaluationSuite,
  compareWithBaseline,
  cosineSimilarity,
  extractKeywords
} = require('../services/ragEvaluator');

const { generateEmbedding } = require('../services/embeddingService');

describe('ragEvaluator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('cosineSimilarity', () => {
    test('debe retornar 1 para vectores idénticos', () => {
      const vec = [1, 2, 3, 4, 5];
      expect(cosineSimilarity(vec, vec)).toBe(1);
    });

    test('debe retornar 0 para vectores ortogonales', () => {
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
    });

    test('debe retornar 0 para vectores vacíos o nulos', () => {
      expect(cosineSimilarity([], [])).toBe(0);
      expect(cosineSimilarity(null, [1, 2])).toBe(0);
      expect(cosineSimilarity([1, 2], null)).toBe(0);
    });

    test('debe calcular similitud correcta para vectores conocidos', () => {
      const vecA = [3, 4]; // norma 5
      const vecB = [6, 8]; // norma 10, mismo dirección
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1, 5);
    });
  });

  describe('extractKeywords', () => {
    test('debe extraer palabras clave filtrando stop words', () => {
      const text = 'El bakuchiol es una alternativa natural al retinol para anti-envejecimiento';
      const keywords = extractKeywords(text, 10);
      
      expect(keywords).toContain('bakuchiol');
      expect(keywords).toContain('alternativa');
      expect(keywords).toContain('natural');
      expect(keywords).toContain('retinol');
      // "anti-envejecimiento" se divide en "anti" y "envejecimiento" por el hyphen
      expect(keywords).toContain('envejecimiento');
      expect(keywords).not.toContain('el');
      expect(keywords).not.toContain('es');
      expect(keywords).not.toContain('una');
      expect(keywords).not.toContain('al');
      expect(keywords).not.toContain('para');
    });

    test('debe manejar texto vacío', () => {
      expect(extractKeywords('')).toEqual([]);
      expect(extractKeywords(null)).toEqual([]);
    });

    test('debe limitar número de keywords', () => {
      const text = 'palabra1 palabra2 palabra3 palabra4 palabra5 palabra6 palabra7 palabra8 palabra9 palabra10 palabra11';
      const keywords = extractKeywords(text, 5);
      expect(keywords.length).toBeLessThanOrEqual(5);
    });
  });

  describe('evaluateRetrieval', () => {
    test('debe calcular precision@k, recall@k, MRR y top_k_accuracy', () => {
      const expectedChunks = ['chunk_1', 'chunk_2', 'chunk_3'];
      const retrievedChunks = [
        { id: 'chunk_1', content: 'test' },
        { id: 'chunk_4', content: 'test' },
        { id: 'chunk_2', content: 'test' },
        { id: 'chunk_5', content: 'test' },
        { id: 'chunk_6', content: 'test' }
      ];
      
      const metrics = evaluateRetrieval('query test', expectedChunks, retrievedChunks);
      
      expect(metrics.precision_at_k).toBe(0.4); // 2 relevantes de 5
      expect(metrics.recall_at_k).toBeCloseTo(0.667, 2); // 2 de 3 esperados
      expect(metrics.mrr).toBe(1); // primer relevante en posición 1
      expect(metrics.top_k_accuracy).toBe(1); // chunk_1 está en posición 1
    });

    test('debe manejar chunks sin relevantes', () => {
      const expectedChunks = ['chunk_1', 'chunk_2'];
      const retrievedChunks = [
        { id: 'chunk_3', content: 'test' },
        { id: 'chunk_4', content: 'test' }
      ];
      
      const metrics = evaluateRetrieval('query test', expectedChunks, retrievedChunks);
      
      expect(metrics.precision_at_k).toBe(0);
      expect(metrics.recall_at_k).toBe(0);
      expect(metrics.mrr).toBe(0);
      expect(metrics.top_k_accuracy).toBe(0);
    });

    test('debe manejar lista vacía de esperados', () => {
      const metrics = evaluateRetrieval('query', [], [{ id: 'chunk_1' }]);
      expect(metrics.recall_at_k).toBe(0);
    });

    test('debe manejar lista vacía de recuperados', () => {
      const metrics = evaluateRetrieval('query', ['chunk_1'], []);
      expect(metrics.precision_at_k).toBe(0);
      expect(metrics.recall_at_k).toBe(0);
    });
  });

  describe('evaluateFaithfulness', () => {
    test('debe retornar 1 para respuesta completamente respaldada', () => {
      const answer = 'El bakuchiol es una alternativa natural al retinol que estimula colágeno';
      const chunks = [
        { content: 'El bakuchiol es una alternativa natural al retinol' },
        { content: 'El bakuchiol estimula la producción de colágeno' }
      ];
      
      const score = evaluateFaithfulness(answer, chunks);
      expect(score).toBeGreaterThanOrEqual(0.8);
    });

    test('debe retornar score bajo para respuesta no respaldada', () => {
      const answer = 'El bakuchiol cura el cáncer y hace crecer cabello';
      const chunks = [
        { content: 'El bakuchiol es una alternativa natural al retinol' }
      ];
      
      const score = evaluateFaithfulness(answer, chunks);
      expect(score).toBeLessThan(0.5);
    });

    test('debe retornar 0 para respuesta vacía (sin keywords)', () => {
      const score = evaluateFaithfulness('', [{ content: 'test' }]);
      expect(score).toBe(0);
    });
  });

  describe('evaluateAnswerRelevancy', () => {
    test('debe calcular similitud coseno entre embeddings', async () => {
      generateEmbedding
        .mockResolvedValueOnce([0.8, 0.6]) // query embedding
        .mockResolvedValueOnce([0.8, 0.6]); // answer embedding
      
      const score = await evaluateAnswerRelevancy('¿Qué es bakuchiol?', 'El bakuchiol es un ingrediente natural');
      expect(score).toBeCloseTo(1, 1);
    });

    test('debe usar fallback de keyword overlap si embeddings fallan', async () => {
      generateEmbedding.mockRejectedValue(new Error('API Error'));
      
      const score = await evaluateAnswerRelevancy('bakuchiol retinol', 'El bakuchiol es alternativa al retinol');
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('evaluateContextPrecision', () => {
    test('debe calcular similitud promedio query-chunks', async () => {
      generateEmbedding
        .mockResolvedValueOnce([1, 0]) // query
        .mockResolvedValueOnce([1, 0]) // chunk 1
        .mockResolvedValueOnce([0, 1]); // chunk 2
      
      const chunks = [
        { content: 'chunk relevante' },
        { content: 'chunk no relevante' }
      ];
      
      const score = await evaluateContextPrecision('query test', chunks);
      expect(score).toBe(0.5); // (1 + 0) / 2
    });
  });

  describe('evaluateContextRecall', () => {
    test('debe calcular proporción de chunks esperados recuperados', () => {
      const expectedChunks = ['chunk_1', 'chunk_2', 'chunk_3'];
      const retrievedChunks = [
        { id: 'chunk_1' },
        { id: 'chunk_4' },
        { id: 'chunk_2' }
      ];
      
      const score = evaluateContextRecall('query', expectedChunks, retrievedChunks);
      expect(score).toBeCloseTo(0.667, 2); // 2 de 3
    });

    test('debe retornar 1 si no hay chunks esperados', () => {
      const score = evaluateContextRecall('query', [], [{ id: 'chunk_1' }]);
      expect(score).toBe(1);
    });
  });

  describe('compareWithBaseline', () => {
    test('debe detectar regresiones mayores al 10%', () => {
      const current = {
        summary: {
          retrieval: { precision_at_k: 0.60, recall_at_k: 0.50 },
          generation: { faithfulness: 0.70 }
        }
      };
      
      const baseline = {
        metrics: {
          retrieval: { precision_at_k: 0.75, recall_at_k: 0.65 },
          generation: { faithfulness: 0.85 }
        }
      };
      
      const comparison = compareWithBaseline(current, baseline);
      
      expect(comparison.has_baseline).toBe(true);
      expect(comparison.regressions.length).toBeGreaterThan(0);
      expect(comparison.overall_status).toBe('critical');
    });

    test('debe detectar mejoras', () => {
      const current = {
        summary: {
          retrieval: { precision_at_k: 0.85 },
          generation: { faithfulness: 0.90 }
        }
      };
      
      const baseline = {
        metrics: {
          retrieval: { precision_at_k: 0.75 },
          generation: { faithfulness: 0.80 }
        }
      };
      
      const comparison = compareWithBaseline(current, baseline);
      
      expect(comparison.improvements.length).toBeGreaterThan(0);
      expect(comparison.overall_status).toBe('stable');
    });

    test('debe manejar baseline ausente', () => {
      const comparison = compareWithBaseline({ summary: {} }, null);
      expect(comparison.has_baseline).toBe(false);
    });
  });

  describe('runEvaluationSuite', () => {
    test('debe ejecutar suite completa y retornar reporte estructurado', async () => {
      const dataset = {
        queries: [
          {
            id: 'test_001',
            category: 'skincare',
            difficulty: 'easy',
            query: 'test query',
            expected_chunks: ['chunk_1'],
            expected_answer_keywords: ['test']
          }
        ]
      };
      
      // Mock searchBeautyKnowledge
      jest.mock('../services/ragService', () => ({
        searchBeautyKnowledge: jest.fn().mockResolvedValue([
          { id: 'chunk_1', content: 'test content', score: 0.9 }
        ])
      }));
      
      // Mock generateEmbedding
      generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
      
      const report = await runEvaluationSuite(dataset, { generateAnswers: false, verbose: false });
      
      expect(report.summary.total_queries).toBe(1);
      expect(report.summary.successful).toBe(1);
      expect(report.per_query_results).toHaveLength(1);
    });
  });
});