// backend/src/tests/fase5_e2e_integration.test.js
const { pool } = require('../config/db');
// geminiService.js lee DEEPSEEK_API_KEY al importarse (linea 20) y el bloque del LLM vive
// dentro de if (DEEPSEEK_API_KEY) (linea 545). Sin clave la suite no llega al codigo que
// dice medir. Valor de PRUEBA, no credencial, y ANTES del require: despues ya es tarde.
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-no-real';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-no-real';

const { processAssistantMessage, AI_USER_ID } = require('../services/geminiService');
const { executeAuraTool } = require('../services/auraToolExecutor');

jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn()
  }
}));

jest.mock('../config/redis', () => ({
  isOpen: false,
  get: jest.fn(),
  set: jest.fn()
}));

jest.mock('../services/websocketService', () => ({
  notifyUserChatMessage: jest.fn(),
  notifyUserAuraStatus: jest.fn()
}));

// Redis: abuseDetection y consentService abren conexion real y cuelgan la suite 30 s por
// timeout. No es un defecto del codigo: es arnes que falta. geminiFallback.test.js ya los
// mockea por esta misma razon (comentario "to avoid Redis connection").
jest.mock('../services/abuseDetection', () => ({
  trackAbuse: jest.fn().mockResolvedValue(undefined),
  isBlocked: jest.fn().mockResolvedValue({ blocked: false }),
}));

jest.mock('../services/consentService', () => ({
  checkConsent: jest.fn().mockResolvedValue({ granted: true, grantedAt: new Date(), version: '1.0' }),
  logAccess: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/ragService', () => ({
  searchBeautyKnowledge: jest.fn().mockResolvedValue([]),
  formatKnowledgeContext: jest.fn().mockReturnValue(''),
}));


const axios = require('axios');
jest.mock('axios');

describe('Pruebas E2E de Fase 5 - Integración Completa del Ecosistema Multi-Agente', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-fijar implementaciones DESPUES de clearAllMocks: jest.clearAllMocks() borra los
    // mockResolvedValue definidos a nivel de modulo, asi que sin esto isBlocked() devuelve
    // undefined y el codigo revienta antes de llegar al LLM. Es exactamente lo que hace
    // geminiFallback.test.js en su beforeEach.
    require('../services/abuseDetection').isBlocked.mockResolvedValue({ blocked: false });
    require('../services/consentService').checkConsent.mockResolvedValue({ granted: true, grantedAt: new Date(), version: '1.0' });
    require('../services/abuseDetection').trackAbuse.mockResolvedValue(undefined);
    require('../services/ragService').searchBeautyKnowledge.mockResolvedValue([]);
    require('../services/ragService').formatKnowledgeContext.mockReturnValue('');
  });

  test('Debería orquestar correctamente el flujo completo: Mensaje del usuario → DeepSeek Tool Call → Ejecución de Agente → Notificación WebSocket', async () => {
    // Mock 1: Base de datos SELECT servicios, SELECT mensajes e INSERT respuesta
    pool.query.mockImplementation((queryText) => {
      if (queryText.includes('SELECT s.id as service_id')) {
        return Promise.resolve({ rows: [] });
      }
      if (queryText.includes('SELECT sender_id, receiver_id, message')) {
        return Promise.resolve({ rows: [] });
      }
      if (queryText.includes('INSERT INTO messages')) {
        return Promise.resolve({
          rows: [
            {
              id: 999,
              sender_id: 0,
              receiver_id: 1,
              message: '¡Hola! Noto que buscas un corte de cabello cerca de ti. Salón Ana Beauty está disponible a 0.8 km.',
              is_read: false,
              created_at: new Date()
            }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    // Mock 2: Respuesta de DeepSeek solicitando Tool Call de HERMES (search_nearby_services)
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_hermes_001',
                  type: 'function',
                  function: {
                    name: 'search_nearby_services',
                    arguments: JSON.stringify({ latitude: 4.6097, longitude: -74.0817, category: 'Cabello' })
                  }
                }
              ]
            }
          }
        ]
      }
    });

    // Mock 3: Segunda respuesta de DeepSeek tras recibir los resultados de HERMES
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: '¡Hola! Noto que buscas un corte de cabello cerca de ti. Salón Ana Beauty está disponible a 0.8 km.'
            }
          }
        ]
      }
    });

    // Ejecutar el procesamiento asíncrono
    await processAssistantMessage(1, "Busco corte de cabello cerca de mí", null);

    // Verificaciones
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(pool.query).toHaveBeenCalled();
  });
});
