/**
 * backend/src/tests/contextCompressor.test.js
 * Tests unitarios para contextCompressor.js
 */

const { 
  compressHistory, 
  generateSimpleSummary,
  getCachedSummary,
  setCachedSummary,
  clearUserCache,
  getCacheStats 
} = require('../services/contextCompressor');

describe('contextCompressor', () => {
  beforeEach(() => {
    clearUserCache('test-user');
  });

  describe('compressHistory', () => {
    test('≤20 mensajes → sin compresión', async () => {
      const messages = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Mensaje ${i}`,
      }));
      
      const result = await compressHistory(messages, 'test-user');
      
      expect(result).toHaveLength(15);
      expect(result).toEqual(messages);
    });

    test('20 mensajes exactos → sin compresión', async () => {
      const messages = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Mensaje ${i}`,
      }));
      
      const result = await compressHistory(messages, 'test-user');
      
      expect(result).toHaveLength(20);
    });

    test('>20 mensajes → compresión de primeros N, mantener últimos 15', async () => {
      const messages = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Mensaje ${i}`,
      }));
      
      const result = await compressHistory(messages, 'test-user');
      
      // Debe tener: 1 summary + 15 recientes = 16
      expect(result).toHaveLength(16);
      
      // Primer mensaje debe ser el summary
      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('Resumen:');
      expect(result[0].content).toContain('15 mensajes anteriores comprimidos');
      
      // Los siguientes 15 deben ser los últimos 15 originales
      expect(result[1].content).toBe('Mensaje 15');
      expect(result[15].content).toBe('Mensaje 29');
    });

    test('debe manejar mensajes con formato sender_id/receiver_id (historial DB)', async () => {
      const messages = Array.from({ length: 25 }, (_, i) => ({
        sender_id: i % 2 === 0 ? '1' : '0',
        receiver_id: i % 2 === 0 ? '0' : '1',
        message: `Mensaje ${i}`,
        created_at: new Date(),
      }));
      
      const result = await compressHistory(messages, 'test-user');
      
      expect(result).toHaveLength(16);
      expect(result[0].role).toBe('system');
    });

    test('debe manejar array vacío', async () => {
      const result = await compressHistory([], 'test-user');
      expect(result).toEqual([]);
    });

    test('debe manejar null/undefined', async () => {
      const result1 = await compressHistory(null, 'test-user');
      const result2 = await compressHistory(undefined, 'test-user');
      
      expect(result1).toEqual([]);
      expect(result2).toEqual([]);
    });
  });

  describe('generateSimpleSummary', () => {
    test('debe extraer temas principales de mensajes de usuario', () => {
      const messages = [
        { role: 'user', content: 'Quiero agendar una cita para facial' },
        { role: 'assistant', content: 'Claro, ¿qué día?' },
        { role: 'user', content: 'El viernes por la tarde' },
      ];
      
      const summary = generateSimpleSummary(messages);
      
      expect(summary).toContain('Resumen:');
      expect(summary).toContain('cita');
    });

    test('debe detectar múltiples temas', () => {
      const messages = [
        { role: 'user', content: 'Precio del tratamiento láser' },
        { role: 'assistant', content: 'El láser cuesta $500' },
        { role: 'user', content: '¿Tienen productos para piel grasa?' },
      ];
      
      const summary = generateSimpleSummary(messages);
      
      expect(summary).toContain('precio');
      expect(summary).toContain('tratamiento');
      expect(summary).toContain('producto');
      expect(summary).toContain('piel');
    });

    test('debe manejar mensajes vacíos', () => {
      const summary = generateSimpleSummary([]);
      expect(summary).toBe('Sin mensajes previos');
    });
  });

  describe('Cache operations', () => {
    test('setCachedSummary y getCachedSummary deben funcionar', async () => {
      await setCachedSummary('test-user', 'Resumen de prueba');
      const cached = await getCachedSummary('test-user');
      
      expect(cached).toBe('Resumen de prueba');
    });

    test('clearUserCache debe limpiar cache', async () => {
      await setCachedSummary('test-user', 'Resumen');
      await clearUserCache('test-user');
      const cached = await getCachedSummary('test-user');
      
      expect(cached).toBeNull();
    });

    test('getCacheStats debe retornar stats', () => {
      const stats = getCacheStats();
      
      expect(stats).toHaveProperty('memorySize');
      expect(stats).toHaveProperty('keys');
      expect(typeof stats.memorySize).toBe('number');
      expect(Array.isArray(stats.keys)).toBe(true);
    });
  });
});