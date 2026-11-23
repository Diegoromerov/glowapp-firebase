/**
 * Catálogo SaaS v1: definición comercial, capacidades booleanas y cuotas.
 * Los valores de cuota conservan los límites históricos para que esta
 * centralización no cambie silenciosamente los contratos ya vendidos.
 */
const CATALOG_VERSION = 1;
const ADD_ONS = Object.freeze([]);

const CAPABILITIES = Object.freeze({
  MAP_VISIBILITY: { label: 'Presencia en el mapa', kind: 'boolean' },
  TEAM_MANAGEMENT: { label: 'Gestión de equipo', kind: 'boolean' },
  ADVANCED_ANALYTICS: { label: 'Analítica avanzada', kind: 'boolean' },
  ONLINE_BOOKING: { label: 'Reservas en línea', kind: 'quota', metric: 'ONLINE_BOOKING' },
  CUSTOM_BRANDING: { label: 'Marca personalizada', kind: 'boolean' },
  API_KEYS: { label: 'Integraciones con otros sistemas', kind: 'boolean' },
  WHATSAPP_INTEGRATION: { label: 'WhatsApp', kind: 'boolean' },
  POS_INTEGRATION: { label: 'Punto de venta', kind: 'boolean' },
});

const METRICS = Object.freeze({
  MAP_VISIBILITY: { label: 'Presencia en el mapa', unit: 'perfil', period: 'account', kind: 'boolean' },
  ONLINE_BOOKING: { label: 'Reservas en línea', unit: 'reservas', period: 'month', kind: 'quota' },
  TEAM_SEATS: { label: 'Personas del equipo', unit: 'personas', period: 'concurrent', kind: 'quota' },
  API_CALLS: { label: 'Procesos de integración', unit: 'procesos', period: 'month', kind: 'quota', internalLabel: 'API_CALLS' },
  ADVANCED_ANALYTICS: { label: 'Analítica avanzada', unit: null, period: 'account', kind: 'boolean' },
  CUSTOM_BRANDING: { label: 'Marca personalizada', unit: null, period: 'account', kind: 'boolean' },
  WHATSAPP_INTEGRATION: { label: 'WhatsApp', unit: null, period: 'account', kind: 'boolean' },
  POS_INTEGRATION: { label: 'Punto de venta', unit: null, period: 'account', kind: 'boolean' },
});

