/**
 * Catálogo SaaS versionado: precios publicados, capacidades y cuotas.
 * Los cobros externos (pasarela y proveedor tecnológico DIAN) deben tener
 * configuración propia antes de considerarse disponibles en producción.
 */
const CATALOG_VERSION = 4;

const ADD_ONS = Object.freeze([
  { id: 'INVOICING_ADDON', name: 'Facturación electrónica para Básico', proposedPriceCop: 59000, interval: 'month', limit: 250, metric: 'INVOICING_DOCUMENTS', available: false },
  { id: 'INVOICING_ACTIVATION', name: 'Activación de facturación', proposedPriceCop: 79000, interval: 'once', annualWaived: true, available: false },
  { id: 'INVOICING_DOCUMENTS_100', name: 'Paquete de 100 documentos', proposedPriceCop: 9000, interval: 'once', metric: 'INVOICING_DOCUMENTS', amount: 100, available: false },
  { id: 'WHATSAPP_MESSAGES_50', name: 'Paquete de 50 mensajes WhatsApp', proposedPriceCop: 10000, interval: 'once', metric: 'WHATSAPP_MESSAGES', amount: 50, available: false },
  { id: 'AURA_QUERIES_100', name: 'Paquete de 100 consultas Aura', proposedPriceCop: 39000, interval: 'once', metric: 'AURA_QUERIES', amount: 100, available: false },
  { id: 'ADDITIONAL_TAX_ID', name: 'NIT adicional con facturación', proposedPriceCop: 35000, interval: 'month', available: false },
  { id: 'ADDITIONAL_SITE', name: 'Sede adicional', proposedPriceCop: 79000, interval: 'month', available: false },
]);

const CAPABILITIES = Object.freeze({
  MAP_VISIBILITY: { label: 'Presencia en el mapa', kind: 'boolean' },
  TEAM_MANAGEMENT: { label: 'Gestión de equipo, roles y permisos', kind: 'boolean' },
  ADVANCED_ANALYTICS: { label: 'Analítica avanzada', kind: 'boolean' },
  BASIC_REPORTS: { label: 'Reportes básicos', kind: 'boolean' },
  ONLINE_BOOKING: { label: 'Reservas en línea', kind: 'quota', metric: 'DIRECT_BOOKINGS' },
  CUSTOM_BRANDING: { label: 'Marca personalizada', kind: 'boolean' },
  API_KEYS: { label: 'API abierta', kind: 'quota', metric: 'API_CALLS' },
  WHATSAPP_INTEGRATION: { label: 'WhatsApp', kind: 'quota', metric: 'WHATSAPP_MESSAGES' },
  POS_INTEGRATION: { label: 'Caja y ventas', kind: 'boolean' },
  POS_RECEIPTS_ONLY: { label: 'Recibos no fiscales', kind: 'boolean' },
  INVENTORY: { label: 'Inventario', kind: 'boolean' },
  RESOURCES: { label: 'Gestión de recursos', kind: 'quota', metric: 'RESOURCES' },
  COMPLIANCE: { label: 'Checklists de cumplimiento', kind: 'boolean' },
  INVOICING: { label: 'Facturación electrónica', kind: 'quota', metric: 'INVOICING_DOCUMENTS' },
  INVOICING_TEST: { label: 'Facturación electrónica en modo de pruebas', kind: 'boolean' },
  INVOICING_ADDON: { label: 'Complemento de facturación electrónica', kind: 'quota', metric: 'INVOICING_DOCUMENTS' },
  LOYALTY: { label: 'Fidelización y puntos del salón', kind: 'boolean' },
  RECIPES: { label: 'Recetas y consumo de productos', kind: 'boolean' },
  CONTRACTS: { label: 'Contratos y alquiler de silla', kind: 'boolean' },
  AURA_BUSINESS: { label: 'Aura para el negocio', kind: 'quota', metric: 'AURA_QUERIES' },
  MULTI_SITE: { label: 'Multi-sede y consolidado', kind: 'quota', metric: 'SITES' },
});

