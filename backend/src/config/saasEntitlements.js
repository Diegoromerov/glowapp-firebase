/**
 * Motor Centralizado de Entitlements / Capacidades SaaS para Salones
 *
 * Desacopla la lógica de negocio de los nombres específicos de planes.
 * Permite evaluar de forma dinámica: hasEntitlement(plan, capability)
 */

const { PLAN_CATALOG, getPlansWithCapability: catalogPlansWithCapability, hasCapability } = require('./saasCatalog');

const SAAS_CAPABILITIES = {
  MAP_VISIBILITY: 'MAP_VISIBILITY',           // Visibilidad en el mapa público de Home
  TEAM_MANAGEMENT: 'TEAM_MANAGEMENT',         // Invitar empleados / prestadores
  ADVANCED_ANALYTICS: 'ADVANCED_ANALYTICS',   // Métricas avanzadas de retención
  ONLINE_BOOKING: 'ONLINE_BOOKING',           // Agendamiento directo de clientes
  CUSTOM_BRANDING: 'CUSTOM_BRANDING',         // Logo y banners personalizados
  API_KEYS: 'API_KEYS',                       // Integraciones mediante llaves API
  WHATSAPP_INTEGRATION: 'WHATSAPP_INTEGRATION', // Integración con WhatsApp
  POS_INTEGRATION: 'POS_INTEGRATION',         // Punto de venta
};

// Compatibilidad con consumidores anteriores; ahora se deriva del catálogo.
const PLAN_ENTITLEMENTS = Object.fromEntries(
  Object.entries(PLAN_CATALOG).map(([plan, definition]) => [plan, definition.capabilities])
);

/**
 * Verifica si un plan determinado posee una capacidad/entitlement específico.
 * @param {string} plan - Identificador del plan SaaS (e.g. 'FREE_TRIAL', 'PRO', 'FREEMIUM')
 * @param {string} capability - Nombre de la capacidad (e.g. 'MAP_VISIBILITY')
 * @returns {boolean}
 */
function hasEntitlement(plan, capability) {
  if (!plan) return false;
  const normalizedPlan = plan.toUpperCase().trim();
  return hasCapability(normalizedPlan, capability);
}

/**
 * Retorna la lista de planes que otorgan una capacidad específica.
 * Útil para filtros SQL o comprobaciones de agregación.
 * @param {string} capability
 * @returns {string[]}
 */
function getPlansWithEntitlement(capability) {
  return catalogPlansWithCapability(capability);
}

module.exports = {
  SAAS_CAPABILITIES,
  PLAN_ENTITLEMENTS,
  CAPABILITIES: SAAS_CAPABILITIES,
  hasEntitlement,
  getPlansWithEntitlement,
};
