/**
 * Motor Centralizado de Entitlements / Capacidades SaaS para Salones
 *
 * Desacopla la lógica de negocio de los nombres específicos de planes.
 * Permite evaluar de forma dinámica: hasEntitlement(plan, capability)
 */

const SAAS_CAPABILITIES = {
  MAP_VISIBILITY: 'MAP_VISIBILITY',           // Visibilidad en el mapa público de Home
  TEAM_MANAGEMENT: 'TEAM_MANAGEMENT',         // Invitar empleados / prestadores
  ADVANCED_ANALYTICS: 'ADVANCED_ANALYTICS',   // Métricas avanzadas de retención
  ONLINE_BOOKING: 'ONLINE_BOOKING',           // Agendamiento directo de clientes
  CUSTOM_BRANDING: 'CUSTOM_BRANDING',         // Logo y banners personalizados
};

// Mapeo canónico de planes SaaS a sus conjuntos de capacidades
const PLAN_ENTITLEMENTS = {
  FREE_TRIAL: [
    SAAS_CAPABILITIES.MAP_VISIBILITY,
    SAAS_CAPABILITIES.TEAM_MANAGEMENT,
    SAAS_CAPABILITIES.ONLINE_BOOKING,
    SAAS_CAPABILITIES.CUSTOM_BRANDING,
  ],
  FREEMIUM: [
    SAAS_CAPABILITIES.ONLINE_BOOKING,
    // Sin MAP_VISIBILITY en freemium base
  ],
  BASIC: [
    SAAS_CAPABILITIES.MAP_VISIBILITY,
    SAAS_CAPABILITIES.ONLINE_BOOKING,
  ],
  PRO: [
    SAAS_CAPABILITIES.MAP_VISIBILITY,
    SAAS_CAPABILITIES.TEAM_MANAGEMENT,
    SAAS_CAPABILITIES.ONLINE_BOOKING,
    SAAS_CAPABILITIES.ADVANCED_ANALYTICS,
    SAAS_CAPABILITIES.CUSTOM_BRANDING,
  ],
  ENTERPRISE: [
    SAAS_CAPABILITIES.MAP_VISIBILITY,
    SAAS_CAPABILITIES.TEAM_MANAGEMENT,
    SAAS_CAPABILITIES.ONLINE_BOOKING,
    SAAS_CAPABILITIES.ADVANCED_ANALYTICS,
    SAAS_CAPABILITIES.CUSTOM_BRANDING,
  ],
};

/**
 * Verifica si un plan determinado posee una capacidad/entitlement específico.
 * @param {string} plan - Identificador del plan SaaS (e.g. 'FREE_TRIAL', 'PRO', 'FREEMIUM')
 * @param {string} capability - Nombre de la capacidad (e.g. 'MAP_VISIBILITY')
 * @returns {boolean}
 */
function hasEntitlement(plan, capability) {
  if (!plan) return false;
  const normalizedPlan = plan.toUpperCase().trim();
  const entitlements = PLAN_ENTITLEMENTS[normalizedPlan] || [];
  return entitlements.includes(capability);
}

/**
 * Retorna la lista de planes que otorgan una capacidad específica.
 * Útil para filtros SQL o comprobaciones de agregación.
 * @param {string} capability
 * @returns {string[]}
 */
function getPlansWithEntitlement(capability) {
  return Object.keys(PLAN_ENTITLEMENTS).filter(plan =>
    PLAN_ENTITLEMENTS[plan].includes(capability)
  );
}

module.exports = {
  SAAS_CAPABILITIES,
  PLAN_ENTITLEMENTS,
  hasEntitlement,
  getPlansWithEntitlement,
};