const METRICS = Object.freeze({
  MAP_VISIBILITY: { label: 'Presencia en el mapa', unit: 'perfil', period: 'account', kind: 'boolean' },
  ONLINE_BOOKING: { label: 'Reservas en línea', unit: 'reservas', period: 'month', kind: 'quota' },
  DIRECT_BOOKINGS: { label: 'Reservas directas', unit: 'reservas', period: 'month', kind: 'quota' },
  TEAM_SEATS: { label: 'Personas del equipo', unit: 'personas', period: 'concurrent', kind: 'quota' },
  INVOICING_DOCUMENTS: { label: 'Documentos electrónicos', unit: 'documentos', period: 'month', kind: 'quota' },
  INVOICING_TAX_IDS: { label: 'NIT con facturación', unit: 'NIT', period: 'account', kind: 'quota' },
  RESOURCES: { label: 'Recursos del salón', unit: 'recursos', period: 'concurrent', kind: 'quota' },
  AURA_QUERIES: { label: 'Consultas de Aura', unit: 'consultas', period: 'month', kind: 'quota' },
  WHATSAPP_MESSAGES: { label: 'Mensajes de WhatsApp', unit: 'mensajes', period: 'month', kind: 'quota' },
  SITES: { label: 'Sedes', unit: 'sedes', period: 'concurrent', kind: 'quota' },
  API_CALLS: { label: 'Procesos de integración', unit: 'solicitudes', period: 'month', kind: 'quota' },
  // Alias temporal para conservar consumidores previos mientras se migra su UI.
  ADVANCED_ANALYTICS: { label: 'Analítica avanzada', unit: null, period: 'account', kind: 'boolean' },
  CUSTOM_BRANDING: { label: 'Marca personalizada', unit: null, period: 'account', kind: 'boolean' },
  WHATSAPP_INTEGRATION: { label: 'WhatsApp', unit: null, period: 'account', kind: 'boolean' },
  POS_INTEGRATION: { label: 'Caja y ventas', unit: null, period: 'account', kind: 'boolean' },
});

const COMMON_PAID = [
  'MAP_VISIBILITY', 'TEAM_MANAGEMENT', 'ONLINE_BOOKING', 'POS_INTEGRATION',
  'INVENTORY', 'BASIC_REPORTS', 'RESOURCES', 'COMPLIANCE',
];

