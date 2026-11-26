// backend/src/routes/saasBillingRoutes.js
const express = require('express');
const { pool } = require('../config/db');
const saasContext = require('../middleware/saasContext');
const { requireEntitlement, requireOwner } = require('../middleware/featureGate');
const { authMiddleware } = require('../middleware/auth');
const subscriptionService = require('../services/subscriptionService');
const invoiceService = require('../services/invoiceService');
const stripeService = require('../services/stripeService');
const { PLAN_CATALOG, PLAN_IDS } = require('../config/saasCatalog');
const wompiSaasBilling = require('../services/wompiSaasBillingService');

const router = express.Router();

router.use(authMiddleware);
router.use(saasContext);

/**
 * GET /api/saas/billing
 * Resumen de facturación del tenant
 */
router.get('/', async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const tenantId = req.saas.tenantId;

    // Suscripción actual
    const subscription = await subscriptionService.getActiveSubscription(tenantId);
    const stripeConfigured = stripeService.isConfigured();
    const paymentProvider = subscription?.billing_provider || (subscription?.stripe_subscription_id
      ? 'stripe'
      : subscription?.wompi_subscription_id ? 'wompi' : null);

    // Facturas recientes
    const invoices = await invoiceService.getInvoicesByTenant(tenantId, { limit: 10 });

    // Próximo pago
    let nextPayment = null;
    if (subscription && subscription.status === 'active') {
      nextPayment = {
        amount: subscription.plan !== 'FREEMIUM' && subscription.plan !== 'FREE_TRIAL' 
          ? invoiceService.getPlanPrice(subscription.plan, subscription.currency || 'COP')
          : 0,
        date: subscription.current_period_end,
        plan: subscription.plan,
        currency: subscription.currency || 'COP'
      };
    }

    res.json({
      tenantId,
      tenantName: req.saas.name,
      currentPlan: req.saas.plan,
      checkoutAvailable: wompiSaasBilling.isCheckoutAvailable(),
      subscription: subscription ? {
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        periodStart: subscription.current_period_start,
        periodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currency: subscription.currency || 'COP',
        paymentProvider,
        canManagePayments: Boolean(stripeConfigured && subscription.stripe_customer_id),
        canCancel: Boolean((stripeConfigured && subscription.stripe_subscription_id) || subscription.billing_provider === 'wompi')
      } : null,
      nextPayment,
      recentInvoices: invoices.map(inv => ({
        id: inv.id,
        number: inv.invoice_number,
        pdfUrl: `/api/saas/billing/invoices/${encodeURIComponent(inv.id)}/pdf`,
        status: inv.status,
        total: inv.total,
        currency: inv.currency,
        periodStart: inv.period_start,
        periodEnd: inv.period_end,
        dueDate: inv.due_date,
        paidAt: inv.paid_at,
        createdAt: inv.created_at
      }))
    });
  } catch (error) {
    console.error('[saasBillingRoutes] Error getting billing summary:', error.message);
    res.status(500).json({ error: 'Error obteniendo resumen de facturación' });
  }
});

/**
 * GET /api/saas/billing/invoices
 * Lista paginada de facturas
 */
router.get('/invoices', async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status;

    const invoices = await invoiceService.getInvoicesByTenant(req.saas.tenantId, { limit, offset, status });

    res.json({
      tenantId: req.saas.tenantId,
      invoices: invoices.map(inv => ({
        id: inv.id,
        number: inv.invoice_number,
        pdfUrl: `/api/saas/billing/invoices/${encodeURIComponent(inv.id)}/pdf`,
        status: inv.status,
        currency: inv.currency,
        subtotal: inv.subtotal,
        tax: inv.tax,
        total: inv.total,
        amountPaid: inv.amount_paid,
        periodStart: inv.period_start,
        periodEnd: inv.period_end,
        dueDate: inv.due_date,
        paidAt: inv.paid_at,
        createdAt: inv.created_at,
        items: typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items
      })),
      pagination: { limit, offset }
    });
  } catch (error) {
    console.error('[saasBillingRoutes] Error listing invoices:', error.message);
    res.status(500).json({ error: 'Error listando facturas' });
  }
});

