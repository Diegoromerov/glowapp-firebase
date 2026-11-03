// backend/src/routes/saasBillingRoutes.js
const express = require('express');
const { pool } = require('../config/db');
const saasContext = require('../middleware/saasContext');
const { requireEntitlement, requireOwner } = require('../middleware/featureGate');
const { authMiddleware } = require('../middleware/auth');
const subscriptionService = require('../services/subscriptionService');
const invoiceService = require('../services/invoiceService');
const stripeService = require('../services/stripeService');
const wompiSubscriptionService = require('../services/wompiSubscriptionService');

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
      subscription: subscription ? {
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        periodStart: subscription.current_period_start,
        periodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currency: subscription.currency || 'COP'
      } : null,
      nextPayment,
      recentInvoices: invoices.map(inv => ({
        id: inv.id,
        number: inv.invoice_number,
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
    const pdfPath = `invoices/${inv.invoice_number}.pdf`;

    res.json({
      invoice: {
        id: inv.id,
        number: inv.invoice_number,
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
        pdfUrl: `/api/saas/billing/invoices/${inv.id}/pdf`
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
    const fs = require('fs');
    const path = require('path');
    const pdfPath = path.join(__dirname, '../../invoices', `${invoiceNumber}.pdf`);
    const htmlPath = path.join(__dirname, '../../invoices', `${invoiceNumber}.html`);

    if (fs.existsSync(pdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${invoiceNumber}.pdf"`);
      return res.sendFile(pdfPath);
    }

    if (fs.existsSync(htmlPath)) {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `inline; filename="${invoiceNumber}.html"`);
      return res.sendFile(htmlPath);
    }

    return res.status(404).json({ error: 'Archivo de factura no encontrado' });
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

    const validPlans = ['BASIC', 'PRO', 'ENTERPRISE'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido', validPlans });
    }

    // Verificar que es upgrade (no downgrade por checkout)
    const currentSub = await subscriptionService.getActiveSubscription(req.saas.tenantId);
    if (currentSub) {
      const order = { FREE_TRIAL: 0, FREEMIUM: 1, BASIC: 2, PRO: 3, ENTERPRISE: 4 };
      if ((order[plan] || 0) <= (order[currentSub.plan] || 0)) {
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

    if (currency === 'USD' && stripeService.isConfigured()) {
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
    } else {
      // Wompi Payment Link (pago único) - para suscripciones usar widget en frontend
      const amount = invoiceService.getPlanPrice(plan, 'COP');
      const reference = `sub_${req.saas.tenantId}_${plan}_${Date.now()}`;

      const paymentLink = await wompiSubscriptionService.createPaymentLink({
        amountInCents: amount * 100,
        currency: 'COP',
        reference,
        customerEmail: ownerEmail,
        redirectUrl: successUrl || `${process.env.FRONTEND_URL}/billing/success?ref=${reference}`
      });

      return res.json({
        provider: 'wompi',
        checkoutUrl: paymentLink.data?.checkout_url || paymentLink.checkout_url,
        paymentLinkId: paymentLink.data?.id || paymentLink.id,
        reference
      });
    }
  } catch (error) {
    console.error('[saasBillingRoutes] Error creating checkout:', error.message);
    res.status(500).json({ error: 'Error creando checkout', detail: error.message });
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
    const validPlans = ['FREEMIUM', 'BASIC', 'PRO', 'ENTERPRISE'];
    
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido', validPlans });
    }

    const subscription = await subscriptionService.changePlan({
      tenantId: req.saas.tenantId,
      newPlan: plan,
      prorate
    });

    res.json({ message: 'Plan cambiado', subscription });
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
    if (!currentSub?.stripe_customer_id) {
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