// backend/src/middleware/usageTracker.js
const usageMeteringService = require('../services/usageMeteringService');

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
    const limit = usageMeteringService.getLimit(plan, feature);
    if (limit === 0) {
      // Feature no disponible en este plan — no trackear, el featureGate ya bloqueará
      return next();
    }

    // Interceptar respuesta para incrementar solo en 2xx
    const originalSend = res.send;
    res.send = function (body) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Fire-and-forget: no await, no bloquear response
        incrementUsageAsync(tenantId, feature).catch(err => {
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
async function incrementUsageAsync(tenantId, feature, delta = 1) {
  // El servicio único consulta el plan vigente y calcula el límite desde el catálogo.
  return usageMeteringService.incrementUsage(tenantId, feature, delta);
}

module.exports = { trackUsage };