const PLAN_CATALOG = Object.freeze({
  // Oferta heredada: solo para conservar derechos de tenants ya existentes.
  // No se muestra en el catálogo ni se puede contratar para altas nuevas.
  FREE_TRIAL_LEGACY: {
    id: 'FREE_TRIAL_LEGACY', name: 'Prueba Gratis', priceCop: 0, annualPriceCop: null, priceUsd: 0,
    interval: 'month', trialDays: 14, commerciallyAvailable: false, publiclyListed: false,
    description: 'Oferta heredada de prueba gratis.', popular: false,
    capabilities: [
      'MAP_VISIBILITY', 'TEAM_MANAGEMENT', 'ONLINE_BOOKING', 'POS_INTEGRATION', 'INVENTORY',
      'BASIC_REPORTS', 'RESOURCES', 'COMPLIANCE', 'CUSTOM_BRANDING', 'LOYALTY', 'RECIPES',
      'ADVANCED_ANALYTICS', 'INVOICING_TEST', 'AURA_BUSINESS', 'WHATSAPP_INTEGRATION',
    ],
    quotas: {
      MAP_VISIBILITY: 1, ONLINE_BOOKING: 150, DIRECT_BOOKINGS: 150, TEAM_SEATS: 3,
      INVOICING_DOCUMENTS: 0, INVOICING_TAX_IDS: 1, RESOURCES: null, AURA_QUERIES: 10,
      WHATSAPP_MESSAGES: 20, SITES: 1, API_CALLS: 0, ADVANCED_ANALYTICS: 1,
      CUSTOM_BRANDING: 1, WHATSAPP_INTEGRATION: 1, POS_INTEGRATION: 1,
    },
  },
  FREE_TRIAL: {
    id: 'FREE_TRIAL', name: 'Prueba Gratis', priceCop: 0, annualPriceCop: null, priceUsd: 0,
    interval: 'month', trialDays: 14,
    description: 'Prueba GlowApp durante 14 días con hasta 3 personas y 150 reservas al mes.', popular: false,
    capabilities: [
      'MAP_VISIBILITY', 'TEAM_MANAGEMENT', 'ONLINE_BOOKING', 'POS_INTEGRATION', 'INVENTORY',
      'BASIC_REPORTS', 'RESOURCES', 'COMPLIANCE', 'LOYALTY', 'RECIPES',
    ],
    quotas: {
      MAP_VISIBILITY: 1, ONLINE_BOOKING: 150, DIRECT_BOOKINGS: 150, TEAM_SEATS: 3,
      INVOICING_DOCUMENTS: 0, INVOICING_TAX_IDS: 0, RESOURCES: null, AURA_QUERIES: 0,
      WHATSAPP_MESSAGES: 0, SITES: 1, API_CALLS: 0, ADVANCED_ANALYTICS: 0,
      CUSTOM_BRANDING: 0, WHATSAPP_INTEGRATION: 0, POS_INTEGRATION: 1,
    },
  },
  FREEMIUM: {
    id: 'FREEMIUM', name: 'Freemium', priceCop: 0, annualPriceCop: null, priceUsd: 0,
    interval: 'month', trialDays: 0,
    description: 'Administra tu salón gratis de forma permanente con 1 persona y 30 reservas al mes.', popular: false,
    capabilities: ['MAP_VISIBILITY', 'ONLINE_BOOKING', 'POS_RECEIPTS_ONLY', 'BASIC_REPORTS'],
    quotas: {
      MAP_VISIBILITY: 1, ONLINE_BOOKING: 30, DIRECT_BOOKINGS: 30, TEAM_SEATS: 1,
      INVOICING_DOCUMENTS: 0, INVOICING_TAX_IDS: 0, RESOURCES: 0, AURA_QUERIES: 0,
      WHATSAPP_MESSAGES: 0, SITES: 1, API_CALLS: 0, ADVANCED_ANALYTICS: 0,
      CUSTOM_BRANDING: 0, WHATSAPP_INTEGRATION: 0, POS_INTEGRATION: 0,
    },
  },
  BASIC: {
    id: 'BASIC', name: 'Básico', priceCop: 99000, proposedAnnualPriceCop: 79200, priceUsd: null,
    interval: 'month', trialDays: 0,
    description: 'Agenda, caja, inventario y recursos para un salón de hasta 5 personas, con reservas ilimitadas.', popular: false,
    // El complemento de facturación aún no se puede contratar ni emitir.
    capabilities: [...COMMON_PAID],
    quotas: {
      MAP_VISIBILITY: 1, ONLINE_BOOKING: null, DIRECT_BOOKINGS: null, TEAM_SEATS: 5,
      INVOICING_DOCUMENTS: 0, INVOICING_TAX_IDS: 0, RESOURCES: 5, AURA_QUERIES: 0,
      WHATSAPP_MESSAGES: 0, SITES: 1, API_CALLS: 0, ADVANCED_ANALYTICS: 0,
      CUSTOM_BRANDING: 0, WHATSAPP_INTEGRATION: 0, POS_INTEGRATION: 1,
    },
  },
  GROWTH: {
    id: 'GROWTH', name: 'Crecimiento', priceCop: null, proposedPriceCop: 169000, proposedAnnualPriceCop: 135200, priceUsd: null,
    interval: 'month', trialDays: 0,
    description: 'Plan propuesto: facturación, marca propia y fidelización para equipos de hasta 10 personas.', popular: false, commerciallyAvailable: false,
    capabilities: [...COMMON_PAID, 'CUSTOM_BRANDING', 'LOYALTY', 'INVOICING', 'AURA_BUSINESS', 'WHATSAPP_INTEGRATION'],
    quotas: {
      MAP_VISIBILITY: 1, ONLINE_BOOKING: null, DIRECT_BOOKINGS: null, TEAM_SEATS: 10,
      INVOICING_DOCUMENTS: 400, INVOICING_TAX_IDS: 1, RESOURCES: 15, AURA_QUERIES: 50,
      WHATSAPP_MESSAGES: 50, SITES: 1, API_CALLS: 0, ADVANCED_ANALYTICS: 0,
      CUSTOM_BRANDING: 1, WHATSAPP_INTEGRATION: 50, POS_INTEGRATION: 1,
    },
  },
  PRO: {
    id: 'PRO', name: 'Profesional', priceCop: 249000, priceUsd: 65,
    interval: 'month', trialDays: 0,
    description: 'Propuesta V3: recetas, analítica y contratos para equipos de hasta 20 personas.', popular: true, commerciallyAvailable: false,
    // Conserva los derechos del plan ya contratado. La propuesta V3 se publica
    // como propuesta comercial aparte, sin revocar API_KEYS a clientes actuales.
    capabilities: ['MAP_VISIBILITY', 'TEAM_MANAGEMENT', 'ONLINE_BOOKING', 'ADVANCED_ANALYTICS', 'CUSTOM_BRANDING', 'API_KEYS'],
    quotas: { MAP_VISIBILITY: 1, ONLINE_BOOKING: null, DIRECT_BOOKINGS: null, TEAM_SEATS: 20, SITES: 1, API_CALLS: 100000, ADVANCED_ANALYTICS: 1, CUSTOM_BRANDING: 1, WHATSAPP_INTEGRATION: 0, POS_INTEGRATION: 0 },
    proposedOffer: { priceCop: 249000, annualPriceCop: 199200, apiKeys: false, invoicingDocuments: 800, resources: null, auraQueries: 150, whatsappMessages: 100, sites: 1 },
  },
  ENTERPRISE: {
    id: 'ENTERPRISE', name: 'Empresarial', priceCop: 599000, priceUsd: 150, proposedPriceCop: 449000, proposedAnnualPriceCop: 359200,
    interval: 'month', trialDays: 0,
    description: 'Propuesta V3: operación multi-sede, API abierta y atención comercial para cadenas.', popular: false, commerciallyAvailable: false,
    capabilities: ['MAP_VISIBILITY', 'TEAM_MANAGEMENT', 'ONLINE_BOOKING', 'ADVANCED_ANALYTICS', 'CUSTOM_BRANDING', 'API_KEYS', 'WHATSAPP_INTEGRATION', 'POS_INTEGRATION'],
    quotas: { MAP_VISIBILITY: 1, ONLINE_BOOKING: null, DIRECT_BOOKINGS: null, TEAM_SEATS: null, SITES: 1, API_CALLS: null, ADVANCED_ANALYTICS: 1, CUSTOM_BRANDING: 1, WHATSAPP_INTEGRATION: 1, POS_INTEGRATION: 1 },
    proposedOffer: { priceCop: 449000, annualPriceCop: 359200, apiCalls: 500000, invoicingDocuments: 2500, auraQueries: 600, whatsappMessages: 500, sites: 3, multiSite: true },
  },
});