const PLAN_CATALOG = Object.freeze({
  FREE_TRIAL: {
    id: 'FREE_TRIAL', name: 'Prueba Gratis', priceCop: 0, priceUsd: 0, interval: 'month', trialDays: 14,
    description: 'Prueba GlowApp durante 14 días con hasta 3 personas de tu equipo.',
    popular: false,
    capabilities: ['MAP_VISIBILITY', 'TEAM_MANAGEMENT', 'ONLINE_BOOKING', 'CUSTOM_BRANDING'],
    quotas: { MAP_VISIBILITY: 1, ONLINE_BOOKING: 50, TEAM_SEATS: 3, API_CALLS: 1000, ADVANCED_ANALYTICS: 0, CUSTOM_BRANDING: 1, WHATSAPP_INTEGRATION: 0, POS_INTEGRATION: 0 },
  },
  FREEMIUM: {
    id: 'FREEMIUM', name: 'Freemium', priceCop: 0, priceUsd: 0, interval: 'month', trialDays: 0,
    description: 'Administra tu salón gratis de forma permanente con 1 persona.', popular: false,
    capabilities: ['ONLINE_BOOKING'],
    quotas: { MAP_VISIBILITY: 0, ONLINE_BOOKING: 20, TEAM_SEATS: 1, API_CALLS: 500, ADVANCED_ANALYTICS: 0, CUSTOM_BRANDING: 0, WHATSAPP_INTEGRATION: 0, POS_INTEGRATION: 0 },
  },
  BASIC: {
    id: 'BASIC', name: 'Básico', priceCop: 99000, priceUsd: 25, interval: 'month', trialDays: 0,
    description: 'Organiza el trabajo de hasta 5 personas y gestiona hasta 200 reservas al mes.', popular: false,
    capabilities: ['MAP_VISIBILITY', 'TEAM_MANAGEMENT', 'ONLINE_BOOKING'],
    quotas: { MAP_VISIBILITY: 1, ONLINE_BOOKING: 200, TEAM_SEATS: 5, API_CALLS: 10000, ADVANCED_ANALYTICS: 0, CUSTOM_BRANDING: 0, WHATSAPP_INTEGRATION: 0, POS_INTEGRATION: 0 },
  },
  PRO: {
    id: 'PRO', name: 'Profesional', priceCop: 249000, priceUsd: 65, interval: 'month', trialDays: 0,
    description: 'Coordina hasta 20 personas, recibe reservas sin límite y consulta analítica avanzada.', popular: true,
    capabilities: ['MAP_VISIBILITY', 'TEAM_MANAGEMENT', 'ONLINE_BOOKING', 'ADVANCED_ANALYTICS', 'CUSTOM_BRANDING', 'API_KEYS'],
    quotas: { MAP_VISIBILITY: 1, ONLINE_BOOKING: null, TEAM_SEATS: 20, API_CALLS: 100000, ADVANCED_ANALYTICS: 1, CUSTOM_BRANDING: 1, WHATSAPP_INTEGRATION: 0, POS_INTEGRATION: 0 },
  },
  ENTERPRISE: {
    id: 'ENTERPRISE', name: 'Empresarial', priceCop: 599000, priceUsd: 150, interval: 'month', trialDays: 0,
    description: 'Opera con equipo e integraciones sin límite, conecta WhatsApp y punto de venta y recibe soporte prioritario.', popular: false,
    capabilities: ['MAP_VISIBILITY', 'TEAM_MANAGEMENT', 'ONLINE_BOOKING', 'ADVANCED_ANALYTICS', 'CUSTOM_BRANDING', 'API_KEYS', 'WHATSAPP_INTEGRATION', 'POS_INTEGRATION'],
    quotas: { MAP_VISIBILITY: 1, ONLINE_BOOKING: null, TEAM_SEATS: null, API_CALLS: null, ADVANCED_ANALYTICS: 1, CUSTOM_BRANDING: 1, WHATSAPP_INTEGRATION: 1, POS_INTEGRATION: 1 },
  },
});

const PLAN_IDS = Object.freeze(Object.keys(PLAN_CATALOG));
const getPlan = (id) => PLAN_CATALOG[String(id || '').toUpperCase().trim()] || PLAN_CATALOG.FREEMIUM;
const getLimit = (plan, metric) => Object.prototype.hasOwnProperty.call(getPlan(plan).quotas, metric)
  ? getPlan(plan).quotas[metric]
  : 0;
const hasCapability = (plan, capability) => {
  const normalizedPlan = String(plan || '').toUpperCase().trim();
  return Boolean(PLAN_CATALOG[normalizedPlan]?.capabilities.includes(capability));
};
const getPlansWithCapability = (capability) => PLAN_IDS.filter((id) => hasCapability(id, capability));

function getMonthPeriod(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  };
}

function serializePlan(planId) {
  const plan = PLAN_CATALOG[planId];
  return {
    id: plan.id, name: plan.name, description: plan.description,
    priceCop: plan.priceCop, priceUsd: plan.priceUsd,
    prices: { COP: plan.priceCop, USD: plan.priceUsd }, currency: 'COP', interval: plan.interval,
    trialDays: plan.trialDays, popular: plan.popular,
    capabilities: [...plan.capabilities],
    quotas: Object.fromEntries(Object.entries(plan.quotas).map(([code, limit]) => [code, {
      ...METRICS[code], limit,
    }])),
  };
}

function publicCatalog() {
  return { version: CATALOG_VERSION, currency: 'COP', plans: PLAN_IDS.map(serializePlan), capabilities: CAPABILITIES, metrics: METRICS, addOns: ADD_ONS };
}

module.exports = { CATALOG_VERSION, ADD_ONS, CAPABILITIES, METRICS, PLAN_CATALOG, PLAN_IDS, getPlan, getLimit, hasCapability, getPlansWithCapability, getMonthPeriod, serializePlan, publicCatalog };
