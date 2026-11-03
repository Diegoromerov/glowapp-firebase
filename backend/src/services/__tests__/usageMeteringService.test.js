/**
 * Tests para usageMeteringService.js
 * Fuente de verdad de límites y métricas de uso
 */
const usageMeteringService = require('../usageMeteringService');
const { pool } = require('../../config/db');

jest.mock('../../config/db', () => ({
  pool: {
    query: jest.fn()
  }
}));

describe('usageMeteringService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPlanLimits', () => {
    test('plan FREE_TRIAL → límites correctos', () => {
      const limits = usageMeteringService.getPlanLimits('FREE_TRIAL');
      
      expect(limits.MAP_VISIBILITY).toBe(1);
      expect(limits.ONLINE_BOOKING).toBe(50);
      expect(limits.TEAM_SEATS).toBe(3);
      expect(limits.API_CALLS).toBe(1000);
      expect(limits.ADVANCED_ANALYTICS).toBe(1);
      expect(limits.CUSTOM_BRANDING).toBe(1);
      expect(limits.WHATSAPP_INTEGRATION).toBe(0);
      expect(limits.POS_INTEGRATION).toBe(0);
    });

    test('plan FREEMIUM → límites restrictivos', () => {
      const limits = usageMeteringService.getPlanLimits('FREEMIUM');
      
      expect(limits.MAP_VISIBILITY).toBe(0);
      expect(limits.ONLINE_BOOKING).toBe(20);
      expect(limits.TEAM_SEATS).toBe(1);
      expect(limits.API_CALLS).toBe(500);
      expect(limits.ADVANCED_ANALYTICS).toBe(0);
      expect(limits.CUSTOM_BRANDING).toBe(0);
    });

    test('plan PRO → sin límite en ONLINE_BOOKING (null)', () => {
      const limits = usageMeteringService.getPlanLimits('PRO');
      
      expect(limits.ONLINE_BOOKING).toBeNull();
      expect(limits.TEAM_SEATS).toBe(20);
      expect(limits.API_CALLS).toBe(100000);
      expect(limits.ADVANCED_ANALYTICS).toBe(1);
      expect(limits.CUSTOM_BRANDING).toBe(1);
      expect(limits.WHATSAPP_INTEGRATION).toBe(1);
      expect(limits.POS_INTEGRATION).toBe(0);
    });

    test('plan ENTERPRISE → todo ilimitado (null)', () => {
      const limits = usageMeteringService.getPlanLimits('ENTERPRISE');
      
      expect(limits.ONLINE_BOOKING).toBeNull();
      expect(limits.TEAM_SEATS).toBeNull();
      expect(limits.API_CALLS).toBeNull();
      expect(limits.POS_INTEGRATION).toBe(1);
    });

    test('plan desconocido → defaults a FREEMIUM', () => {
      const limits = usageMeteringService.getPlanLimits('UNKNOWN_PLAN');
      
      expect(limits).toEqual(usageMeteringService.getPlanLimits('FREEMIUM'));
    });
  });

  describe('hasFeature', () => {
    test('feature habilitada (1) → true', () => {
      expect(usageMeteringService.hasFeature('PRO', 'ADVANCED_ANALYTICS')).toBe(true);
      expect(usageMeteringService.hasFeature('PRO', 'CUSTOM_BRANDING')).toBe(true);
    });

    test('feature ilimitada (null) → true', () => {
      expect(usageMeteringService.hasFeature('PRO', 'ONLINE_BOOKING')).toBe(true);
      expect(usageMeteringService.hasFeature('ENTERPRISE', 'TEAM_SEATS')).toBe(true);
    });

    test('feature deshabilitada (0) → false', () => {
      expect(usageMeteringService.hasFeature('FREEMIUM', 'ADVANCED_ANALYTICS')).toBe(false);
      expect(usageMeteringService.hasFeature('FREEMIUM', 'MAP_VISIBILITY')).toBe(false);
    });
  });

  describe('getLimit', () => {
    test('retorna valor numérico', () => {
      expect(usageMeteringService.getLimit('BASIC', 'ONLINE_BOOKING')).toBe(200);
    });

    test('retorna null para ilimitado', () => {
      expect(usageMeteringService.getLimit('PRO', 'ONLINE_BOOKING')).toBeNull();
    });

    test('retorna 0 para feature no disponible', () => {
      expect(usageMeteringService.getLimit('FREEMIUM', 'MAP_VISIBILITY')).toBe(0);
    });
  });

  describe('canConsume', () => {
    test('tenant no existe → allowed: false', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      const result = await usageMeteringService.canConsume('bp_999', 'ONLINE_BOOKING');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Tenant no encontrado');
    });

    test('feature no disponible en plan (limit=0) → allowed: false', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ saas_plan: 'FREEMIUM' }] })  // getTenantPlan
        .mockResolvedValueOnce({ rows: [] }); // usage_metrics
      
      const result = await usageMeteringService.canConsume('bp_123', 'MAP_VISIBILITY');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Feature no disponible en plan');
      expect(result.limit).toBe(0);
    });

    test('feature ilimitada (limit=null) → allowed: true', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ saas_plan: 'PRO' }] })
        .mockResolvedValueOnce({ rows: [] });
      
      const result = await usageMeteringService.canConsume('bp_123', 'ONLINE_BOOKING');
      
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe('unlimited');
    });

    test('uso actual < límite → allowed: true con remaining', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ saas_plan: 'BASIC' }] })
        .mockResolvedValueOnce({ rows: [{ count: 50 }] }); // usage actual
      
      const result = await usageMeteringService.canConsume('bp_123', 'ONLINE_BOOKING', 1);
      
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(200);
      expect(result.current).toBe(50);
      expect(result.remaining).toBe(149); // 200 - 50 - 1
    });

    test('uso actual + delta > límite → allowed: false', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ saas_plan: 'BASIC' }] })
        .mockResolvedValueOnce({ rows: [{ count: 199 }] });
      
      const result = await usageMeteringService.canConsume('bp_123', 'ONLINE_BOOKING', 5);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Límite excedido');
      expect(result.remaining).toBe(1); // remaining = limit - current = 200 - 199 = 1, then max(0, 1) = 1
    });
  });

  describe('incrementUsage (UPSERT)', () => {
    test('incrementa contador y retorna nuevo count', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ saas_plan: 'BASIC' }] })  // getTenantPlan
        .mockResolvedValueOnce({ rows: [{ count: 51, limit: 200 }] }); // UPSERT result
      
      const result = await usageMeteringService.incrementUsage('bp_123', 'ONLINE_BOOKING', 1);
      
      expect(result.count).toBe(51);
      expect(result.limit).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO usage_metrics'),
        expect.arrayContaining(['bp_123', 'ONLINE_BOOKING', expect.any(String), expect.any(String), 1, 200])
      );
    });
  });

  describe('getCurrentUsage', () => {
    test('retorna métricas del período actual', async () => {
      pool.query.mockResolvedValue({ 
        rows: [
          { feature: 'ONLINE_BOOKING', count: 50, limit: 200 },
          { feature: 'API_CALLS', count: 1000, limit: 10000 }
        ] 
      });
      
      const result = await usageMeteringService.getCurrentUsage('bp_123');
      
      expect(result).toHaveLength(2);
      expect(result[0].feature).toBe('ONLINE_BOOKING');
      expect(result[1].feature).toBe('API_CALLS');
    });
  });

  describe('resetMonthlyCounters', () => {
    test('retorna overages del mes anterior', async () => {
      pool.query.mockResolvedValue({ 
        rows: [
          { tenant_id: 'bp_1', name: 'Salón A', saas_plan: 'BASIC', feature: 'ONLINE_BOOKING', count: 250, limit: 200 }
        ] 
      });
      
      const result = await usageMeteringService.resetMonthlyCounters();
      
      expect(result.exceeded).toHaveLength(1);
      expect(result.exceeded[0].tenant_id).toBe('bp_1');
    });
  });

  describe('checkUsageAlerts', () => {
    test('retorna alertas para tenants que superan threshold', async () => {
      pool.query
        .mockResolvedValueOnce({ // tenants con alertas
          rows: [{
            id: 'bp_1',
            name: 'Salón A',
            saas_plan: 'BASIC',
            metadata: {
              usageAlerts: [
                { feature: 'ONLINE_BOOKING', thresholdPercent: 80, channel: 'email' }
              ]
            }
          }]
        })
        .mockResolvedValueOnce({ // métricas actuales
          rows: [
            { feature: 'ONLINE_BOOKING', count: 180, limit: 200 } // 90%
          ]
        });
      
      const alerts = await usageMeteringService.checkUsageAlerts();
      
      expect(alerts).toHaveLength(1);
      expect(alerts[0].tenantId).toBe('bp_1');
      expect(alerts[0].feature).toBe('ONLINE_BOOKING');
      expect(alerts[0].currentPercent).toBe(90);
      expect(alerts[0].threshold).toBe(80);
    });

    test('sin alertas configuradas → array vacío', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      const alerts = await usageMeteringService.checkUsageAlerts();
      
      expect(alerts).toHaveLength(0);
    });
  });
});