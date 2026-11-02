// backend/src/routes/saasUsageRoutes.js
const express = require('express');
const { pool } = require('../config/db');
const saasContext = require('../middleware/saasContext');
const { requireEntitlement } = require('../middleware/featureGate');
const { authMiddleware } = require('../middleware/auth');
const usageMeteringService = require('../services/usageMeteringService');

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
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const { rows: metrics } = await pool.query(`
      SELECT feature, count, "limit", period_start, period_end
      FROM usage_metrics
      WHERE tenant_id = $1 AND period_start = $2
      ORDER BY feature;
    `, [tenantId, periodStart.toISOString().split('T')[0]]);

    // Límites del plan
    const planLimits = usageMeteringService.getPlanLimits(plan);

    // Calcular % de uso y alertas
    const usage = Object.keys(planLimits).map(feature => {
      const metric = metrics.find(m => m.feature === feature);
      const limit = planLimits[feature];
      const used = metric?.count || 0;
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
        used,
        limit: limit === null ? 'unlimited' : limit,
        remaining,
        percentage,
        status,
        periodStart: periodStart.toISOString().split('T')[0],
        periodEnd: periodEnd.toISOString().split('T')[0]
      };
    });

    // Resumen general
    const exceeded = usage.filter(u => u.status === 'exceeded').length;
    const warning = usage.filter(u => u.status === 'warning').length;

    res.json({
      tenantId,
      plan,
      period: { start: periodStart.toISOString().split('T')[0], end: periodEnd.toISOString().split('T')[0] },
      usage,
      summary: {
        totalFeatures: usage.length,
        exceeded,
        warning,
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
        AND period_start >= (date_trunc('month', CURRENT_DATE) - interval '${months} months')
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
 * GET /api/saas/usage/limits
 * Límites del plan actual (para UI de upgrade)
 */
router.get('/limits', async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const plan = req.saas.plan;
    const allPlans = ['FREE_TRIAL', 'FREEMIUM', 'BASIC', 'PRO', 'ENTERPRISE'];
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
      currentPlan: plan,
      plans: allPlans,
      limits: comparison
    });
  } catch (error) {
    console.error('[saasUsageRoutes] Error getting limits:', error.message);
    res.status(500).json({ error: 'Error obteniendo límites' });
  }
});

/**
 * POST /api/saas/usage/alerts
 * Configura alertas de uso (webhook/email cuando llega a %)
 */
router.post('/alerts', requireEntitlement('ADVANCED_ANALYTICS'), async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { feature, thresholdPercent, channel = 'email', webhookUrl } = req.body;

    if (!feature || !thresholdPercent || thresholdPercent < 1 || thresholdPercent > 100) {
      return res.status(400).json({ error: 'feature y thresholdPercent (1-100) requeridos' });
    }

    const validChannels = ['email', 'webhook'];
    if (!validChannels.includes(channel)) {
      return res.status(400).json({ error: 'Canal inválido', validChannels });
    }

    if (channel === 'webhook' && !webhookUrl) {
      return res.status(400).json({ error: 'webhookUrl requerido para canal webhook' });
    }

    // Guardar configuración de alerta (nueva tabla o metadata en business_profiles)
    // Por simplicidad, guardamos en metadata del tenant
    const { rows: tenant } = await pool.query(
      `SELECT metadata FROM business_profiles WHERE id = $1`, [req.saas.tenantId]
    );

    const metadata = tenant[0]?.metadata || {};
    metadata.usageAlerts = metadata.usageAlerts || [];
    metadata.usageAlerts.push({ feature, thresholdPercent, channel, webhookUrl, createdAt: new Date().toISOString() });

    await pool.query(
      `UPDATE business_profiles SET metadata = $1 WHERE id = $2`,
      [JSON.stringify(metadata), req.saas.tenantId]
    );

    res.json({ message: 'Alerta configurada', alert: { feature, thresholdPercent, channel } });
  } catch (error) {
    console.error('[saasUsageRoutes] Error setting alert:', error.message);
    res.status(500).json({ error: 'Error configurando alerta' });
  }
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