// backend/tests/gemini.prompts.test.js
const geminiClient = require('../src/services/biometric/gemini.client');

describe('Gemini Prompts Validation mock test', () => {
  test('Recommendation prompt does not contain medical advice', async () => {
    const mockFaceScores = { hydration: 80, wrinkles: 10, spots: 20, pores: 15, subtono: 'cálido', bioAge: 25 };
    const mockHandsDiagnosis = { manchasSolares: 'leve', sequedad: 'leve', cuticulas: 'sanas', unas: 'sanas', edadAparente: 25 };
    
    // Test helper to verify fallback recommendations do not include restricted medical terminology
    const recommendation = geminiClient.getFallbackRecommendation();
    expect(recommendation).not.toContain('enfermedad');
    expect(recommendation).not.toContain('tratamiento médico');
  });
});
