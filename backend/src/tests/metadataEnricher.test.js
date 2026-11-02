/**
 * backend/src/tests/metadataEnricher.test.js
 * Tests unitarios para metadataEnricher.js
 */

const { 
  enrichChunkMetadata, 
  determineCategory,
  determineSkinType,
  determineSeasonStation,
  determineAgeRange,
  extractIngredients,
  extractContraindications,
  clearCache,
  getCacheStats,
  CATEGORY_KEYWORDS,
  SKIN_TYPE_KEYWORDS,
  SEASON_KEYWORDS,
  AGE_RANGE_KEYWORDS,
  KNOWN_INGREDIENTS,
  KNOWN_CONTRAINDICATIONS
} = require('../services/metadataEnricher');

describe('metadataEnricher', () => {
  
  beforeEach(() => {
    clearCache();
  });
  
  describe('determineCategory', () => {
    test('debe clasificar skincare por keywords', () => {
      expect(determineCategory('La niacinamida reduce poros y acné')).toBe('skincare');
      expect(determineCategory('Crema hidratante con ceramidas')).toBe('skincare');
      expect(determineCategory('Protector solar FPS 50')).toBe('skincare');
    });
    
    test('debe clasificar maquillaje por keywords', () => {
      expect(determineCategory('Base de maquillaje cobertura media')).toBe('maquillaje');
      expect(determineCategory('Labial mate larga duración')).toBe('maquillaje');
      expect(determineCategory('Sombra de ojos pigmentada')).toBe('maquillaje');
    });
    
    test('debe clasificar cabello por keywords', () => {
      expect(determineCategory('Champú para cabello graso')).toBe('cabello');
      expect(determineCategory('Mascarilla capilar nutritiva')).toBe('cabello');
      expect(determineCategory('Tinte para canas')).toBe('cabello');
    });
    
    test('debe usar categoría del documento si existe', () => {
      expect(determineCategory('Texto genérico', 'maquillaje')).toBe('maquillaje');
      expect(determineCategory('Texto genérico', 'cabello')).toBe('cabello');
    });
    
    test('debe default a skincare si no hay keywords', () => {
      expect(determineCategory('Texto sin keywords relevantes')).toBe('skincare');
    });
  });
  
  describe('determineSkinType', () => {
    test('debe detectar piel grasa', () => {
      expect(determineSkinType('Piel grasa con mucho sebo')).toBe('grasa');
      expect(determineSkinType('Poros abiertos y brillo')).toBe('grasa');
    });
    
    test('debe detectar piel seca', () => {
      expect(determineSkinType('Piel seca y tirante')).toBe('seca');
      expect(determineSkinType('Deshidratación y descamación')).toBe('seca');
    });
    
    test('debe detectar piel mixta', () => {
      expect(determineSkinType('Zona T grasa y mejillas secas')).toBe('mixta');
    });
    
    test('debe detectar piel sensible', () => {
      expect(determineSkinType('Piel sensible con rojeces')).toBe('sensible');
      expect(determineSkinType('Rosácea y dermatitis')).toBe('sensible');
    });
    
    test('debe retornar null si no detecta tipo de piel', () => {
      expect(determineSkinType('Texto sin tipo de piel')).toBeNull();
    });
  });
  
  describe('determineSeasonStation', () => {
    test('debe detectar primavera', () => {
      expect(determineSeasonStation('Tonos melocotón y coral para primavera')).toBe('primavera');
    });
    
    test('debe detectar verano', () => {
      expect(determineSeasonStation('Tonos fríos como azul pastel para verano')).toBe('verano');
    });
    
    test('debe detectar otoño', () => {
      expect(determineSeasonStation('Tonos terracota y mostaza de otoño')).toBe('otoño');
    });
    
    test('debe detectar invierno', () => {
      expect(determineSeasonStation('Tonos intensos como rojo puro para invierno')).toBe('invierno');
    });
    
    test('debe retornar null si no detecta estación', () => {
      expect(determineSeasonStation('Texto sin estación')).toBeNull();
    });
  });
  
  describe('determineAgeRange', () => {
    test('debe detectar adolescencia', () => {
      expect(determineAgeRange('Acné juvenil en adolescentes')).toBe('adolescencia');
    });
    
    test('debe detectar 20-30', () => {
      expect(determineAgeRange('Primeras arrugas a los 25')).toBe('20-30');
    });
    
    test('debe detectar 30-40', () => {
      expect(determineAgeRange('Líneas de expresión a los 35')).toBe('30-40');
    });
    
    test('debe detectar 40-50', () => {
      expect(determineAgeRange('Arrugas marcadas a los 45')).toBe('40-50');
    });
    
    test('debe detectar 50+', () => {
      expect(determineAgeRange('Piel madura a los 55')).toBe('50+');
    });
    
    test('debe retornar null si no detecta rango etario', () => {
      expect(determineAgeRange('Texto sin edad')).toBeNull();
    });
  });
  
  describe('extractIngredients', () => {
    test('debe extraer ingredientes conocidos', () => {
      const text = 'Sérum con niacinamida y ácido hialurónico';
      const ingredients = extractIngredients(text);
      
      expect(ingredients).toContain('niacinamida');
      expect(ingredients).toContain('ácido hialurónico');
    });
    
    test('debe extraer múltiples ingredientes', () => {
      const text = 'Retinol, vitamina C, ceramidas y péptidos';
      const ingredients = extractIngredients(text);
      
      expect(ingredients.length).toBeGreaterThanOrEqual(3);
      expect(ingredients).toContain('retinol');
      expect(ingredients).toContain('vitamina c');
      expect(ingredients).toContain('ceramidas');
    });
    
    test('debe deduplicar ingredientes', () => {
      const text = 'Niacinamida y más niacinamida';
      const ingredients = extractIngredients(text);
      
      expect(ingredients.filter(i => i === 'niacinamida').length).toBe(1);
    });
    
    test('debe retornar array vacío si no hay ingredientes', () => {
      const ingredients = extractIngredients('Texto sin ingredientes');
      expect(ingredients).toEqual([]);
    });
  });
  
  describe('extractContraindications', () => {
    test('debe extraer contraindicaciones conocidas', () => {
      const text = 'No usar durante embarazo ni lactancia';
      const contras = extractContraindications(text);
      
      expect(contras).toContain('embarazo');
      expect(contras).toContain('lactancia');
    });
    
    test('debe detectar piel sensible como contraindicación', () => {
      const contras = extractContraindications('No usar en piel sensible');
      expect(contras).toContain('piel sensible');
    });
    
    test('debe retornar array vacío si no hay contraindicaciones', () => {
      const contras = extractContraindications('Producto seguro para todos');
      expect(contras).toEqual([]);
    });
  });
  
  describe('enrichChunkMetadata', () => {
    test('debe enriquecer chunk con metadata completa', async () => {
      const chunk = 'La niacinamida al 5% reduce poros y controla sebo en piel grasa';
      const docMeta = { category: 'skincare', source: 'glowapp_curated' };
      
      const metadata = await enrichChunkMetadata(chunk, docMeta);
      
      expect(metadata.category).toBe('skincare');
      expect(metadata.skin_type).toBe('grasa');
      expect(metadata.ingredients).toContain('niacinamida');
      expect(metadata._enrichment_method).toBe('heuristic');
      expect(metadata._ambiguity_score).toBeGreaterThanOrEqual(0);
    });
    
    test('debe ser determinista (cache por content_hash)', async () => {
      const chunk = 'Test determinista para cache';
      const docMeta = { category: 'skincare' };
      
      const meta1 = await enrichChunkMetadata(chunk, docMeta);
      const meta2 = await enrichChunkMetadata(chunk, docMeta);
      
      expect(meta1).toEqual(meta2);
    });
    
    test('debe usar metadata del documento como fallback', async () => {
      const chunk = 'Texto genérico sin keywords';
      const docMeta = { category: 'maquillaje', skin_type: 'seca' };
      
      const metadata = await enrichChunkMetadata(chunk, docMeta);
      
      expect(metadata.category).toBe('maquillaje');
      expect(metadata.skin_type).toBe('seca');
    });
    
    test('debe manejar chunk vacío', async () => {
      const metadata = await enrichChunkMetadata('', {});
      
      expect(metadata.category).toBe('skincare'); // default
      expect(metadata.skin_type).toBe('todos');
    });
  });
  
  describe('Cache', () => {
    test('clearCache debe limpiar el cache', () => {
      const { metadataCache } = require('../services/metadataEnricher');
      // Acceder a cache interno via getCacheStats
      const stats1 = getCacheStats();
      expect(stats1.size).toBe(0);
    });
    
    test('getCacheStats debe retornar stats', () => {
      const stats = getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('keys');
    });
  });
  
  describe('Constantes exportadas', () => {
    test('debe exportar constantes de keywords', () => {
      expect(CATEGORY_KEYWORDS).toHaveProperty('skincare');
      expect(SKIN_TYPE_KEYWORDS).toHaveProperty('grasa');
      expect(SEASON_KEYWORDS).toHaveProperty('primavera');
      expect(AGE_RANGE_KEYWORDS).toHaveProperty('adolescencia');
    });
    
    test('debe exportar ingredientes y contraindicaciones conocidos', () => {
      expect(KNOWN_INGREDIENTS.length).toBeGreaterThan(50);
      expect(KNOWN_CONTRAINDICATIONS.length).toBeGreaterThan(10);
      expect(KNOWN_INGREDIENTS).toContain('niacinamida');
      expect(KNOWN_CONTRAINDICATIONS).toContain('embarazo');
    });
  });
});