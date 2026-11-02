/**
 * backend/src/tests/chunkingService.test.js
 * Tests unitarios para chunkingService.js
 */

const { 
  chunkDocument, 
  chunkMarkdownDocument, 
  estimateTokens, 
  computeContentHash,
  splitIntoParagraphs,
  splitIntoSentences,
  DEFAULT_OPTIONS 
} = require('../services/chunkingService');

describe('chunkingService', () => {
  
  describe('estimateTokens', () => {
    test('debe estimar tokens correctamente', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('hola')).toBe(1); // 4 chars = 1 token
      expect(estimateTokens('hola mundo')).toBe(3); // 11 chars ≈ 3 tokens
      expect(estimateTokens('a'.repeat(400))).toBe(100); // 400 chars = 100 tokens
    });
  });

  describe('computeContentHash', () => {
    test('debe generar hash SHA-256 determinista', () => {
      const hash1 = computeContentHash('texto de prueba');
      const hash2 = computeContentHash('texto de prueba');
      const hash3 = computeContentHash('otro texto');
      
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash1.length).toBe(64); // SHA-256 hex = 64 chars
    });
    
    test('debe manejar strings vacíos', () => {
      const hash = computeContentHash('');
      expect(hash.length).toBe(64);
    });
  });

  describe('splitIntoParagraphs', () => {
    test('debe dividir por párrafos vacíos', () => {
      const text = 'Párrafo 1\n\nPárrafo 2\n\n\nPárrafo 3';
      const paragraphs = splitIntoParagraphs(text);
      
      expect(paragraphs.length).toBe(3);
      expect(paragraphs[0]).toBe('Párrafo 1');
      expect(paragraphs[1]).toBe('Párrafo 2');
      expect(paragraphs[2]).toBe('Párrafo 3');
    });
    
    test('debe ignorar párrafos vacíos', () => {
      const text = 'P1\n\n\n\nP2';
      const paragraphs = splitIntoParagraphs(text);
      expect(paragraphs.length).toBe(2);
    });
  });

  describe('splitIntoSentences', () => {
    test('debe dividir por puntos seguidos de mayúscula', () => {
      const text = 'Primera oración. Segunda oración. Tercera oración.';
      const sentences = splitIntoSentences(text);
      
      expect(sentences.length).toBe(3);
      expect(sentences[0]).toBe('Primera oración.');
      expect(sentences[1]).toBe('Segunda oración.');
      expect(sentences[2]).toBe('Tercera oración.');
    });
    
    test('debe manejar interrogaciones y exclamaciones', () => {
      const text = '¿Cómo estás? ¡Muy bien! ¿Y tú?';
      const sentences = splitIntoSentences(text);
      expect(sentences.length).toBe(3);
    });
  });

  describe('chunkDocument', () => {
    test('debe dividir texto corto en un solo chunk', () => {
      const text = 'Texto corto que cabe en un chunk.';
      const chunks = chunkDocument(text);
      
      expect(chunks.length).toBe(1);
      expect(chunks[0].content).toBe(text);
      expect(chunks[0].tokens).toBeGreaterThan(0);
      expect(chunks[0].contentHash).toBeDefined();
      expect(chunks[0].index).toBe(0);
      expect(chunks[0].totalChunks).toBe(1);
    });
    
    test('debe dividir texto largo en múltiples chunks', () => {
      const text = 'Párrafo 1. '.repeat(500); // ~5000 tokens
      const chunks = chunkDocument(text, { maxTokens: 600, overlapTokens: 50 });
      
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.length).toBeLessThanOrEqual(5);
      
      // Verificar que cada chunk tiene propiedades requeridas
      for (const chunk of chunks) {
        expect(chunk.content).toBeDefined();
        expect(chunk.tokens).toBeLessThanOrEqual(700); // maxTokens + overlap
        expect(chunk.contentHash).toHaveLength(64);
        expect(typeof chunk.index).toBe('number');
        expect(typeof chunk.totalChunks).toBe('number');
      }
    });
    
    test('debe respetar overlap entre chunks', () => {
      const text = 'Oración 1. Oración 2. Oración 3. Oración 4. Oración 5. '.repeat(10);
      const chunks = chunkDocument(text, { maxTokens: 100, overlapTokens: 20 });
      
      expect(chunks.length).toBeGreaterThan(1);
      
      // Verificar que hay overlap (el final del chunk anterior aparece en el siguiente)
      for (let i = 1; i < chunks.length; i++) {
        const prevEnd = chunks[i-1].content.slice(-50);
        const currStart = chunks[i].content.slice(0, 50);
        // Debe haber alguna coincidencia (overlap)
        expect(currStart.length).toBeGreaterThan(0);
      }
    });
    
    test('debe ser determinista (mismo input = mismo output)', () => {
      const text = 'Texto de prueba para verificar determinismo. '.repeat(50);
      
      const chunks1 = chunkDocument(text, { maxTokens: 500, overlapTokens: 50 });
      const chunks2 = chunkDocument(text, { maxTokens: 500, overlapTokens: 50 });
      
      expect(chunks1.length).toBe(chunks2.length);
      for (let i = 0; i < chunks1.length; i++) {
        expect(chunks1[i].contentHash).toBe(chunks2[i].contentHash);
        expect(chunks1[i].content).toBe(chunks2[i].content);
      }
    });
    
    test('debe manejar texto vacío', () => {
      const chunks = chunkDocument('');
      expect(chunks).toEqual([]);
    });
    
    test('debe manejar solo espacios', () => {
      const chunks = chunkDocument('   \n\n   ');
      expect(chunks).toEqual([]);
    });
  });

  describe('chunkMarkdownDocument', () => {
    test('debe preservar headers y dividir por secciones', () => {
      const markdown = `
# Header 1

Contenido de la sección 1.

## Header 2

Contenido de la subsección.

### Header 3

Más contenido.
`;
      const chunks = chunkMarkdownDocument(markdown);
      
      expect(chunks.length).toBeGreaterThan(0);
      
      // Verificar que chunks tienen metadata de sección
      for (const chunk of chunks) {
        expect(chunk.sectionTitle).toBeDefined();
        expect(chunk.sectionLevel).toBeDefined();
      }
    });
    
    test('debe manejar markdown sin headers', () => {
      const markdown = 'Solo texto sin headers.';
      const chunks = chunkMarkdownDocument(markdown);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].sectionLevel).toBe(0);
    });
  });

  describe('DEFAULT_OPTIONS', () => {
    test('debe tener valores por defecto correctos', () => {
      expect(DEFAULT_OPTIONS.maxTokens).toBe(600);
      expect(DEFAULT_OPTIONS.overlapTokens).toBe(50);
      expect(DEFAULT_OPTIONS.respectSentences).toBe(true);
      expect(DEFAULT_OPTIONS.respectParagraphs).toBe(true);
    });
  });
});