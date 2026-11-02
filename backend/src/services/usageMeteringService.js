// backend/src/services/usageMeteringService.js
const { pool } = require('../config/db');
const { hasEntitlement, SAAS_CAPABILITIES } = require('../config/saasEntitlements');

/**
 * Servicio centralizado de límites y métricas de uso por plan
 * Fuente de verdad para: featureGate, usageTracker, saasUsageRoutes, subscriptionService
 */

// Límites por plan (mensuales salvo que se indique)
const PLAN_LIMITS = {
  FREE_TRIAL: {
    MAP_VISIBILITY: 1,           // 1 perfil en mapa público
    ONLINE_BOOKING: 50,          // 50 citas online/mes
    TEAM_SEATS: 3,               // 3 asientos equipo
    API_CALLS: 1000,             // 1000 calls API/mes
    ADVANCED_ANALYTICS: 1,       // Habilitado (boolean)
    CUSTOM_BRANDING: 1,          // Habilitado (boolean)
    WHATSAPP_INTEGRATION: 0,     // No disponible
    POS_INTEGRATION: 0           // No disponible
  },
  FREEMIUM: {
    MAP_VISIBILITY: 0,           // Sin mapa público
    ONLINE_BOOKING: 20,          // 20 citas online/mes
    TEAM_SEATS: 1,               // 1 asiento (solo owner)
    API_CALLS: 500,              // 500 calls API/mes
    ADVANCED_ANALYTICS: 0,       // No disponible
    CUSTOM_BRANDING: 0,          // No disponible
    WHATSAPP_INTEGRATION: 0,
    POS_INTEGRATION: 0
  },
  BASIC: {
    MAP_VISIBILITY: 1,
    ONLINE_BOOKING: 200,
    TEAM_SEATS: 5,
    API_CALLS: 10000,
    ADVANCED_ANALYTICS: 0,
    CUSTOM_BRANDING: 0,
    WHATSAPP_INTEGRATION: 0,
    POS_INTEGRATION: 0
  },
  PRO: {
    MAP_VISIBILITY: 1,
    ONLINE_BOOKING: null,        // Ilimitado
    TEAM_SEATS: 20,
    API_CALLS: 100000,
    ADVANCED_ANALYTICS: 1,
    CUSTOM_BRANDING: 1,
    WHATSAPP_INTEGRATION: 1,
    POS_INTEGRATION: 0
  },
  ENTERPRISE: {
    MAP_VISIBILITY: 1,
    ONLINE_BOOKING: null,
    TEAM_SEATS: null,            // Ilimitado
    API_CALLS: null,             // Ilimitado
    ADVANCED_ANALYTICS: 1,
    CUSTOM_BRANDING: 1,
    WHATSAPP_INTEGRATION: 1,
    POS_INTEGRATION: 1
  }
};

/**
 * Obtiene límites para un plan
 */
function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.FREEMIUM;
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
  const limits = getPlanLimits(plan);
  return feature in limits ? limits[feature] : 0;
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
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const { rows: metric } = await pool.query(`
    SELECT count FROM usage_metrics
    WHERE tenant_id = $1 AND feature = $2 AND period_start = $3
  `, [tenantId, feature, periodStart.toISOString().split('T')[0]]);

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
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

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
    periodStart.toISOString().split('T')[0],
    periodEnd.toISOString().split('T')[0],
    delta,
    limit
  ]);

  return rows[0];
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
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const { rows } = await pool.query(`
    SELECT feature, count, limit FROM usage_metrics
    WHERE tenant_id = $1 AND period_start = $2
  `, [tenantId, periodStart.toISOString().split('T')[0]]);

  return rows;
}

/**
 * Resetea contadores mensuales (job mensual)
 * Se ejecuta día 1 de cada mes - mueve período anterior a histórico
 */
async function resetMonthlyCounters() {
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

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
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

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
    `, [tenant.id, periodStart.toISOString().split('T')[0]]);

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
  'MAP_VISIBILITY',
  'ONLINE_BOOKING',
  'TEAM_SEATS',
  'API_CALLS',
  'ADVANCED_ANALYTICS',
  'CUSTOM_BRANDING',
  'WHATSAPP_INTEGRATION',
  'POS_INTEGRATION'
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
  PLAN_LIMITS,
  getPlanLimits,
  hasFeature,
  getLimit,
  canConsume,
  incrementUsage,
  getCurrentUsage,
  getTenantPlan,
  resetMonthlyCounters,
  checkUsageAlerts,
  METERED_FEATURES,
  CAPABILITY_TO_FEATURE
};