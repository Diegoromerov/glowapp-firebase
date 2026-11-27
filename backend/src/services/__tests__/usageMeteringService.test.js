/**
 * Tests para usageMeteringService.js
 * Fuente de verdad de límites y métricas de uso
 */
const usageMeteringService = require('../usageMeteringService');
const { pool } = require('../../config/db');
const tenantRouting = require('../../config/tenantRouting');

jest.mock('../../config/db', () => ({
  pool: {
    query: jest.fn()
  }
}));

jest.mock('../../config/tenantRouting', () => ({
  runInTenantTransaction: jest.fn(),
}));

const quotaClient = { query: jest.fn() };

describe('usageMeteringService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tenantRouting.runInTenantTransaction.mockImplementation((_deps, _tenantId, _userId, callback) => callback(quotaClient));
    quotaClient.query.mockReset();
  });

  describe('getPlanLimits', () => {
    test('plan FREE_TRIAL → límites correctos', () => {
      const limits = usageMeteringService.getPlanLimits('FREE_TRIAL');
      
      expect(limits.MAP_VISIBILITY).toBe(1);
      expect(limits.ONLINE_BOOKING).toBe(150);
      expect(limits.TEAM_SEATS).toBe(3);
      expect(limits.API_CALLS).toBe(0);
      expect(limits.ADVANCED_ANALYTICS).toBe(0);
      expect(limits.CUSTOM_BRANDING).toBe(0);
      expect(limits.WHATSAPP_MESSAGES).toBe(0);
      expect(limits.POS_INTEGRATION).toBe(1);
    });

    test('plan FREEMIUM → límites restrictivos', () => {
      const limits = usageMeteringService.getPlanLimits('FREEMIUM');
      
      expect(limits.MAP_VISIBILITY).toBe(1);
      expect(limits.ONLINE_BOOKING).toBe(30);
      expect(limits.TEAM_SEATS).toBe(1);
      expect(limits.API_CALLS).toBe(0);
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
      expect(limits.WHATSAPP_INTEGRATION).toBe(0);
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

  describe('getMeteredFeatures', () => {
    test('excluye capacidades booleanas y alias del consumo cuantitativo', () => {
      const features = usageMeteringService.getMeteredFeatures(
        usageMeteringService.getPlanLimits('FREEMIUM'),
      );

      expect(features).toContain('DIRECT_BOOKINGS');
      expect(features).toContain('TEAM_SEATS');
      expect(features).not.toContain('MAP_VISIBILITY');
      expect(features).not.toContain('POS_INTEGRATION');
      expect(features).not.toContain('ONLINE_BOOKING');
    });
  });

  describe('getSiteCount', () => {
    test('cuenta sedes vinculadas al perfil SaaS', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ count: 2 }] });

      await expect(usageMeteringService.getSiteCount('tenant-123')).resolves.toBe(2);
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('business_profile_id = $1'), ['tenant-123']);
    });

    test('devuelve cero cuando el tenant no tiene sedes visibles', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ count: 0 }] });

      await expect(usageMeteringService.getSiteCount('tenant-empty')).resolves.toBe(0);
    });
  });

  describe('getUsageStatus', () => {
    test('sede en el máximo permitido es aviso, no exceso', () => {
      expect(usageMeteringService.getUsageStatus('SITES', 1, 1)).toBe('warning');
    });

    test('capacidad concurrente solo excede cuando rebasa el límite', () => {
      expect(usageMeteringService.getUsageStatus('TEAM_SEATS', 3, 3)).toBe('warning');
      expect(usageMeteringService.getUsageStatus('TEAM_SEATS', 4, 3)).toBe('exceeded');
    });

    test('cuota mensual se marca excedida al alcanzar el límite', () => {
      expect(usageMeteringService.getUsageStatus('DIRECT_BOOKINGS', 30, 30)).toBe('exceeded');
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
      expect(usageMeteringService.hasFeature('FREEMIUM', 'MAP_VISIBILITY')).toBe(true);
    });
  });

  describe('getLimit', () => {
    test('retorna valor numérico', () => {
      expect(usageMeteringService.getLimit('BASIC', 'ONLINE_BOOKING')).toBeNull();
    });

    test('retorna null para ilimitado', () => {
      expect(usageMeteringService.getLimit('PRO', 'ONLINE_BOOKING')).toBeNull();
    });

    test('retorna 0 para feature no disponible', () => {
      expect(usageMeteringService.getLimit('FREEMIUM', 'API_CALLS')).toBe(0);
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
      
      const result = await usageMeteringService.canConsume('bp_123', 'API_CALLS');
      
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
        .mockResolvedValueOnce({ rows: [{ saas_plan: 'FREEMIUM' }] })
        .mockResolvedValueOnce({ rows: [{ count: 20 }] }); // usage actual
      
      const result = await usageMeteringService.canConsume('bp_123', 'ONLINE_BOOKING', 1);
      
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(30);
      expect(result.current).toBe(20);
      expect(result.remaining).toBe(9);
    });

    test('uso actual + delta > límite → allowed: false', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ saas_plan: 'FREEMIUM' }] })
        .mockResolvedValueOnce({ rows: [{ count: 29 }] });
      
      const result = await usageMeteringService.canConsume('bp_123', 'ONLINE_BOOKING', 5);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Límite excedido');
      expect(result.remaining).toBe(1);
    });
  });

  describe('incrementUsage (UPSERT)', () => {
    test('incrementa contador y retorna nuevo count', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ saas_plan: 'BASIC' }] })  // getTenantPlan
        .mockResolvedValueOnce({ rows: [{ count: 51, limit: null }] }); // UPSERT result
      
      const result = await usageMeteringService.incrementUsage('bp_123', 'ONLINE_BOOKING', 1);
      
      expect(result.count).toBe(51);
      expect(result.limit).toBeNull();
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO usage_metrics'),
        expect.arrayContaining(['bp_123', 'ONLINE_BOOKING', expect.any(String), expect.any(String), 1, null])
      );
    });
  });

  describe('consumeAuraBusinessQuery', () => {
    test('valida membresía/entitlement y consume cuota bajo transacción tenant', async () => {
      quotaClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ saas_plan: 'FREE_TRIAL_LEGACY' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await usageMeteringService.consumeAuraBusinessQuery({ tenantId: 'salon-1', userId: 7 });

      expect(result).toMatchObject({ allowed: true, plan: 'FREE_TRIAL_LEGACY', limit: 10, current: 1, remaining: 9 });
      expect(tenantRouting.runInTenantTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ pool }), 'salon-1', 7, expect.any(Function)
      );
      expect(quotaClient.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), expect.any(Array));
      expect(quotaClient.query).toHaveBeenCalledWith(expect.stringContaining("'AURA_QUERIES'"), expect.arrayContaining(['salon-1']));
    });

    test('deniega planes sin entitlement sin escribir la métrica', async () => {
      quotaClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ saas_plan: 'FREEMIUM' }] });

      const result = await usageMeteringService.consumeAuraBusinessQuery({ tenantId: 'salon-1', userId: 7 });

      expect(result).toMatchObject({ allowed: false, reason: 'Feature not included in plan', plan: 'FREEMIUM', limit: 0 });
      expect(quotaClient.query).toHaveBeenCalledTimes(2);
    });

    test('bloquea atómicamente y devuelve el uso actual al agotar el límite', async () => {
      quotaClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ saas_plan: 'FREE_TRIAL_LEGACY' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 10 }] });

      const result = await usageMeteringService.consumeAuraBusinessQuery({ tenantId: 'salon-1', userId: 7 });

      expect(result).toMatchObject({ allowed: false, reason: 'Quota exceeded', limit: 10, current: 10, remaining: 0 });
      expect(quotaClient.query).toHaveBeenCalledWith(expect.stringContaining('usage_metrics.count + 1 <= EXCLUDED."limit"'), expect.any(Array));
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
