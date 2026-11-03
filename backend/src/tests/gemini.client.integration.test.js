// backend/src/tests/gemini.client.integration.test.js
/**
 * Integration tests for Gemini client focusing on resilience behavior.
 * We mock axios to simulate external failures and verify retry behavior.
 */

jest.mock('axios');
const geminiClient = require('../services/biometric/gemini.client');
const { breakers } = require('../services/circuitBreakerService');

describe('GeminiClient Resilience Integration', () => {
  let axiosMock;

  beforeEach(() => {
    axiosMock = require('axios');
    // Set a dummy API key to avoid early throws
    geminiClient.apiKey = 'test-key';
    // Reset the Gemini circuit breaker to avoid cross-test pollution
    breakers.gemini.reset();
    breakers.gemini.failureThreshold = 10;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('analyzeHands reintenta y falla en cerrado (sin diagnostico simulado)', async () => {
    axiosMock.post.mockRejectedValue(new Error('Network Error'));

    const imageBase64 = 'base64image';

    // El fallback (manchasSolares:'leve', edadAparente:35, ...) se elimino en 94b199b45
    // junto con `getFallbackHandsDiagnosis`: un diagnostico inventado sobre las manos de
    // una persona no puede presentarse como resultado.
    await expect(geminiClient.analyzeHands(imageBase64)).rejects.toThrow();

    // 1 intento + 3 reintentos = 4 llamadas
    expect(axiosMock.post).toHaveBeenCalledTimes(4);
  });

  test('generateRecommendation reintenta y falla en cerrado (sin receta simulada)', async () => {
    axiosMock.post.mockRejectedValue(new Error('Network Error'));

    const faceScores = { hydration: 50, wrinkles: 30, spots: 20, pores: 40, subtono: 'cálido', bioAge: 25 };
    const handsDiagnosis = { manchasSolares: 'leve', sequedad: 'moderada', cuticulas: 'sanas', unas: 'sanas', edadAparente: 30 };

    // El fallback servia una recomendacion dermatologica escrita a mano y la presentaba
    // como generada por el modelo. Se elimino en 94b199b45 junto con
    // `getFallbackRecommendation`.
    await expect(geminiClient.generateRecommendation(faceScores, handsDiagnosis)).rejects.toThrow();

    expect(axiosMock.post).toHaveBeenCalledTimes(4);
  });
});