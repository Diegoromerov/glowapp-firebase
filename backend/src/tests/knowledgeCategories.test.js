/**
 * Test unitario del vocabulario canónico de categorías.
 * La coherencia con la base de datos se verifica con
 * `node scripts/verifyKnowledgeCategories.js` (necesita conexión).
 */

const {
  KNOWLEDGE_CATEGORIES,
  normalizeCategory,
  resolveCategory,
} = require('../config/knowledgeCategories');

describe('knowledgeCategories', () => {
  test('el vocabulario tiene 12 categorías únicas y en snake_case', () => {
    expect(KNOWLEDGE_CATEGORIES).toHaveLength(12);
    expect(new Set(KNOWLEDGE_CATEGORIES).size).toBe(12);
    for (const c of KNOWLEDGE_CATEGORIES) {
      expect(c).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    }
  });

  test('normaliza acentos, mayúsculas y espacios', () => {
    expect(normalizeCategory('  Guías Uñas ')).toBe('guias_unas');
    expect(normalizeCategory('COLORIMETRIA_PIEL_UNDERTONE')).toBe('colorimetria_piel_undertone');
  });

  test('resuelve valores válidos (incluidas variantes) y rechaza los que no existen', () => {
    expect(resolveCategory('guias_unas')).toBe('guias_unas');
    expect(resolveCategory('Guías Uñas')).toBe('guias_unas');
    expect(resolveCategory('Diagnóstico Capilar')).toBe('diagnostico_capilar');
  });

  test('rechaza etiquetas humanas y valores inventados (no existe mapeo 1:1)', () => {
    for (const v of ['Piel', 'Cabello', 'Uñas', 'Cejas', 'skincare', 'ingredientes', 'rutinas', '', null, undefined, 'BUSINESS']) {
      expect(resolveCategory(v)).toBeNull();
    }
  });
});
