// backend/src/services/wompiSubscriptionService.js
const fetch = require('node-fetch');
const crypto = require('crypto');

const WOMPI_BASE_URL_SANDBOX = 'https://sandbox.wompi.co/v1';
const WOMPI_BASE_URL_PRODUCTION = 'https://production.wompi.co/v1';

/**
 * Resuelve el host de Wompi en tiempo de llamada, no al importar.
 *
 * Antes el fallback era producción siempre: con llaves `pub_test_*` y sin la
 * variable, las suscripciones SaaS pegaban a producción mientras la tienda
 * (wompiClient, que decide por NODE_ENV) usaba sandbox. Misma regla que allí.
 */
function resolveWompiBaseUrl() {
  const explicita = process.env.WOMPI_BASE_URL;
  if (explicita) return explicita.replace(/\/$/, '');
  return process.env.NODE_ENV === 'production'
    ? WOMPI_BASE_URL_PRODUCTION
    : WOMPI_BASE_URL_SANDBOX;
}
const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY; // llave privada para firmar
const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY;
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET; // para verificar webhooks

let _configured = null;

function isConfigured() {
  if (_configured !== null) return _configured;
  _configured = Boolean(WOMPI_PRIVATE_KEY && WOMPI_PUBLIC_KEY);
  return _configured;
}

function _authHeaders() {
  return {
    'Authorization': `Bearer ${WOMPI_PRIVATE_KEY}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Crea o recupera un customer en Wompi
 * Wompi usa "customer" para tokenización de tarjetas
 */
async function createOrGetCustomer({ email, metadata = {} }) {
  if (!isConfigured()) {
    throw new Error('Wompi no configurado: faltan WOMPI_PRIVATE_KEY / WOMPI_PUBLIC_KEY');
  }

  // Wompi no tiene API de "list customers by email" público
  // Asumimos que el tenant ya tiene customer_id guardado en BD
  // Este método es placeholder para compatibilidad con subscriptionService
  return {
    id: `cus_${metadata.tenantId || 'unknown'}_${Date.now()}`,
    email,
    metadata
  };
}

/**
 * Crea una suscripción en Wompi
 * Wompi maneja suscripciones via "payment_source" + "subscription" endpoints
 */
async function createSubscription({ customerId, planId, paymentMethodId, trialDays }) {
  if (!isConfigured()) {
    throw new Error('Wompi no configurado');
  }

  const body = {
    payment_method: {
      type: 'CARD',
      token: paymentMethodId, // token retornado por widget Wompi en frontend
      installments: 1
    },
    plan_id: planId,
    currency: 'COP'
  };

  if (trialDays && trialDays > 0) {
    body.trial_days = trialDays;
  }

  const response = await fetch(`${resolveWompiBaseUrl()}/subscriptions`, {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Wompi create subscription failed: ${response.status} ${JSON.stringify(error)}`);
  }

  return await response.json();
}

/**
 * Cambia el plan de una suscripción en Wompi
 */
async function changeSubscriptionPlan({ subscriptionId, newPlanId, prorate = true }) {
  if (!isConfigured()) {
    throw new Error('Wompi no configurado');
  }

  // Wompi no soporta cambio de plan directo; se cancela y crea nueva
  // Con prorrateo: calcular días restantes y aplicar crédito
  const currentSub = await getSubscription(subscriptionId);
  
  if (prorate && currentSub?.status === 'ACTIVE') {
    // Calcular crédito prorrateado (lógica de negocio)
    const daysUsed = Math.ceil((Date.now() - new Date(currentSub.current_period_start).getTime()) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, 30 - daysUsed); // asumiendo mensual
    // TODO: Aplicar crédito como metadata para próxima factura
  }

  // Cancelar actual
  await cancelSubscription(subscriptionId, false);

  // Crear nueva (requiere payment_method_id de nuevo)
  // En la práctica, el frontend debe recolectar nuevo token
  throw new Error('Cambio de plan en Wompi requiere nuevo payment_method_id desde frontend');
}

/**
 * Obtiene una suscripción por ID
 */
async function getSubscription(subscriptionId) {
  if (!isConfigured()) return null;

  const response = await fetch(`${resolveWompiBaseUrl()}/subscriptions/${subscriptionId}`, {
    headers: _authHeaders()
  });

  if (!response.ok) return null;
  return await response.json();
}

/**
 * Cancela una suscripción en Wompi
 */
async function cancelSubscription(subscriptionId, atPeriodEnd = true) {
  if (!isConfigured()) {
    throw new Error('Wompi no configurado');
  }

  if (atPeriodEnd) {
    // Wompi: cancel_at_period_end no existe nativamente
    // Se marca en BD y job cancela al final del período
    // Aquí solo actualizamos metadata
    await fetch(`${resolveWompiBaseUrl()}/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: _authHeaders(),
      body: JSON.stringify({ metadata: { cancel_at_period_end: 'true' } })
    });
    return { id: subscriptionId, status: 'ACTIVE', cancel_at_period_end: true };
  } else {
    const response = await fetch(`${resolveWompiBaseUrl()}/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
      headers: _authHeaders()
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Wompi cancel subscription failed: ${response.status} ${JSON.stringify(error)}`);
    }

    return await response.json();
  }
}

/**
 * Verifica firma de webhook Wompi
 * Wompi envía header 'X-Wompi-Signature' con HMAC-SHA256
 */
function verifyWebhookSignature(payload, signature) {
  if (!WOMPI_INTEGRITY_SECRET) {
    console.warn('[wompiSubscriptionService] WOMPI_INTEGRITY_SECRET no configurado, omitiendo verificación');
    return true; // fail-open en dev
  }

  const expectedSignature = crypto
    .createHmac('sha256', WOMPI_INTEGRITY_SECRET)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Parsea evento webhook de Wompi
 */
function parseWebhookEvent(rawBody, signature) {
  if (!verifyWebhookSignature(rawBody, signature)) {
    throw new Error('Firma de webhook Wompi inválida');
  }
  return JSON.parse(rawBody);
}

/**
 * Crea link de pago único (para facturas one-off)
 */
async function createPaymentLink({ amountInCents, currency = 'COP', reference, customerEmail, redirectUrl }) {
  if (!isConfigured()) throw new Error('Wompi no configurado');

  const body = {
    amount_in_cents: amountInCents,
    currency,
    reference,
    customer_email: customerEmail,
    redirect_url: redirectUrl,
    payment_method: { installments: 1 }
  };

  const response = await fetch(`${resolveWompiBaseUrl()}/payment_links`, {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Wompi payment link failed: ${response.status} ${JSON.stringify(error)}`);
  }

  return await response.json();
}

module.exports = {
  isConfigured,
  createOrGetCustomer,
  createSubscription,
  changeSubscriptionPlan,
  getSubscription,
  cancelSubscription,
  verifyWebhookSignature,
  parseWebhookEvent,
  createPaymentLink,
  resolveWompiBaseUrl
};