/**
 * GET /api/saas/billing/invoices/:invoiceId
 * Detalle de factura + link descarga PDF
 */
router.get('/invoices/:invoiceId', async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { rows } = await pool.query(
      `SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2`,
      [req.params.invoiceId, req.saas.tenantId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    const inv = rows[0];

    res.json({
      invoice: {
        id: inv.id,
        number: inv.invoice_number,
        pdfUrl: `/api/saas/billing/invoices/${encodeURIComponent(inv.id)}/pdf`,
        status: inv.status,
        currency: inv.currency,
        subtotal: inv.subtotal,
        tax: inv.tax,
        total: inv.total,
        amountPaid: inv.amount_paid,
        periodStart: inv.period_start,
        periodEnd: inv.period_end,
        dueDate: inv.due_date,
        paidAt: inv.paid_at,
        billingName: inv.billing_name,
        billingEmail: inv.billing_email,
        billingAddress: inv.billing_address,
        billingTaxId: inv.billing_tax_id,
        items: typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items,
        metadata: inv.metadata,
        createdAt: inv.created_at,
        updatedAt: inv.updated_at,
        pdfUrl: `/api/saas/billing/invoices/${encodeURIComponent(inv.id)}/pdf`
      }
    });
  } catch (error) {
    console.error('[saasBillingRoutes] Error getting invoice:', error.message);
    res.status(500).json({ error: 'Error obteniendo factura' });
  }
});

/**
 * GET /api/saas/billing/invoices/:invoiceId/pdf
 * Descarga PDF de factura
 */
