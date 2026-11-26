// Compatibilidad con callers heredados. Wompi Colombia no ofrece una API
// estilo Stripe `/subscriptions`; los cobros recurrentes se implementan con
// payment_sources + transactions y un ciclo local confirmado por webhooks.
// Mantener los métodos con error explícito evita IDs ficticios, HMACs inventados
// y falsos resultados de éxito mientras se termina el flujo SaaS recurrente.

const wompiClient = require('./wompiClient');

const WOMPI_BASE_URL_SANDBOX = 'https://sandbox.wompi.co/v1';
const WOMPI_BASE_URL_PRODUCTION = 'https://production.wompi.co/v1';

function resolveWompiBaseUrl() {
  const configured = process.env.WOMPI_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  return process.env.NODE_ENV === 'production'
    ? WOMPI_BASE_URL_PRODUCTION
    : WOMPI_BASE_URL_SANDBOX;
}

function isConfigured() {
  return wompiClient.isConfigured();
}

function unsupported(operation) {
  throw new Error(`${operation} no está implementado para Wompi; no se realizó ningún cobro ni cambio de plan.`);
}

function eventObject(rawBody) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function verifyWebhookSignature(rawBody, checksum) {
  try {
    return wompiClient.verifyEventChecksum(eventObject(rawBody), checksum).valid;
  } catch (_) {
    return false;
  }
}

function parseWebhookEvent(rawBody, checksum) {
  const event = eventObject(rawBody);
  if (!wompiClient.verifyEventChecksum(event, checksum).valid) {
    throw new Error('Checksum de evento Wompi inválido.');
  }
  return event;
}

module.exports = {
  isConfigured,
  resolveWompiBaseUrl,
  verifyWebhookSignature,
  parseWebhookEvent,
  createOrGetCustomer: () => unsupported('Crear customers tipo Stripe'),
  createSubscription: () => unsupported('Crear suscripciones tipo Stripe'),
  changeSubscriptionPlan: () => unsupported('Cambiar suscripciones tipo Stripe'),
  getSubscription: () => unsupported('Consultar suscripciones tipo Stripe'),
  cancelSubscription: () => unsupported('Cancelar suscripciones tipo Stripe'),
  createPaymentLink: () => unsupported('Crear un payment link desde el servicio legado')
};
