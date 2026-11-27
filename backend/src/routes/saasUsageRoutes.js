// backend/src/routes/saasUsageRoutes.js
const express = require('express');
const { pool, systemPool } = require('../config/db');
const { runAsSystem } = require('../config/tenantRouting');
const saasContext = require('../middleware/saasContext');
const { requireEntitlement } = require('../middleware/featureGate');
const { authMiddleware } = require('../middleware/auth');
const usageMeteringService = require('../services/usageMeteringService');
const { METRICS, PLAN_IDS, PLAN_CATALOG, publicCatalog, getMonthPeriod } = require('../config/saasCatalog');

const router = express.Router();

router.use(authMiddleware);
router.use(saasContext);

/**
 * GET /api/saas/usage
 * Dashboard de uso actual del tenant
 * Requiere: cualquier membership activa
 */
router.get('/', async (req, res) => {
  try {
    if (!req.saas) {
      return res.status(401).json({ error: 'Contexto SaaS requerido' });
    }

    const tenantId = req.saas.tenantId;
    const plan = req.saas.plan;

    // Obtener métricas del período actual
    // Las cuotas usan meses calendario de Bogotá. Reutilizar la misma función
    // evita que el dashboard cambie de período antes/después del contador, según
    // la zona horaria del proceso donde corra la API.
    const { start: periodStart, end: periodEnd } = getMonthPeriod();

    const { rows: metrics } = await pool.query(`
      SELECT feature, count, "limit", period_start, period_end
      FROM usage_metrics
      WHERE tenant_id = $1 AND period_start = $2
      ORDER BY feature;
    `, [tenantId, periodStart]);

    const metricMap = new Map(metrics.map((metric) => [metric.feature, metric]));
    let teamSeatsInUse = null;
    if (Object.prototype.hasOwnProperty.call(usageMeteringService.getPlanLimits(plan), 'TEAM_SEATS')) {
      const { rows: members } = await pool.query(`
        SELECT COUNT(*)::integer AS count
        FROM memberships
        WHERE business_profile_id = $1
          AND (status = 'ACTIVE' OR (status IN ('PENDING', 'INVITED')
               AND (invite_expires_at IS NULL OR invite_expires_at > NOW())))
      `, [tenantId]);
      teamSeatsInUse = Number(members[0]?.count || 0);
    }
    let sitesInUse = null;
    if (Object.prototype.hasOwnProperty.call(usageMeteringService.getPlanLimits(plan), 'SITES')) {
      sitesInUse = await usageMeteringService.getSiteCount(tenantId);
    }

    // Si aún no existe contador este mes, mostrar las reservas ya hechas antes
    // de activar el nuevo medidor. Por negocio compartido se usa la relación
    // explícita servicio→perfil; el provider_id sirve solo para el esquema viejo
    // cuando identifica un único perfil.
    let existingBookings = null;
    if (!metricMap.has('DIRECT_BOOKINGS')) {
      const { rows: businesses } = await pool.query(
        'SELECT provider_id FROM business_profiles WHERE id = $1', [tenantId]
      );
      const providerId = businesses[0]?.provider_id;
      const { rows: profileColumn } = await pool.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'business_profile_id'
      `);
      if (profileColumn.length > 0) {
        const { rows } = await pool.query(`
          SELECT COUNT(DISTINCT COALESCE(b.productos_adicionales->>'primary_booking_id', b.id::text))::integer AS count
          FROM bookings b
          JOIN services s ON s.id = b.service_id
          WHERE s.business_profile_id = $1 AND b.created_at >= $2
            AND b.productos_adicionales->>'booking_origin' = 'SALON_DIRECT'
            AND COALESCE((b.productos_adicionales->>'is_primary')::boolean, true) = true
        `, [tenantId, periodStart]);
        existingBookings = Number(rows[0]?.count || 0);
      } else if (providerId) {
        const { rows: owners } = await pool.query(
          'SELECT COUNT(*)::integer AS count FROM business_profiles WHERE provider_id = $1', [providerId]
        );
        if (Number(owners[0]?.count) === 1) {
          const { rows } = await pool.query(`
            SELECT COUNT(DISTINCT COALESCE(productos_adicionales->>'primary_booking_id', id::text))::integer AS count
            FROM bookings WHERE provider_id = $1 AND created_at >= $2
              AND productos_adicionales->>'booking_origin' = 'SALON_DIRECT'
              AND COALESCE((productos_adicionales->>'is_primary')::boolean, true) = true
          `, [providerId, periodStart]);
          existingBookings = Number(rows[0]?.count || 0);
        }
      }
    }

    // Límites del plan
    const planLimits = usageMeteringService.getPlanLimits(plan);

    // Calcular % de uso y alertas
    // Las capacidades booleanas son derechos del plan, no consumo. Se presentan
    // como Incluido/No incluido en la tabla de límites y no deben inflar métricas,
    // porcentajes ni resúmenes con valores artificiales de 0/1.
    const visibleFeatures = usageMeteringService.getMeteredFeatures(planLimits);
    const usage = visibleFeatures.map(feature => {
      const metric = metrics.find(m => m.feature === feature);
      const limit = planLimits[feature];
      const used = feature === 'TEAM_SEATS' && teamSeatsInUse !== null
        ? teamSeatsInUse
        : feature === 'SITES' && sitesInUse !== null
          ? sitesInUse
        : feature === 'DIRECT_BOOKINGS' && existingBookings !== null
          ? existingBookings
          : metric?.count || 0;
      const percentage = limit && limit > 0 ? Math.round((used / limit) * 100) : 0;
      const remaining = limit && limit > 0 ? Math.max(0, limit - used) : null;
      
      let status = 'ok';
      if (limit && limit > 0) {
        if (percentage >= 100) status = 'exceeded';
        else if (percentage >= 80) status = 'warning';
        else if (percentage >= 60) status = 'caution';
      }

      return {
        feature,
        label: METRICS[feature]?.label || feature,
        unit: METRICS[feature]?.unit || null,
        kind: METRICS[feature]?.kind || 'quota',
        used,
        limit: limit === null ? 'unlimited' : limit,
        remaining,
        percentage,
        status,
        periodStart,
        periodEnd
      };
    });

    // Resumen general
    const exceeded = usage.filter(u => u.status === 'exceeded').length;
    const warning = usage.filter(u => u.status === 'warning').length;
    const caution = usage.filter(u => u.status === 'caution').length;

    res.json({
      tenantId,
      plan,
      period: { start: periodStart, end: periodEnd },
      usage,
      summary: {
        totalFeatures: usage.length,
        exceeded,
        warning,
        caution,
        ok: usage.filter(u => u.status === 'ok').length
      }
    });
  } catch (error) {
    console.error('[saasUsageRoutes] Error getting usage:', error.message);
    res.status(500).json({ error: 'Error obteniendo uso' });
  }
});

/**
 * GET /api/saas/usage/history
 * Historial de uso (últimos N meses)
 */
router.get('/history', async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const tenantId = req.saas.tenantId;
    const months = Math.min(parseInt(req.query.months) || 6, 12);

    const { rows } = await pool.query(`
      SELECT feature, period_start, period_end, count, "limit"
      FROM usage_metrics
      WHERE tenant_id = $1
        AND period_start >= (
          date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date
          - interval '${months} months'
        )
      ORDER BY period_start DESC, feature;
    `, [tenantId]);

    // Agrupar por mes
    const byMonth = {};
    rows.forEach(row => {
      const key = row.period_start;
      if (!byMonth[key]) byMonth[key] = { periodStart: key, periodEnd: row.period_end, features: {} };
      byMonth[key].features[row.feature] = { count: row.count, limit: row["limit"] };
    });

    res.json({
      tenantId,
      months,
      history: Object.values(byMonth).sort((a, b) => b.periodStart.localeCompare(a.periodStart))
    });
  } catch (error) {
    console.error('[saasUsageRoutes] Error getting history:', error.message);
    res.status(500).json({ error: 'Error obteniendo historial' });
  }
});

/**
 * GET /api/saas/usage/reminders
 * Conteo de mensajes, intentos y costos efectivamente informados este mes.
 * Los costos ausentes se devuelven como null, nunca como estimación.
 */
router.get('/reminders', async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const tenantId = req.saas.tenantId;
    const { start: periodStart, end: periodEnd } = getMonthPeriod();
    const { rows } = await runAsSystem({ pool, systemPool }, (client) => client.query(`
      SELECT channel, provider,
             COUNT(*) FILTER (WHERE status = 'SENT')::integer AS sent_messages,
             COALESCE(SUM(attempt_count) FILTER (WHERE status <> 'SKIPPED'), 0)::integer AS send_attempts,
             COUNT(*) FILTER (WHERE status = 'FAILED')::integer AS failed_deliveries,
             COUNT(*) FILTER (WHERE status = 'SKIPPED')::integer AS skipped_deliveries,
             SUM(cost_amount) AS known_cost,
             COUNT(cost_amount)::integer AS cost_items_recorded,
             cost_currency
        FROM booking_reminder_deliveries
       WHERE business_profile_id = $1
         AND attempted_at >= ($2::date::timestamp AT TIME ZONE 'America/Bogota')
         AND attempted_at < (($2::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'America/Bogota')
       GROUP BY channel, provider, cost_currency
       ORDER BY channel, provider, cost_currency NULLS LAST
    `, [tenantId, periodStart]));

    const totals = rows.reduce((acc, row) => {
      acc.sentMessages += Number(row.sent_messages || 0);
      acc.sendAttempts += Number(row.send_attempts || 0);
      acc.failedDeliveries += Number(row.failed_deliveries || 0);
      acc.skippedDeliveries += Number(row.skipped_deliveries || 0);
      acc.costItemsRecorded += Number(row.cost_items_recorded || 0);
      if (row.known_cost !== null) {
        const currency = String(row.cost_currency || '').trim();
        acc.knownCosts[currency] = (acc.knownCosts[currency] || 0) + Number(row.known_cost);
      }
      return acc;
    }, {
      sentMessages: 0,
      sendAttempts: 0,
      failedDeliveries: 0,
      skippedDeliveries: 0,
      costItemsRecorded: 0,
      knownCosts: {},
    });

    res.json({
      tenantId,
      periodStart,
      periodEnd,
      channels: rows.map((row) => ({
        channel: row.channel,
        provider: row.provider,
        sentMessages: Number(row.sent_messages || 0),
        sendAttempts: Number(row.send_attempts || 0),
        failedDeliveries: Number(row.failed_deliveries || 0),
        skippedDeliveries: Number(row.skipped_deliveries || 0),
        currency: row.cost_currency === null ? null : String(row.cost_currency).trim(),
        knownCost: row.known_cost === null ? null : Number(row.known_cost),
        costItemsRecorded: Number(row.cost_items_recorded || 0),
      })),
      totals: { ...totals, knownCosts: Object.entries(totals.knownCosts).map(([currency, amount]) => ({ currency, amount })) },
      costDisclosure: 'Solo suma costos unitarios configurados para entregas aceptadas; no estima cargos desconocidos ni cargos que el proveedor pudiera cobrar por intentos fallidos.',
    });
  } catch (error) {
    console.error('[saasUsageRoutes] Error getting reminder usage:', error.message);
    res.status(500).json({ error: 'Error obteniendo uso de recordatorios' });
  }
});

/**
 * GET /api/saas/usage/limits
 * Límites del plan actual (para UI de upgrade)
 */
router.get('/limits', async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const plan = req.saas.plan;
    const allPlans = PLAN_IDS.filter((id) => PLAN_CATALOG[id]?.publiclyListed !== false);
    const planLimits = usageMeteringService.getPlanLimits(plan);

    // Construir matriz de comparación
    const features = Object.keys(planLimits);
    const comparison = features.map(feature => {
      const row = { feature, current: planLimits[feature] };
      allPlans.forEach(p => {
        row[p.toLowerCase()] = usageMeteringService.getPlanLimits(p)[feature];
      });
      return row;
    });

    res.json({
      catalogVersion: publicCatalog().version,
      currentPlan: plan,
      plans: allPlans,
      limits: comparison,
      catalog: publicCatalog(),
    });
  } catch (error) {
    console.error('[saasUsageRoutes] Error getting limits:', error.message);
    res.status(500).json({ error: 'Error obteniendo límites' });
  }
});

/**
 * POST /api/saas/usage/alerts
 * La notificación por email/webhook aún no tiene un despachador. No persistir
 * configuraciones que parezcan activas pero nunca se entregan. El estado de
 * uso sí muestra avisos en la aplicación al 80 % y al 100 %.
 */
router.post('/alerts', requireEntitlement('ADVANCED_ANALYTICS'), async (req, res) => {
  return res.status(501).json({
    error: 'USAGE_ALERT_DELIVERY_UNAVAILABLE',
    message: 'Las notificaciones por correo o webhook aún no están disponibles. El panel de uso muestra avisos dentro de GlowApp.',
  });
});

/**
 * GET /api/saas/usage/alerts
 * Lista alertas configuradas
 */
router.get('/alerts', async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { rows } = await pool.query(
      `SELECT metadata FROM business_profiles WHERE id = $1`, [req.saas.tenantId]
    );

    const alerts = rows[0]?.metadata?.usageAlerts || [];
    res.json({ tenantId: req.saas.tenantId, alerts });
  } catch (error) {
    console.error('[saasUsageRoutes] Error getting alerts:', error.message);
    res.status(500).json({ error: 'Error obteniendo alertas' });
  }
});

/**
 * DELETE /api/saas/usage/alerts/:index
 * Elimina alerta por índice
 */
router.delete('/alerts/:index', async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const index = parseInt(req.params.index, 10);
    if (isNaN(index)) return res.status(400).json({ error: 'Índice inválido' });

    const { rows } = await pool.query(
      `SELECT metadata FROM business_profiles WHERE id = $1`, [req.saas.tenantId]
    );

    const metadata = rows[0]?.metadata || {};
    const alerts = metadata.usageAlerts || [];

    if (index < 0 || index >= alerts.length) {
      return res.status(404).json({ error: 'Alerta no encontrada' });
    }

    alerts.splice(index, 1);
    metadata.usageAlerts = alerts;

    await pool.query(
      `UPDATE business_profiles SET metadata = $1 WHERE id = $2`,
      [JSON.stringify(metadata), req.saas.tenantId]
    );

    res.json({ message: 'Alerta eliminada' });
  } catch (error) {
    console.error('[saasUsageRoutes] Error deleting alert:', error.message);
    res.status(500).json({ error: 'Error eliminando alerta' });
  }
});

module.exports = router;
