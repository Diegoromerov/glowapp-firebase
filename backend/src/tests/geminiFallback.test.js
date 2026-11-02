/**
 * backend/src/tests/geminiFallback.test.js
 * Tests unitarios para el fallback de Gemini en geminiService.js
 */

// geminiService.js lee DEEPSEEK_API_KEY EN EL MOMENTO DE IMPORTARSE (linea 20) y el bloque
// del LLM vive dentro de `if (DEEPSEEK_API_KEY)` (linea 545). Sin clave, la seccion 5 no se
// ejecuta, el codigo salta a la respuesta por defecto y la suite NUNCA llega al codigo que
// dice medir: de ahi axios.post = 0 y el modelo de Gemini sin construir. Es valor de PRUEBA,
// no una credencial. Tiene que ir ANTES del require: despues ya es tarde.
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-no-real';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-no-real';

const { processAssistantMessage } = require('../services/geminiService');
const { breakers } = require('../services/circuitBreakerService');

// Mock de axios
jest.mock('axios');

// Mock de módulos dependientes con rutas correctas
jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('../services/websocketService', () => ({
  notifyUserChatMessage: jest.fn(),
  notifyUserAuraStatus: jest.fn(),
}));

// AURA_TOOLS_DEFINITIONS con las definiciones REALES (requireActual): antes este mock las
// vaciaba con [] y eso tapaba la deriva, porque la ruta Gemini usaba una copia hardcodeada
// propia. Ahora que las declaraciones se DERIVAN de esta lista, un mock vacio daria 0
// herramientas y el test lo detecta. Solo se sustituye executeAuraTool.
jest.mock('../services/auraToolExecutor', () => ({
  ...jest.requireActual('../services/auraToolExecutor'),
  executeAuraTool: jest.fn(),
}));

jest.mock('../services/ragService', () => ({
  searchBeautyKnowledge: jest.fn().mockResolvedValue([]),
  formatKnowledgeContext: jest.fn().mockReturnValue(''),
}));

// Mock abuseDetection to avoid Redis connection
jest.mock('../services/abuseDetection', () => ({
  trackAbuse: jest.fn().mockResolvedValue(undefined),
  isBlocked: jest.fn().mockResolvedValue({ blocked: false }),
}));

// Mock consentService to avoid Redis connection
jest.mock('../services/consentService', () => ({
  checkConsent: jest.fn().mockResolvedValue({ granted: true, grantedAt: new Date(), version: '1.0' }),
  logAccess: jest.fn().mockResolvedValue(undefined),
}));

const axios = require('axios');
const { pool } = require('../config/db');