router.get('/invoices/:invoiceId/pdf', async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { rows } = await pool.query(
      `SELECT invoice_number FROM invoices WHERE id = $1 AND tenant_id = $2`,
      [req.params.invoiceId, req.saas.tenantId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    const invoiceNumber = rows[0].invoice_number;
    const document = await invoiceService.getInvoiceDocument(req.saas.tenantId, invoiceNumber);
    if (!document) return res.status(404).json({ error: 'Comprobante de cobro no encontrado' });

    res.setHeader('Content-Type', document.contentType);
    res.setHeader(
      'Content-Disposition',
      `${document.contentType === 'application/pdf' ? 'inline' : 'attachment'}; filename="${invoiceNumber}.${document.extension}"`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(document.buffer);
  } catch (error) {
    console.error('[saasBillingRoutes] Error downloading PDF:', error.message);
    res.status(500).json({ error: 'Error descargando factura' });
  }
});

/**
 * POST /api/saas/billing/checkout
 * Crea sesión de Checkout (Stripe) o Payment Link (Wompi) para upgrade
 * Requiere: OWNER
 */
router.post('/checkout', requireOwner, async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { plan, currency = 'COP', successUrl, cancelUrl } = req.body;

    const validPlans = PLAN_IDS.filter((id) => PLAN_CATALOG[id].priceCop > 0 && PLAN_CATALOG[id].commerciallyAvailable !== false);
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido', validPlans });
    }

    if (currency === 'COP') {
      if (!wompiSaasBilling.isCheckoutAvailable()) {
        return res.status(503).json({ error: 'El checkout Wompi está deshabilitado para esta cuenta.' });
      }
      const result = await wompiSaasBilling.startCheckout(pool, {
        tenantId: req.saas.tenantId,
        userId: req.user.id,
        userEmail: req.user.email,
        plan,
        paymentToken: req.body.paymentToken,
        acceptRecurring: req.body.acceptRecurring === true,
        acceptTerms: req.body.acceptTerms === true,
        acceptPersonalData: req.body.acceptPersonalData === true,
        ip: req.ip,
      });
      return res.status(202).json({ provider: 'wompi', ...result });
    }

    // Wompi SaaS links are one-off payments and have no verified activation
    // handler yet. Do not create a charge that the subscription system cannot
    // reconcile. Stripe checkout is available only with its signed webhook.
    if (currency !== 'USD') {
      return res.status(503).json({
        error: 'El checkout SaaS en COP está temporalmente deshabilitado hasta completar la conciliación segura de Wompi.'
      });
    }
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'La facturación Stripe aún no está configurada para confirmar pagos de forma segura.' });
    }
    if (!stripeService.isConfigured()) {
      return res.status(503).json({ error: 'La pasarela Stripe no está configurada.' });
    }
    const configuredPriceId = subscriptionService._getStripePriceId(plan);
    if (!configuredPriceId || !/^price_[A-Za-z0-9]+$/.test(configuredPriceId)) {
      return res.status(503).json({ error: 'El precio del plan aún no está configurado en Stripe.' });
    }

    // Verificar que es upgrade (no downgrade por checkout)
    const currentSub = await subscriptionService.getActiveSubscription(req.saas.tenantId);
    if (currentSub) {
      const order = PLAN_IDS;
      if (order.indexOf(plan) <= order.indexOf(currentSub.plan)) {
        return res.status(400).json({ 
          error: 'Use change-plan para downgrades', 
          currentPlan: currentSub.plan 
        });
      }
    }

    const tenant = await pool.query(
      `SELECT bp.*, u.email FROM business_profiles bp LEFT JOIN usuarios u ON u.id = bp.provider_id WHERE bp.id = $1`,
      [req.saas.tenantId]
    );

    if (tenant.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    const ownerEmail = tenant.rows[0].email;

    if (currency === 'USD') {
      // Stripe Checkout
      const customer = await stripeService.createOrGetCustomer({
        email: ownerEmail,
        metadata: { tenantId: req.saas.tenantId, plan }
      });

      const priceId = subscriptionService._getStripePriceId(plan);
      const session = await stripeService.createCheckoutSession({
        customerId: customer.id,
        priceId,
        successUrl: successUrl || `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: cancelUrl || `${process.env.FRONTEND_URL}/billing?canceled=true`,
        trialDays: 0,
        metadata: { tenantId: req.saas.tenantId, plan }
      });

      return res.json({
        provider: 'stripe',
        checkoutUrl: session.url,
        sessionId: session.id
      });
    }
  } catch (error) {
    console.error('[saasBillingRoutes] Error creating checkout:', error.message);
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
      ? error.status : 500;
    const body = {
      error: status === 500 ? 'Error creando checkout' : error.message,
    };
    // A timeout can mean Wompi accepted the request but its response was lost.
    // Return the durable reference/status so the UI can guide reconciliation
    // instead of encouraging a blind second charge.
    if (error.attempt) {
      body.attempt = error.attempt;
      body.error = `${body.error} Referencia ${error.attempt.reference} · estado ${error.attempt.status}. No vuelvas a pagar hasta que se concilie.`;
    }
    return res.status(status).json(body);
  }
});

router.get('/wompi/acceptance', requireOwner, async (_req, res) => {
  try {
    if (!wompiSaasBilling.isEnabled()) return res.status(503).json({ error: 'El checkout Wompi no está habilitado.' });
    const tokens = await require('../services/wompiClient').getAcceptanceTokens();
    return res.json({
      acceptanceToken: tokens.acceptanceToken,
      personalDataAuthToken: tokens.personalDataAuthToken,
      termsUrl: tokens.permalink,
      personalDataUrl: tokens.personalDataAuthPermalink,
      consentVersion: wompiSaasBilling.CONSENT_VERSION,
    });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.message });
  }
});

/**
 * POST /api/saas/billing/portal
 * Crea sesión del Portal de Cliente (Stripe Billing Portal)
 * Requiere: OWNER
 */
router.post('/portal', requireOwner, async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const currentSub = await subscriptionService.getActiveSubscription(req.saas.tenantId);
    if (!currentSub?.stripe_customer_id) {
      return res.status(400).json({ error: 'No hay customer Stripe configurado para este tenant' });
    }
    if (!stripeService.isConfigured()) {
      return res.status(503).json({ error: 'El portal de pagos no está disponible mientras Stripe no esté configurado.' });
    }

    const session = await stripeService.createPortalSession({
      customerId: currentSub.stripe_customer_id,
      returnUrl: req.body.returnUrl || `${process.env.FRONTEND_URL}/billing`
    });

    res.json({ portalUrl: session.url });
  } catch (error) {
    console.error('[saasBillingRoutes] Error creating portal:', error.message);
    res.status(500).json({ error: 'Error creando portal de facturación' });
  }
});

/**
 * POST /api/saas/billing/change-plan
 * Cambia plan (upgrade/downgrade) via subscriptionService
 * Requiere: OWNER
 */
router.post('/change-plan', requireOwner, async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { plan, prorate = true } = req.body;
    const validPlans = PLAN_IDS.filter((id) => id !== 'FREE_TRIAL' && PLAN_CATALOG[id].commerciallyAvailable !== false);
    
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido', validPlans });
    }

    // Direct plan mutation can grant access before an invoice is paid; Wompi's
    // legacy implementation also canceled the current subscription before
    // failing. Until a paid plan-change workflow exists, fail closed.
    return res.status(409).json({
      error: 'Los cambios de plan deben completarse mediante checkout y confirmarse por webhook de pago. Esta operación no está habilitada todavía.'
    });
  } catch (error) {
    console.error('[saasBillingRoutes] Error changing plan:', error.message);
    res.status(500).json({ error: error.message || 'Error cambiando plan' });
  }
});

/**
 * POST /api/saas/billing/cancel
 * Cancela suscripción
 * Requiere: OWNER
 */
router.post('/cancel', requireOwner, async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { atPeriodEnd = true } = req.body;

    const currentSub = await subscriptionService.getActiveSubscription(req.saas.tenantId);
    if (currentSub?.billing_provider === 'wompi') {
      const subscription = await wompiSaasBilling.cancelSubscription(pool, req.saas.tenantId, atPeriodEnd === true);
      if (!subscription) return res.status(404).json({ error: 'No hay una suscripción Wompi activa para cancelar.' });
      if (!atPeriodEnd) {
        await pool.query(`UPDATE business_profiles SET saas_plan='FREEMIUM',updated_at=NOW() WHERE id=$1`, [req.saas.tenantId]);
      }
      return res.json({ message: atPeriodEnd ? 'La suscripción finalizará al término del período pagado.' : 'La suscripción se canceló inmediatamente.', subscription });
    }
    if (!currentSub?.stripe_subscription_id) {
      return res.status(409).json({ error: 'No hay una suscripción con un proveedor de pago compatible para cancelar.' });
    }
    if (!stripeService.isConfigured()) {
      return res.status(503).json({ error: 'La cancelación de Stripe no está disponible mientras la pasarela no esté configurada.' });
    }

    const subscription = await subscriptionService.cancelSubscription({
      tenantId: req.saas.tenantId,
      atPeriodEnd
    });

    res.json({ message: atPeriodEnd ? 'Suscripción cancelada al final del período' : 'Suscripción cancelada inmediatamente', subscription });
  } catch (error) {
    console.error('[saasBillingRoutes] Error canceling subscription:', error.message);
    res.status(500).json({ error: error.message || 'Error cancelando suscripción' });
  }
});

/**
 * GET /api/saas/billing/payment-methods
 * Métodos de pago guardados (Stripe)
 */
router.get('/payment-methods', async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const currentSub = await subscriptionService.getActiveSubscription(req.saas.tenantId);
    if (currentSub?.billing_provider === 'wompi') {
      return res.json({ paymentMethods: currentSub.wompi_payment_source_type ? [{
        id: 'saved-card', type: 'CARD', card: { brand: currentSub.wompi_card_brand || null, last4: currentSub.wompi_card_last_four || null }, isDefault: true,
      }] : [] });
    }
    if (!currentSub?.stripe_customer_id || !stripeService.isConfigured()) {
      return res.json({ paymentMethods: [] });
    }

    const paymentMethods = await stripeService.getStripe().paymentMethods.list({
      customer: currentSub.stripe_customer_id,
      type: 'card'
    });

    res.json({
      paymentMethods: paymentMethods.data.map(pm => ({
        id: pm.id,
        type: pm.type,
        card: pm.card ? {
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year
        } : null,
        isDefault: false // TODO: verificar default
      }))
    });
  } catch (error) {
    console.error('[saasBillingRoutes] Error getting payment methods:', error.message);
    res.status(500).json({ error: 'Error obteniendo métodos de pago' });
  }
});

module.exports = router;
