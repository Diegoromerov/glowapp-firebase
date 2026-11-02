// backend/src/services/stripeService.js
const Stripe = require('stripe');

let stripeInstance = null;

function getStripe() {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY no configurado');
    }
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2024-06-20',
      typescript: false
    });
  }
  return stripeInstance;
}

/**
 * Verifica si Stripe está configurado
 */
function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Crea o recupera un customer en Stripe
 */
async function createOrGetCustomer({ email, metadata = {} }) {
  const stripe = getStripe();
  
  // Buscar por email primero
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) {
    return existing.data[0];
  }

  // Crear nuevo
  return await stripe.customers.create({
    email,
    metadata,
    invoice_settings: {
      default_payment_method: null
    }
  });
}

/**
 * Adjunta un payment method a un customer
 */
async function attachPaymentMethod(customerId, paymentMethodId) {
  const stripe = getStripe();
  
  await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  
  // Establecer como default
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId }
  });
}

/**
 * Crea una suscripción en Stripe
 */
async function createSubscription({ customerId, priceId, paymentMethodId, trialDays }) {
  const stripe = getStripe();
  
  const params = {
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent']
  };

  if (trialDays) {
    params.trial_period_days = trialDays;
  }

  if (paymentMethodId) {
    params.default_payment_method = paymentMethodId;
  }

  return await stripe.subscriptions.create(params);
}

/**
 * Cambia el plan de una suscripción (upgrade/downgrade)
 */
async function changeSubscriptionPlan({ subscriptionId, newPriceId, prorate = true }) {
  const stripe = getStripe();
  
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  
  return await stripe.subscriptions.update(subscriptionId, {
    items: [{
      id: subscription.items.data[0].id,
      price: newPriceId
    }],
    proration_behavior: prorate ? 'create_prorations' : 'none',
    expand: ['latest_invoice']
  });
}

/**
 * Cancela una suscripción
 */
async function cancelSubscription(subscriptionId, atPeriodEnd = true) {
  const stripe = getStripe();
  
  if (atPeriodEnd) {
    return await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    });
  } else {
    return await stripe.subscriptions.cancel(subscriptionId);
  }
}

/**
 * Crea una sesión de Checkout para suscripción
 */
async function createCheckoutSession({ customerId, priceId, successUrl, cancelUrl, trialDays, metadata = {} }) {
  const stripe = getStripe();
  
  const params = {
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
    subscription_data: {
      metadata
    }
  };

  if (trialDays) {
    params.subscription_data.trial_period_days = trialDays;
  }

  return await stripe.checkout.sessions.create(params);
}

/**
 * Crea una sesión del Portal de Cliente (billing management)
 */
async function createPortalSession({ customerId, returnUrl }) {
  const stripe = getStripe();
  
  return await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl
  });
}

/**
 * Verifica la firma de un webhook
 */
function verifyWebhookSignature(payload, signature, webhookSecret) {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

/**
 * Obtiene una factura por ID
 */
async function getInvoice(invoiceId) {
  const stripe = getStripe();
  return await stripe.invoices.retrieve(invoiceId);
}

/**
 * Lista suscripciones de un customer
 */
async function listSubscriptions(customerId, status = 'active') {
  const stripe = getStripe();
  return await stripe.subscriptions.list({ customer: customerId, status, limit: 10 });
}

module.exports = {
  getStripe,
  isConfigured,
  createOrGetCustomer,
  attachPaymentMethod,
  createSubscription,
  changeSubscriptionPlan,
  cancelSubscription,
  createCheckoutSession,
  createPortalSession,
  verifyWebhookSignature,
  getInvoice,
  listSubscriptions
};