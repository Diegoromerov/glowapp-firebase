// backend/src/services/usageMeteringService.js
const { pool } = require('../config/db');
const { PLAN_CATALOG, METRICS, getLimit: catalogGetLimit, getMonthPeriod, PLAN_IDS } = require('../config/saasCatalog');
const { hasEntitlement } = require('../config/saasEntitlements');
const { runInTenantTransaction } = require('../config/tenantRouting');

/**
 * Servicio centralizado de límites y métricas de uso por plan
 * Fuente de verdad para: featureGate, usageTracker, saasUsageRoutes, subscriptionService
 */

// Proyección compatible con las rutas y reportes existentes.
const PLAN_LIMITS = Object.freeze(Object.fromEntries(
  Object.entries(PLAN_CATALOG).map(([plan, definition]) => [plan, definition.quotas])
));

/**
 * Obtiene límites para un plan
 */
function getPlanLimits(plan) {
  return PLAN_LIMITS[String(plan || '').toUpperCase().trim()] || PLAN_LIMITS.FREEMIUM;
}

/** Devuelve solo cuotas contables, excluyendo capacidades booleanas y alias. */
function getMeteredFeatures(planLimits) {
  return Object.keys(planLimits || {}).filter((feature) =>
    feature !== 'ONLINE_BOOKING' && METRICS[feature]?.kind !== 'boolean'
  );
}

/** Cuenta las sedes reales asociadas al tenant para la cuota concurrente SITES. */
async function getSiteCount(tenantId) {
  const { rows } = await pool.query(`
    SELECT COUNT(DISTINCT id)::integer AS count
    FROM salones
    WHERE business_profile_id = $1
  `, [tenantId]);
  return Number(rows[0]?.count || 0);
}

/** Clasifica agotamiento mensual y capacidad concurrente con semántica distinta. */
function getUsageStatus(feature, used, limit) {
  const numericLimit = Number(limit);
  if (!Number.isFinite(numericLimit) || numericLimit <= 0) return 'ok';
  const percentage = (Number(used) / numericLimit) * 100;
  const isConcurrent = METRICS[feature]?.period === 'concurrent';

  if (isConcurrent ? Number(used) > numericLimit : percentage >= 100) return 'exceeded';
  if (percentage >= 80) return 'warning';
  if (percentage >= 60) return 'caution';
  return 'ok';
}

/**
 * Verifica si un plan tiene una feature (boolean)
 */
function hasFeature(plan, feature) {
  const limits = getPlanLimits(plan);
  const value = limits[feature];
  return value === 1 || value === true || value === null; // null = ilimitado = habilitado
}

/**
 * Obtiene límite numérico para feature (null = ilimitado)
 */
function getLimit(plan, feature) {
  return catalogGetLimit(plan, feature);
}

/**
 * Verifica si tenant puede realizar acción (consumo +1)
 * Usado por middleware usageTracker para pre-check opcional
 */
async function canConsume(tenantId, feature, delta = 1) {
  const { rows: tenant } = await pool.query(
    `SELECT saas_plan FROM business_profiles WHERE id = $1`, [tenantId]
  );
  if (tenant.length === 0) return { allowed: false, reason: 'Tenant no encontrado' };

  const plan = tenant[0].saas_plan || 'FREEMIUM';
  const limit = getLimit(plan, feature);

  // Feature no disponible en plan
  if (limit === 0) return { allowed: false, reason: 'Feature no disponible en plan', plan, limit: 0 };

  // Ilimitado
  if (limit === null) return { allowed: true, plan, limit: 'unlimited' };

  // Verificar uso actual
  const { start } = getMonthPeriod();

  const { rows: metric } = await pool.query(`
    SELECT count FROM usage_metrics
    WHERE tenant_id = $1 AND feature = $2 AND period_start = $3
  `, [tenantId, feature, start]);

  const current = metric[0]?.count || 0;
  const remaining = limit - current;

  if (remaining < delta) {
    return { 
      allowed: false, 
      reason: 'Límite excedido', 
      plan, 
      limit, 
      current, 
      remaining: Math.max(0, remaining) 
    };
  }

  return { allowed: true, plan, limit, current, remaining: remaining - delta };
}

/**
 * Incrementa contador de uso (UPSERT atómico)
 * Retorna nuevo conteo
 */
