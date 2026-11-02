// backend/src/middleware/usageTracker.js
const { pool } = require('../config/db');

/**
 * Middleware opcional: auto-incrementa usage_metrics en responses 2xx.
 * Se activa solo para rutas que lo requieran explícitamente (opt-in).
 *
 * Uso:
 *   router.post('/bookings', trackUsage('ONLINE_BOOKING'), controller);
 *   router.get('/api/data', trackUsage('API_CALLS'), controller);
 *
 * El incremento es asíncrono (fire-and-forget) para no añadir latencia.
 * Usa UPSERT atómico en usage_metrics.
 */

// Cache de límites por plan en memoria (refrescado cada 5 min)
let planLimitsCache = null;
let cacheExpiry = 0;

function getPlanLimits(plan) {
  const now = Date.now();
  if (planLimitsCache && now < cacheExpiry) {
    return planLimitsCache[plan] || {};
  }
  // Límites hardcoded (fuente de verdad también en usageMeteringService.js)
  planLimitsCache = {
    FREE_TRIAL: { MAP_VISIBILITY: 1, ONLINE_BOOKING: 50, TEAM_SEATS: 3, API_CALLS: 1000, ADVANCED_ANALYTICS: 1, CUSTOM_BRANDING: 1 },
    FREEMIUM: { MAP_VISIBILITY: 0, ONLINE_BOOKING: 20, TEAM_SEATS: 1, API_CALLS: 500, ADVANCED_ANALYTICS: 0, CUSTOM_BRANDING: 0 },
    BASIC: { MAP_VISIBILITY: 1, ONLINE_BOOKING: 200, TEAM_SEATS: 5, API_CALLS: 10000, ADVANCED_ANALYTICS: 0, CUSTOM_BRANDING: 0 },
    PRO: { MAP_VISIBILITY: 1, ONLINE_BOOKING: null, TEAM_SEATS: 20, API_CALLS: 100000, ADVANCED_ANALYTICS: 1, CUSTOM_BRANDING: 1 },
    ENTERPRISE: { MAP_VISIBILITY: 1, ONLINE_BOOKING: null, TEAM_SEATS: null, API_CALLS: null, ADVANCED_ANALYTICS: 1, CUSTOM_BRANDING: 1 }
  };
  cacheExpiry = now + 5 * 60 * 1000; // 5 min
  return planLimitsCache[plan] || {};
}

/**
 * Middleware factory: trackUsage(feature)
 * Incrementa contador para feature en response 2xx
 */
function trackUsage(feature) {
  return (req, res, next) => {
    // Solo si hay contexto SaaS
    if (!req.saas?.tenantId) {
      return next();
    }

    const tenantId = req.saas.tenantId;
    const plan = req.saas.plan;

    // Verificar si la feature tiene límite en este plan
    const limits = getPlanLimits(plan);
    const limit = limits[feature];
    if (limit === 0) {
      // Feature no disponible en este plan — no trackear, el featureGate ya bloqueará
      return next();
    }

    // Interceptar respuesta para incrementar solo en 2xx
    const originalSend = res.send;
    res.send = function (body) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Fire-and-forget: no await, no bloquear response
        incrementUsageAsync(tenantId, feature, plan).catch(err => {
          console.error('[usageTracker] Error incrementando uso:', err.message);
        });
      }
      return originalSend.call(this, body);
    };

    next();
  };
}

/**
 * Incremento atómico asíncrono (UPSERT en usage_metrics)
 * Período = mes calendario actual
 */
async function incrementUsageAsync(tenantId, feature, plan, delta = 1) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const query = `
    INSERT INTO usage_metrics (tenant_id, feature, period_start, period_end, count, limit)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tenant_id, feature, period_start)
    DO UPDATE SET
      count = usage_metrics.count + EXCLUDED.count,
      limit = EXCLUDED.limit,
      updated_at = NOW()
    RETURNING count;
  `;

  const limit = getPlanLimits(plan)[feature] || null;

  await pool.query(query, [
    tenantId,
    feature,
    periodStart.toISOString().split('T')[0],
    periodEnd.toISOString().split('T')[0],
    delta,
    limit
  ]);
}

module.exports = { trackUsage };