describe('geminiFallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset circuit breakers to closed state
    if (breakers?.deepseek) breakers.deepseek.reset();
    if (breakers?.gemini) breakers.gemini.reset();

    // Re-setup default mocks after clearAllMocks
    const { isBlocked } = require('../services/abuseDetection');
    isBlocked.mockResolvedValue({ blocked: false });

    // Despachador por sentencia, no un mock ciego.
    // Un { rows: [] } para TODO hace que el INSERT ... RETURNING de geminiService.js:1000
    // devuelva cero filas y el codigo muera en :1005 leyendo row.sender_id: una sola
    // excepcion arrastraba los 4 rojos de la suite. Postgres SIEMPRE devuelve fila en un
    // INSERT ... RETURNING, asi que el mock debe imitarlo; responder vacio a todo no es
    // neutral, es una mentira del arnes.
    pool.query.mockImplementation(async (sql, params) => {
      if (/INSERT\s+INTO\s+messages/i.test(sql)) {
        return {
          rows: [{
            id: 'msg-test-1',
            sender_id: String(params?.[0] ?? 0),
            receiver_id: String(params?.[1] ?? 0),
            message: params?.[2] ?? '',
            is_read: false,
            created_at: new Date(),
          }],
        };
      }
      return { rows: [] }; // historial y demas SELECT: sin filas
    });

    // Default mock for axios (DeepSeek success)
    axios.post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: 'Respuesta de DeepSeek',
            tool_calls: undefined,
          },
        }],
      },
    });
  });

  describe('DeepSeek 402 (Insufficient Balance)', () => {
    test('debe hacer fallback a Gemini sin contar fallo en breaker', async () => {
      // Mock DeepSeek 402 error
      const deepseekError = new Error('Insufficient Balance');
      deepseekError.response = {
        status: 402,
        data: { error: { message: 'Insufficient Balance', code: 'insufficient_balance' } }
      };

      axios.post
        .mockRejectedValueOnce(deepseekError)  // DeepSeek falla
        .mockResolvedValueOnce({              // Gemini éxito
          data: { choices: [{ message: { content: 'Respuesta de Gemini fallback' } }] }
        });

      await processAssistantMessage(1, 'Hola, ¿qué tal?');

      // Verificar que se llamó a axios 1 vez (DeepSeek)
      // El fallback a Gemini se maneja internamente en el circuit breaker
      expect(axios.post).toHaveBeenCalledTimes(1);

      // Verificar que NO se abrió el breaker de DeepSeek por 402
      expect(breakers.deepseek.state).toBe('CLOSED');
    });
  });

  describe('DeepSeek 500 (Server Error)', () => {
    test('debe contar fallo y hacer fallback a Gemini', async () => {
      const serverError = new Error('Internal Server Error');
      serverError.response = { status: 500 };

      // El circuit breaker llama a la función asyncFunction (que hace axios.post)
      // Si falla, ejecuta el fallback internamente
      axios.post
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({
          data: { choices: [{ message: { content: 'Respuesta Gemini' } }] }
        });

      await processAssistantMessage(1, 'Hola');

      // axios.post se llama 1 vez para DeepSeek (dentro del circuit breaker)
      // El fallback a Gemini se maneja internamente en el circuit breaker
      expect(axios.post).toHaveBeenCalledTimes(1);

      // El breaker debería contar el fallo
      expect(breakers.deepseek.failureCount).toBeGreaterThanOrEqual(1);
      // El breaker NO se abre con un solo fallo: failureThreshold = 3
      // (circuitBreakerService.js:9). Este caso mide que el fallo SE CUENTA y que hay
      // fallback, no que se abra el circuito -- pedir 'OPEN' aqui contradecia el umbral
      // y el propio nombre del test. Se fija el contrato real, que ademas caza un
      // off-by-one en el umbral.
      expect(breakers.deepseek.failureCount).toBe(1);
      expect(breakers.deepseek.state).toBe('CLOSED');
    });
  });

  describe('DeepSeek breaker OPEN', () => {
    test('debe saltar directo a fallback sin llamar a DeepSeek', async () => {
      // Forzar breaker OPEN
      breakers.deepseek.state = 'OPEN';
      breakers.deepseek.failureCount = 3;

      // Mock para que falle y vaya a fallback
      axios.post
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockResolvedValueOnce({
          data: { choices: [{ message: { content: 'Respuesta Gemini directa' } }] }
        });

      await processAssistantMessage(1, 'Hola');

      // axios.post se llama para DeepSeek (asyncFunction del circuit breaker)
      // Luego el fallback llama a Gemini internamente
      expect(axios.post).toHaveBeenCalledTimes(1);

      // Verificar que la URL llamada es de DeepSeek (la llamada inicial)
      const calledUrl = axios.post.mock.calls[0][0];
      expect(calledUrl).toContain('deepseek');
    });
  });

  describe('Ambos breakers OPEN', () => {
    test('debe retornar respuesta segura por defecto', async () => {
      // Properly set OPEN state with cooldown already passed
      breakers.deepseek.state = 'OPEN';
      breakers.deepseek.nextAttempt = Date.now() - 1000; // Cooldown passed
      breakers.gemini.state = 'OPEN';
      breakers.gemini.nextAttempt = Date.now() - 1000; // Cooldown passed

      // Mock axios to fail for DeepSeek
      axios.post.mockRejectedValue(new Error('Service unavailable'));

      // Mock Gemini to also fail (GoogleGenerativeAI)
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      GoogleGenerativeAI.prototype.getGenerativeModel = jest.fn().mockImplementation(() => ({
        generateContent: jest.fn().mockRejectedValue(new Error('Gemini unavailable'))
      }));

      await processAssistantMessage(1, 'Hola');

      // Debe haber guardado la respuesta por defecto en la DB
      const insertCall = pool.query.mock.calls.find(call =>
        call[0].includes('INSERT INTO messages')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1]).toEqual(expect.arrayContaining([
        0, // AI_USER_ID
        1, // userId
        expect.stringContaining('¡Hola! Qué gusto saludarte') // Respuesta por defecto
      ]));
    }, 15000);
  });

  describe('Gemini Fallback expone las 11 herramientas AURA de la fuente unica', () => {
    test('debe incluir las 11 herramientas AURA en functionDeclarations (asertaba 11 con el nombre en 8)', async () => {
      // Forzar error en DeepSeek para activar fallback
      axios.post
        .mockRejectedValueOnce(new Error('DeepSeek fail'))
        .mockImplementationOnce(() => {
          // Capturar la llamada a Gemini para verificar tools
          const geminiCall = axios.post.mock.calls[1];
          return Promise.resolve({
            data: { choices: [{ message: { content: 'OK' } }] }
          });
        });

      // Mock GoogleGenerativeAI para capturar tools
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const originalGetGenerativeModel = GoogleGenerativeAI.prototype.getGenerativeModel;

      let capturedTools = null;
      GoogleGenerativeAI.prototype.getGenerativeModel = jest.fn((options) => {
        capturedTools = options.tools;
        return {
          generateContent: jest.fn().mockResolvedValue({
            response: {
              functionCalls: () => [],
              text: () => 'Respuesta Gemini'
            }
          })
        };
      });

      await processAssistantMessage(1, 'Hola');

      // Verificar que se pasaron 8 herramientas
      expect(capturedTools).toBeDefined();
      const declarations = capturedTools[0]?.functionDeclarations || [];
      // 14: la fuente única declara las 14 herramientas AURA (antes 11).
      expect(declarations.length).toBe(14);

      const toolNames = declarations.map(d => d.name);
      expect(toolNames).toContain('query_user_biometric_profile');
      expect(toolNames).toContain('search_nearby_services');
      expect(toolNames).toContain('check_provider_availability');
      expect(toolNames).toContain('evaluate_user_rebooking');
      expect(toolNames).toContain('recommend_glowstore_products');
      expect(toolNames).toContain('get_provider_b2b_insights');
      expect(toolNames).toContain('search_beauty_knowledge_rag');
      expect(toolNames).toContain('trigger_ui_redirection');

      // Restore
      GoogleGenerativeAI.prototype.getGenerativeModel = originalGetGenerativeModel;
    }, 15000);
  });

  describe('Historial 20 mensajes', () => {
    test('debe recuperar hasta 20 mensajes del historial', async () => {
      const mockHistory = Array.from({ length: 20 }, (_, i) => ({
        sender_id: i % 2 === 0 ? '1' : '0',
        receiver_id: i % 2 === 0 ? '0' : '1',
        message: `Mensaje ${i}`,
        created_at: new Date(Date.now() - (20 - i) * 1000),
      }));

      pool.query.mockResolvedValue({ rows: mockHistory });

      await processAssistantMessage(1, 'Nuevo mensaje');

      // Verificar que se consultó con LIMIT 20
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 20'),
        [1, 0]
      );
    });
  });
});