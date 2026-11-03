/**
 * backend/src/tests/ragLogger.test.js
 * Tests unitarios para ragLogger.js
 */

const { 
  logRagQuery, 
  generateTraceId, 
  getRagMetrics,
  getCircuitBreakerStats,
  sanitizeQuery,
  sanitizeChunksForLog,
  formatToolCallsForLog
} = require('../services/ragLogger');

const { breakers } = require('../services/circuitBreakerService');

describe('ragLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateTraceId', () => {
    test('debe generar UUID válido', () => {
      const traceId = generateTraceId();
      expect(traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    test('debe generar IDs únicos', () => {
      const id1 = generateTraceId();
      const id2 = generateTraceId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('sanitizeQuery', () => {
    test('debe sanitizar query con PII', () => {
      const query = 'Mi email es juan@test.com y mi teléfono es 3001234567';
      const sanitized = sanitizeQuery(query);
      
      expect(sanitized).not.toContain('juan@test.com');
      expect(sanitized).not.toContain('3001234567');
      expect(sanitized).toContain('[EMAIL_REDACTED]');
      expect(sanitized).toContain('[TELEFONO_REDACTED]');
    });

    test('debe manejar query vacía', () => {
      const sanitized = sanitizeQuery('');
      expect(sanitized).toBe('[EMPTY]');
    });

    test('debe manejar null/undefined', () => {
      expect(sanitizeQuery(null)).toBe('[EMPTY]');
      expect(sanitizeQuery(undefined)).toBe('[EMPTY]');
    });
  });

  describe('sanitizeChunksForLog', () => {
    test('debe sanitizar chunks para logs', () => {
      const chunks = [
        { id: 1, similarity: 0.85, category: 'skincare', content: 'contenido largo...' },
        { id: 2, similarity: 0.72, skinType: 'grasa', content: 'otro contenido' },
      ];
      
      const sanitized = sanitizeChunksForLog(chunks);
      
      expect(sanitized).toHaveLength(2);
      expect(sanitized[0]).toHaveProperty('chunk_id');
      expect(sanitized[0]).toHaveProperty('similarity_score', 0.85);
      expect(sanitized[0]).toHaveProperty('category', 'skincare');
      expect(sanitized[0]).not.toHaveProperty('content');
      expect(sanitized[0]).toHaveProperty('has_content', true);
    });

    test('debe limitar a top 3', () => {
      const chunks = Array.from({ length: 5 }, (_, i) => ({ 
        id: i, 
        similarity: 0.9 - i * 0.1,
        content: 'content'
      }));
      
      const sanitized = sanitizeChunksForLog(chunks);
      expect(sanitized).toHaveLength(3);
    });

    test('debe manejar array vacío/null', () => {
      expect(sanitizeChunksForLog([])).toEqual([]);
      expect(sanitizeChunksForLog(null)).toEqual([]);
      expect(sanitizeChunksForLog(undefined)).toEqual([]);
    });
  });

  describe('formatToolCallsForLog', () => {
    test('debe formatear tool calls para logs', () => {
      const toolCalls = [
        { name: 'search_beauty_knowledge_rag', args: { queryText: 'niacinamida' }, latency_ms: 150 },
        { name: 'query_user_biometric_profile', args: { user_id: '123' }, success: true },
      ];
      
      const formatted = formatToolCallsForLog(toolCalls);
      
      expect(formatted).toHaveLength(2);
      expect(formatted[0]).toHaveProperty('name', 'search_beauty_knowledge_rag');
      expect(formatted[0]).toHaveProperty('args_sanitized');
      expect(formatted[0]).toHaveProperty('latency_ms', 150);
      expect(formatted[0]).toHaveProperty('success', true);
    });

    test('debe manejar array vacío', () => {
      expect(formatToolCallsForLog([])).toEqual([]);
      expect(formatToolCallsForLog(null)).toEqual([]);
    });
  });

  describe('getCircuitBreakerStats', () => {
    test('debe retornar estado de breakers', () => {
      const stats = getCircuitBreakerStats();
      expect(stats).toHaveProperty('deepseek');
      expect(stats).toHaveProperty('gemini');
      expect(stats.deepseek).toHaveProperty('state');
      expect(stats.deepseek).toHaveProperty('failureCount');
    });
  });

  describe('logRagQuery', () => {
    test('debe ejecutarse sin errores', async () => {
      const traceData = {
        user_id: 123,
        query: 'Test query',
        llm_used: 'deepseek',
        total_latency_ms: 500,
      };
      
      await expect(logRagQuery(traceData)).resolves.not.toThrow();
    });

    test('debe generar trace_id si no se proporciona', async () => {
      const traceData = {
        user_id: 123,
        query: 'Test query',
        llm_used: 'gemini',
        total_latency_ms: 300,
      };
      
      await expect(logRagQuery(traceData)).resolves.not.toThrow();
    });
  });

  describe('getRagMetrics', () => {
    test('debe ejecutarse sin errores', async () => {
      await expect(getRagMetrics({})).resolves.not.toThrow();
    });
  });
});