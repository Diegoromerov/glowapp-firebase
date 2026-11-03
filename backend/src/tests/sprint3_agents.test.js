// backend/src/tests/sprint3_agents.test.js
const { pool } = require('../config/db');
const chronosAgent = require('../services/agents/chronosAgent');
const hestiaAgent = require('../services/agents/hestiaAgent');
const { executeAuraTool, AURA_TOOLS_DEFINITIONS } = require('../services/auraToolExecutor');

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

describe('Pruebas unitarias de Sprint 3 (Agentes CHRONOS y HESTIA)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Agente CHRONOS (Re-Booking Proactivo y Hábitos)', () => {
    test('Debería identificar servicios vencidos que requieren re-agendamiento', async () => {
      const mockBookings = [
        {
          booking_id: 101,
          booking_date: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'COMPLETADA',
          service_name: 'Manicura Semipermanente',
          category: 'uñas'
        }
      ];
      pool.query.mockResolvedValueOnce({ rows: mockBookings });

      const result = await chronosAgent.evaluateUserRebooking(1);

      expect(result.status).toBe('success');
      expect(result.hasPendingMaintenance).toBe(true);
      expect(result.treatmentsDue.length).toBe(1);
      expect(result.treatmentsDue[0].serviceName).toBe('Manicura Semipermanente');
      expect(result.treatmentsDue[0].recommendedCycleDays).toBe(21);
    });

    test('Debería manejar usuarios sin historial de citas completadas', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await chronosAgent.evaluateUserRebooking(555);
      expect(result.status).toBe('no_history');
    });
  });

  describe('Agente HESTIA (GlowStore Personal Shopper)', () => {
    test('Debería recomendar productos e-commerce reales de la tienda cuando existen en BD', async () => {
      // 1. Mock para consulta de perfil biométrico ATENA
      pool.query.mockResolvedValueOnce({ rows: [] });
      // 2. Mock para consulta de productos HESTIA
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            nombre: 'Sérum Facial Ácido Hialurónico',
            descripcion: 'Hidratación 24h',
            precio: 65000,
            categoria: 'Piel',
            stock: 15,
            imagen_url: 'http://img'
          }
        ]
      });

      const result = await hestiaAgent.recommendProducts({ userId: 1, queryText: 'hidratante', category: 'Piel' });

      expect(result.status).toBe('success');
      expect(result.foundCount).toBe(1);
      expect(result.products.length).toBe(1);
      expect(result.products[0].nombre).toContain('Sérum Facial');
    });

    test('Debería retornar status no_products y 0 productos cuando la consulta no devuelve resultados (sin fabricar datos)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // ATENA
      pool.query.mockResolvedValueOnce({ rows: [] }); // HESTIA

      const result = await hestiaAgent.recommendProducts({ userId: 1, queryText: 'inexistente' });

      expect(result.status).toBe('no_products');
      expect(result.foundCount).toBe(0);
      expect(result.products).toEqual([]);
    });
  });

  describe('Integración con auraToolExecutor para Sprint 3', () => {
    test('Debería tener registradas al menos 7 herramientas', () => {
      expect(AURA_TOOLS_DEFINITIONS.length).toBeGreaterThanOrEqual(7);
      const names = AURA_TOOLS_DEFINITIONS.map(t => t.function.name);
      expect(names).toContain('evaluate_user_rebooking');
      expect(names).toContain('recommend_glowstore_products');
    });

    test('executeAuraTool debería delegar evaluate_user_rebooking a CHRONOS', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await executeAuraTool('evaluate_user_rebooking', { userId: 3 }, 3);
      expect(result.status).toBe('no_history');
    });

    test('executeAuraTool debería delegar recommend_glowstore_products a HESTIA', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await executeAuraTool('recommend_glowstore_products', { queryText: 'uñas' }, 3);
      expect(result.status).toBe('no_products');
      expect(result.products).toEqual([]);
    });
  });
});
