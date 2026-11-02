// backend/src/tests/geminiService.test.js
const { pool } = require('../config/db');

// Mockear el pool de la base de datos
jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn()
  }
}));

// Mockear el servicio de websockets para evitar envíos en la prueba
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


// Mockear axios para las llamadas a DeepSeek
const axios = require('axios');
jest.mock('axios');
axios.post.mockResolvedValue({
  data: {
    choices: [
      {
        message: {
          content: "Respuesta de Aura de prueba"
        }
      }
    ]
  }
});

// Importar después de configurar mocks
// geminiService.js lee DEEPSEEK_API_KEY al importarse (linea 20) y el bloque del LLM vive
// dentro de if (DEEPSEEK_API_KEY) (linea 545). Sin clave la suite no llega al codigo que
// dice medir. Valor de PRUEBA, no credencial, y ANTES del require: despues ya es tarde.
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-no-real';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-no-real';

const { processAssistantMessage, sanitizeAiResponseText, parseDsmlToolCalls, AI_USER_ID } = require('../services/geminiService');

describe('Pruebas unitarias de Asistente de IA (geminiService.js)', () => {
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

  test('Debería agrupar mensajes consecutivos del mismo emisor e impedir roles consecutivos', async () => {
    // 1. Configurar mock de base de datos
    pool.query.mockImplementation((queryText, params) => {
      if (queryText.includes('SELECT s.id as service_id')) {
        return Promise.resolve({ rows: [] });
      }
      if (queryText.includes('SELECT sender_id, receiver_id, message, created_at')) {
        return Promise.resolve({
          rows: [
            { sender_id: 1, receiver_id: 0, message: "Hola Aura, recomiéndame algo", created_at: new Date() },
            { sender_id: 1, receiver_id: 0, message: "Tengo piel grasa", created_at: new Date(Date.now() - 1000) },
            { sender_id: 0, receiver_id: 1, message: "Hola, soy Aura.", created_at: new Date(Date.now() - 2000) },
            { sender_id: 1, receiver_id: 0, message: "Hola", created_at: new Date(Date.now() - 3000) }
          ]
        });
      }
      if (queryText.includes('INSERT INTO messages')) {
        return Promise.resolve({
          rows: [
            { id: 'msg-id-123', sender_id: 0, receiver_id: 1, message: "Respuesta de Aura de prueba", is_read: false, created_at: new Date() }
          ]
        });
      }
    });

    // 2. Invocar la función con el mensaje actual
    await processAssistantMessage(1, "Hola Aura, recomiéndame algo", null);

    // 3. Verificar los argumentos pasados a DeepSeek API vía axios
    expect(axios.post).toHaveBeenCalled();
    const payload = axios.post.mock.calls[0][1];
    expect(payload.model).toBe('deepseek-v4-flash');
    expect(payload.messages.length).toBeGreaterThan(1);
  });

  test('Debería sanitizar correctamente marcado DSML completo de invocación de herramientas', () => {
    const rawDsml = `< | DSML | | calls>
< | DSML | | invoke name="search_beauty_knowledge_rag">
< | DSML | | parameter name="queryText" string="true">hena embarazo</ | DSML | | parameter>
</ | DSML | | invoke>
< | DSML | | invoke name="search_beauty_knowledge_rag">
< | DSML | | parameter name="queryText" string="true">tinte cabello embarazo</ | DSML | | parameter>
</ | DSML | | invoke>
</ | DSML | | calls>`;

    // 1. parseDsmlToolCalls debe extraer las 2 herramientas
    const parsedTools = parseDsmlToolCalls(rawDsml);
    expect(parsedTools.length).toBe(2);
    expect(parsedTools[0].function.name).toBe('search_beauty_knowledge_rag');
    expect(JSON.parse(parsedTools[0].function.arguments).queryText).toBe('hena embarazo');
    expect(parsedTools[1].function.name).toBe('search_beauty_knowledge_rag');
    expect(JSON.parse(parsedTools[1].function.arguments).queryText).toBe('tinte cabello embarazo');

    // 2. sanitizeAiResponseText debe dejar el texto totalmente limpio / vacío
    const cleaned = sanitizeAiResponseText(rawDsml);
    expect(cleaned).toBe('');
  });
});