async function incrementUsage(tenantId, feature, delta = 1) {
  const { start, end } = getMonthPeriod();

  const plan = await getTenantPlan(tenantId);
  const limit = getLimit(plan, feature);

  const query = `
    INSERT INTO usage_metrics (tenant_id, feature, period_start, period_end, count, "limit")
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tenant_id, feature, period_start)
    DO UPDATE SET
      count = usage_metrics.count + EXCLUDED.count,
      "limit" = EXCLUDED."limit",
      updated_at = NOW()
    RETURNING count, "limit";
  `;

  const { rows } = await pool.query(query, [
    tenantId,
    feature,
    start,
    end,
    delta,
    limit
  ]);

  return rows[0];
}

/** Consume una cuota con control atómico para evitar excederla en concurrencia. */
async function consumeUsage(tenantId, feature, delta = 1) {
  const plan = await getTenantPlan(tenantId);
  const limit = getLimit(plan, feature);
  if (limit === 0) return { allowed: false, plan, limit: 0, reason: 'Feature no disponible en plan' };

  const { start, end } = getMonthPeriod();
  const { rows } = await pool.query(`
    INSERT INTO usage_metrics (tenant_id, feature, period_start, period_end, count, "limit")
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tenant_id, feature, period_start)
    DO UPDATE SET
      count = usage_metrics.count + EXCLUDED.count,
      "limit" = EXCLUDED."limit",
      updated_at = NOW()
    WHERE EXCLUDED."limit" IS NULL
       OR usage_metrics.count + EXCLUDED.count <= EXCLUDED."limit"
    RETURNING count, "limit";
  `, [tenantId, feature, start, end, delta, limit]);

  if (rows.length) return { allowed: true, plan, limit: limit === null ? 'unlimited' : limit, ...rows[0] };
  const { rows: currentRows } = await pool.query(
    `SELECT count FROM usage_metrics WHERE tenant_id = $1 AND feature = $2 AND period_start = $3`,
    [tenantId, feature, start]
  );
  return { allowed: false, plan, limit, current: currentRows[0]?.count || 0, reason: 'Límite excedido' };
}

/**
 * Consume una consulta de Aura para negocio bajo el perfil SaaS autenticado.
 * Se resuelve la membresía activa y el plan dentro del contexto RLS de ese
 * perfil; el bloqueo y el UPSERT evitan exceder la cuota en concurrencia.
 */
async function consumeAuraBusinessQuery({ tenantId, userId, dbPool = pool }) {
  if (!tenantId || !Number.isSafeInteger(Number(userId)) || Number(userId) < 1) {
    return { allowed: false, reason: 'SaaS context required' };
  }

  return runInTenantTransaction({ pool: dbPool }, String(tenantId), Number(userId), async (client) => {
    await client.query("SELECT set_config('app.business_profile_id', $1, true)", [String(tenantId)]);
    const { rows: memberships } = await client.query(`
      SELECT bp.saas_plan
        FROM memberships m
        JOIN business_profiles bp ON bp.id = m.business_profile_id
       WHERE m.business_profile_id = $1
         AND m.user_id = $2
         AND m.status = 'ACTIVE'
       LIMIT 1
    `, [String(tenantId), Number(userId)]);
    if (!memberships.length) return { allowed: false, reason: 'Active membership required' };

    const plan = String(memberships[0].saas_plan || 'FREEMIUM').toUpperCase();
    if (!hasEntitlement(plan, 'AURA_BUSINESS')) {
      return { allowed: false, reason: 'Feature not included in plan', plan, limit: 0 };
    }

    const limit = getLimit(plan, 'AURA_QUERIES');
    if (limit === 0) return { allowed: false, reason: 'Feature not included in plan', plan, limit };

    const { start, end } = getMonthPeriod();
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 73110))',
      [`${tenantId}:AURA_QUERIES:${start}`]
    );
    const { rows } = await client.query(`
      INSERT INTO usage_metrics (tenant_id, feature, period_start, period_end, count, "limit")
      VALUES ($1, 'AURA_QUERIES', $2, $3, 1, $4)
      ON CONFLICT (tenant_id, feature, period_start)
      DO UPDATE SET count = usage_metrics.count + 1,
                    "limit" = EXCLUDED."limit",
                    updated_at = NOW()
      WHERE EXCLUDED."limit" IS NULL
         OR usage_metrics.count + 1 <= EXCLUDED."limit"
      RETURNING count
    `, [String(tenantId), start, end, limit]);

    if (rows.length) {
      const current = Number(rows[0].count);
      return {
        allowed: true,
        plan,
        limit: limit === null ? 'unlimited' : limit,
        current,
        remaining: limit === null ? null : Math.max(0, limit - current),
      };
    }

    const { rows: currentRows } = await client.query(`
      SELECT count FROM usage_metrics
       WHERE tenant_id = $1 AND feature = 'AURA_QUERIES' AND period_start = $2
    `, [String(tenantId), start]);
    const current = Number(currentRows[0]?.count || 0);
    return { allowed: false, reason: 'Quota exceeded', plan, limit, current, remaining: 0 };
  });
}

