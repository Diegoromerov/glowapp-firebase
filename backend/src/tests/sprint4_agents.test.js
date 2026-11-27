// backend/src/tests/sprint4_agents.test.js
const { pool } = require('../config/db');
const valkyrieAgent = require('../services/agents/valkyrieAgent');
const { executeAuraTool, AURA_TOOLS_DEFINITIONS } = require('../services/auraToolExecutor');

jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn()
  }
}));

jest.mock('../services/usageMeteringService', () => ({
  consumeAuraBusinessQuery: jest.fn(),
}));

const { consumeAuraBusinessQuery } = require('../services/usageMeteringService');

jest.mock('../config/redis', () => ({
  isOpen: false,
  get: jest.fn(),
  set: jest.fn()
}));

describe('Pruebas unitarias de Sprint 4 (Agente VALKYRIE - Co-Piloto B2B y Precios Dinámicos)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    consumeAuraBusinessQuery.mockResolvedValue({ allowed: true, plan: 'FREE_TRIAL_LEGACY', limit: 10, current: 1, remaining: 9 });
  });

  describe('Agente VALKYRIE', () => {
    test('Debería analizar la ocupación del prestador y autorizar promoción dinámica para el día más lento cuando hay datos', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { day_of_week: '2', total_bookings: '3' }, // Martes = 2 (ISODOW)
          { day_of_week: '6', total_bookings: '25' } // Sábado = 6
        ]
      });

      const result = await valkyrieAgent.getProviderInsights({ providerId: 5 });

      expect(result.status).toBe('success');
      expect(result.insights.slowestDay).toBe('Martes');
      expect(result.insights.dynamicPromotion.authorized).toBe(true);
      expect(result.insights.dynamicPromotion.discountPercentage).toBe(15);
      expect(result.insights.dynamicPromotion.promoCode).toBe('GLOW-MARTES-15');
    });

    test('Debería retornar status no_data y desautorizar promociones cuando el prestador no tiene reservas previas', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await valkyrieAgent.getProviderInsights({ providerId: 99 });
      expect(result.status).toBe('no_data');
      expect(result.insights.slowestDay).toBeNull();
      expect(result.insights.dynamicPromotion.authorized).toBe(false);
      expect(result.insights.dynamicPromotion.discountPercentage).toBe(0);
      expect(result.insights.dynamicPromotion.promoCode).toBeNull();
    });
  });

  describe('Integración de VALKYRIE en auraToolExecutor', () => {
    test('Debería tener registradas las herramientas para el Ecosistema completo', () => {
      expect(AURA_TOOLS_DEFINITIONS.length).toBeGreaterThanOrEqual(8);
      const names = AURA_TOOLS_DEFINITIONS.map(t => t.function.name);
      expect(names).toContain('get_provider_b2b_insights');
    });

    test('executeAuraTool debería delegar get_provider_b2b_insights a VALKYRIE y retornar no_data si no hay agendamientos', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await executeAuraTool('get_provider_b2b_insights', { providerId: 10 }, 1, 'PRESTADOR', 'salon-1');
      expect(result.status).toBe('no_data');
      expect(result.insights.dynamicPromotion.authorized).toBe(false);
      expect(result.usage).toMatchObject({ feature: 'AURA_QUERIES', limit: 10, remaining: 9 });
      expect(pool.query).toHaveBeenCalledWith(expect.any(String), [1]);
      expect(consumeAuraBusinessQuery).toHaveBeenCalledWith({ tenantId: 'salon-1', userId: 1 });
    });

    test('ignora el providerId solicitado por el modelo y bloquea cuentas cliente', async () => {
      const result = await executeAuraTool('get_provider_b2b_insights', { providerId: 10 }, 1, 'CLIENTE');

      const definition = AURA_TOOLS_DEFINITIONS.find((tool) => tool.function.name === 'get_provider_b2b_insights');
      expect(definition.function.parameters.properties).not.toHaveProperty('providerId');
      expect(result.error).toBe('provider_role_required');
      expect(pool.query).not.toHaveBeenCalled();
      expect(consumeAuraBusinessQuery).not.toHaveBeenCalled();
    });

    test('bloquea Aura negocio cuando el plan agotó su cuota', async () => {
      consumeAuraBusinessQuery.mockResolvedValueOnce({ allowed: false, reason: 'Quota exceeded', limit: 10, current: 10 });

      const result = await executeAuraTool('get_provider_b2b_insights', {}, 1, 'PRESTADOR', 'salon-1');

      expect(result.error).toBe('aura_quota_exceeded');
      expect(result.remaining).toBe(0);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test('bloquea la herramienta sin perfil SaaS activo', async () => {
      consumeAuraBusinessQuery.mockResolvedValueOnce({ allowed: false, reason: 'SaaS context required' });

      const result = await executeAuraTool('get_provider_b2b_insights', {}, 1, 'PRESTADOR', null);

      expect(result.error).toBe('aura_saas_context_required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    test('bloquea Aura negocio si el plan no ofrece el entitlement', async () => {
      consumeAuraBusinessQuery.mockResolvedValueOnce({
        allowed: false,
        reason: 'Feature not included in plan',
        plan: 'FREEMIUM',
        limit: 0,
      });

      const result = await executeAuraTool('get_provider_b2b_insights', {}, 1, 'PRESTADOR', 'salon-1');

      expect(result).toMatchObject({ error: 'aura_entitlement_required', required: 'AURA_BUSINESS', currentPlan: 'FREEMIUM' });
      expect(pool.query).not.toHaveBeenCalled();
    });
  });
});