// El orden conserva el escalón comercial previo; Crecimiento se ubica entre
// Básico y Profesional para que validaciones de upgrade no bajen de categoría.
const PLAN_IDS = Object.freeze(['FREE_TRIAL_LEGACY', 'FREE_TRIAL', 'FREEMIUM', 'BASIC', 'GROWTH', 'PRO', 'ENTERPRISE']);
const getPlan = (id) => PLAN_CATALOG[String(id || '').toUpperCase().trim()] || PLAN_CATALOG.FREEMIUM;
const getLimit = (plan, metric) => {
  const normalizedMetric = metric === 'ONLINE_BOOKING' ? 'DIRECT_BOOKINGS' : metric;
  return Object.prototype.hasOwnProperty.call(getPlan(plan).quotas, normalizedMetric)
  ? getPlan(plan).quotas[normalizedMetric]
  : 0;
};
const hasCapability = (plan, capability) => {
  const normalizedPlan = String(plan || '').toUpperCase().trim();
  return Boolean(PLAN_CATALOG[normalizedPlan]?.capabilities.includes(capability));
};
const getPlansWithCapability = (capability) => PLAN_IDS.filter((id) => hasCapability(id, capability));

function getMonthPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
  return { start, end };
}

function serializePlan(planId) {
  const plan = PLAN_CATALOG[planId];
  return {
    id: plan.id, name: plan.name, description: plan.description,
    priceCop: plan.priceCop ?? null, annualPriceCop: plan.annualPriceCop ?? null,
    proposedPriceCop: plan.proposedPriceCop ?? null,
    proposedAnnualPriceCop: plan.proposedAnnualPriceCop ?? plan.proposedOffer?.annualPriceCop ?? null,
    proposedOffer: plan.proposedOffer ?? null,
    commerciallyAvailable: plan.commerciallyAvailable !== false,
    priceUsd: plan.priceUsd,
    prices: { COP: plan.priceCop ?? null, annualCOP: plan.annualPriceCop ?? null, USD: plan.priceUsd },
    currency: 'COP', interval: plan.interval, trialDays: plan.trialDays,
    popular: plan.popular, capabilities: [...plan.capabilities],
    quotas: Object.fromEntries(Object.entries(plan.quotas).map(([code, limit]) => [code, {
      ...(METRICS[code] || { label: code, unit: null, period: 'account', kind: 'quota' }), limit,
    }])),
  };
}

function publicCatalog() {
  return { version: CATALOG_VERSION, currency: 'COP', plans: PLAN_IDS
    .filter((id) => PLAN_CATALOG[id].publiclyListed !== false)
    .map(serializePlan), capabilities: CAPABILITIES, metrics: METRICS, addOns: ADD_ONS };
}

module.exports = { CATALOG_VERSION, ADD_ONS, CAPABILITIES, METRICS, PLAN_CATALOG, PLAN_IDS, getPlan, getLimit, hasCapability, getPlansWithCapability, getMonthPeriod, serializePlan, publicCatalog };