/**
 * Obtiene plan actual del tenant
 */
async function getTenantPlan(tenantId) {
  const { rows } = await pool.query(
    `SELECT saas_plan FROM business_profiles WHERE id = $1`, [tenantId]
  );
  return rows[0]?.saas_plan || 'FREEMIUM';
}

/**
 * Obtiene uso actual del período para un tenant
 */
async function getCurrentUsage(tenantId) {
  const { start } = getMonthPeriod();

  const { rows } = await pool.query(`
    SELECT feature, count, limit FROM usage_metrics
    WHERE tenant_id = $1 AND period_start = $2
  `, [tenantId, start]);

  return rows;
}

/**
 * Resetea contadores mensuales (job mensual)
 * Se ejecuta día 1 de cada mes - mueve período anterior a histórico
 */
async function resetMonthlyCounters() {
  const now = new Date();
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  // Los contadores se "resetean" naturalmente porque period_start cambia
  // Esta función puede usarse para archivar o alertar

  // Ejemplo: detectar tenants que excedieron límites el mes pasado
  const { rows: exceeded } = await pool.query(`
    SELECT um.tenant_id, um.feature, um.count, um."limit", bp.saas_plan, bp.name
    FROM usage_metrics um
    JOIN business_profiles bp ON bp.id = um.tenant_id
    WHERE um.period_start = $1
      AND um."limit" IS NOT NULL
      AND um.count > um."limit"
  `, [prevMonthStart.toISOString().split('T')[0]]);

  return { period: prevMonthStart.toISOString().split('T')[0], exceeded };
}

/**
 * Verifica y alerta si uso supera umbral (para job diario/cron)
 */
async function checkUsageAlerts() {
  const { start } = getMonthPeriod();

  // Obtener tenants con alertas configuradas en metadata
  const { rows: tenants } = await pool.query(`
    SELECT id, name, saas_plan, metadata
    FROM business_profiles
    WHERE metadata->'usageAlerts' IS NOT NULL
  `);

  const alerts = [];

  for (const tenant of tenants) {
    const configuredAlerts = tenant.metadata?.usageAlerts || [];
    if (configuredAlerts.length === 0) continue;

    const { rows: metrics } = await pool.query(`
      SELECT feature, count, limit FROM usage_metrics
      WHERE tenant_id = $1 AND period_start = $2
    `, [tenant.id, start]);

    for (const alert of configuredAlerts) {
      const metric = metrics.find(m => m.feature === alert.feature);
      if (!metric || !metric["limit"]) continue;

      const percentage = (metric.count / metric["limit"]) * 100;
      if (percentage >= alert.thresholdPercent) {
        alerts.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          plan: tenant.saas_plan,
          feature: alert.feature,
          threshold: alert.thresholdPercent,
          currentPercent: Math.round(percentage),
          count: metric.count,
          limit: metric["limit"],
          channel: alert.channel,
          webhookUrl: alert.webhookUrl
        });
      }
    }
  }

  return alerts;
}

/**
 * Features disponibles para gating
 */
const METERED_FEATURES = [
  ...Object.keys(METRICS),
];

/**
 * Mapea capability de saasEntitlements a feature medible
 */
const CAPABILITY_TO_FEATURE = {
  MAP_VISIBILITY: 'MAP_VISIBILITY',
  ONLINE_BOOKING: 'ONLINE_BOOKING',
  TEAM_SEATS: 'TEAM_SEATS',
  API_CALLS: 'API_CALLS',
  ADVANCED_ANALYTICS: 'ADVANCED_ANALYTICS',
  CUSTOM_BRANDING: 'CUSTOM_BRANDING',
  WHATSAPP_INTEGRATION: 'WHATSAPP_INTEGRATION',
  POS_INTEGRATION: 'POS_INTEGRATION'
};

module.exports = {
  PLAN_IDS,
  METRICS,
  PLAN_LIMITS,
  getPlanLimits,
  getMeteredFeatures,
  getSiteCount,
  getUsageStatus,
  hasFeature,
  getLimit,
  canConsume,
  incrementUsage,
  consumeUsage,
  consumeAuraBusinessQuery,
  getCurrentUsage,
  getTenantPlan,
  resetMonthlyCounters,
  checkUsageAlerts,
  METERED_FEATURES,
  CAPABILITY_TO_FEATURE
};
