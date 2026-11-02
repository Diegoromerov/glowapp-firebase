// backend/src/services/subscriptionService.js
const { pool } = require('../config/db');
const stripeService = require('./stripeService');
const wompiSubscriptionService = require('./wompiSubscriptionService');
const invoiceService = require('./invoiceService');
const { hasEntitlement } = require('../config/saasEntitlements');
const crypto = require('crypto');

class SubscriptionService {
  /**
   * Crea una suscripción para un tenant
   * @param {Object} params
   * @param {string} params.tenantId - business_profile_id
   * @param {string} params.plan - FREE_TRIAL, FREEMIUM, BASIC, PRO, ENTERPRISE
   * @param {string} params.currency - COP | USD (determina Stripe vs Wompi)
   * @param {string} params.paymentMethodId - opcional, para planes de pago
   * @param {string} params.customerEmail - email para facturación
   */
  async createSubscription({ tenantId, plan, currency = 'COP', paymentMethodId, customerEmail }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Verificar/crear customer en pasarela
      let gatewayCustomerId;
      let gatewaySubscriptionId;
      let status = 'trialing';
      let trialEnd = null;

      const isPaidPlan = ['BASIC', 'PRO', 'ENTERPRISE'].includes(plan);
      const trialDays = plan === 'FREE_TRIAL' ? 14 : (isPaidPlan ? 30 : null);

      if (currency === 'USD') {
        // Stripe para pagos internacionales
        const customer = await stripeService.createOrGetCustomer({
          email: customerEmail,
          metadata: { tenantId, plan }
        });
        gatewayCustomerId = customer.id;

        if (isPaidPlan && paymentMethodId) {
          await stripeService.attachPaymentMethod(customer.id, paymentMethodId);
          const sub = await stripeService.createSubscription({
            customerId: customer.id,
            priceId: this._getStripePriceId(plan),
            paymentMethodId,
            trialDays
          });
          gatewaySubscriptionId = sub.id;
          status = sub.status;
          trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
        } else if (trialDays) {
          const sub = await stripeService.createSubscription({
            customerId: customer.id,
            priceId: this._getStripePriceId(plan),
            trialDays
          });
          gatewaySubscriptionId = sub.id;
          status = sub.status;
          trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
        }
      } else {
        // Wompi para pagos Colombia (COP)
        const customer = await wompiSubscriptionService.createOrGetCustomer({
          email: customerEmail,
          metadata: { tenantId, plan }
        });
        gatewayCustomerId = customer.id;

        if (isPaidPlan && paymentMethodId) {
          const sub = await wompiSubscriptionService.createSubscription({
            customerId: customer.id,
            planId: this._getWompiPlanId(plan),
            paymentMethodId,
            trialDays
          });
          gatewaySubscriptionId = sub.id;
          status = sub.status;
          trialEnd = sub.trial_end ? new Date(sub.trial_end) : null;
        } else if (trialDays) {
          const sub = await wompiSubscriptionService.createSubscription({
            customerId: customer.id,
            planId: this._getWompiPlanId(plan),
            trialDays
          });
          gatewaySubscriptionId = sub.id;
          status = sub.status;
          trialEnd = sub.trial_end ? new Date(sub.trial_end) : null;
        }
      }

      // 2. Calcular fechas de período
      const now = new Date();
      const periodStart = now;
      let periodEnd = new Date(now);
      if (trialEnd) {
        periodEnd = trialEnd;
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1); // mensual por defecto
      }

      // 3. Guardar en BD
      const stripeField = currency === 'USD' ? 'stripe_subscription_id' : 'wompi_subscription_id';
      const customerField = currency === 'USD' ? 'stripe_customer_id' : 'wompi_customer_id';

      const insertQuery = `
        INSERT INTO subscriptions (
          tenant_id, ${stripeField}, ${customerField}, plan, status,
          current_period_start, current_period_end, trial_end, cancel_at_period_end, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (tenant_id) DO UPDATE SET
          ${stripeField} = EXCLUDED.${stripeField},
          ${customerField} = EXCLUDED.${customerField},
          plan = EXCLUDED.plan,
          status = EXCLUDED.status,
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          trial_end = EXCLUDED.trial_end,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
        RETURNING *;
      `;

      const metadata = {
        currency,
        gatewayCustomerId,
        createdVia: 'api'
      };

      const result = await client.query(insertQuery, [
        tenantId,
        gatewaySubscriptionId,
        gatewayCustomerId,
        plan,
        status,
        periodStart,
        periodEnd,
        trialEnd,
        false,
        JSON.stringify(metadata)
      ]);

      const subscription = result.rows[0];

      // 4. Sincronizar plan en business_profiles
      await this._syncPlanToTenant(client, tenantId, plan, status);

      // 5. Crear factura inicial si es plan de pago
      if (isPaidPlan) {
        await invoiceService.createInvoiceFromSubscription(client, subscription);
      }

      await client.query('COMMIT');
      return subscription;

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[subscriptionService] Error creating subscription:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cambia el plan de una suscripción (upgrade/downgrade)
   */
  async changePlan({ tenantId, newPlan, prorate = true }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Obtener suscripción actual
      const currentSub = await this.getActiveSubscription(tenantId);
      if (!currentSub) {
        throw new Error('No hay suscripción activa para este tenant');
      }

      const currency = currentSub.stripe_subscription_id ? 'USD' : 'COP';
      const isUpgrade = this._comparePlans(newPlan, currentSub.plan) > 0;

      // 1. Cambiar en pasarela
      let gatewaySubscription;
      if (currency === 'USD') {
        gatewaySubscription = await stripeService.changeSubscriptionPlan({
          subscriptionId: currentSub.stripe_subscription_id,
          newPriceId: this._getStripePriceId(newPlan),
          prorate
        });
      } else {
        gatewaySubscription = await wompiSubscriptionService.changeSubscriptionPlan({
          subscriptionId: currentSub.wompi_subscription_id,
          newPlanId: this._getWompiPlanId(newPlan),
          prorate
        });
      }

      // 2. Actualizar en BD
      const periodStart = new Date(gatewaySubscription.current_period_start * 1000);
      const periodEnd = new Date(gatewaySubscription.current_period_end * 1000);
      const status = gatewaySubscription.status;

      const updateQuery = `
        UPDATE subscriptions
        SET plan = $1, status = $2, current_period_start = $3, current_period_end = $4,
            updated_at = NOW(), metadata = metadata || $5::jsonb
        WHERE tenant_id = $6
        RETURNING *;
      `;

      const metadata = { prorated: prorate, changedAt: new Date().toISOString() };

      const result = await client.query(updateQuery, [
        newPlan, status, periodStart, periodEnd, JSON.stringify(metadata), tenantId
      ]);

      const subscription = result.rows[0];

      // 3. Sincronizar plan
      await this._syncPlanToTenant(client, tenantId, newPlan, status);

      // 4. Si hubo prorrateo, crear factura de ajuste
      if (prorate && isUpgrade) {
        await invoiceService.createProrationInvoice(client, subscription, currentSub.plan, newPlan);
      }

      await client.query('COMMIT');
      return subscription;

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[subscriptionService] Error changing plan:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cancela suscripción (inmediata o fin de período)
   */
  async cancelSubscription({ tenantId, atPeriodEnd = true }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const currentSub = await this.getActiveSubscription(tenantId);
      if (!currentSub) {
        throw new Error('No hay suscripción activa');
      }

      const currency = currentSub.stripe_subscription_id ? 'USD' : 'COP';

      // 1. Cancelar en pasarela
      if (currency === 'USD') {
        await stripeService.cancelSubscription(currentSub.stripe_subscription_id, atPeriodEnd);
      } else {
        await wompiSubscriptionService.cancelSubscription(currentSub.wompi_subscription_id, atPeriodEnd);
      }

      // 2. Actualizar en BD
      const updateQuery = atPeriodEnd
        ? `UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = NOW() WHERE tenant_id = $1 RETURNING *;`
        : `UPDATE subscriptions SET status = 'canceled', canceled_at = NOW(), updated_at = NOW() WHERE tenant_id = $1 RETURNING *;`;

      const result = await client.query(updateQuery, [tenantId]);
      const subscription = result.rows[0];

      // 3. Si cancelación inmediata, bajar a FREEMIUM
      if (!atPeriodEnd) {
        await this._syncPlanToTenant(client, tenantId, 'FREEMIUM', 'canceled');
      }

      await client.query('COMMIT');
      return subscription;

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[subscriptionService] Error canceling subscription:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Obtiene suscripción activa del tenant
   */
  async getActiveSubscription(tenantId) {
    const query = `
      SELECT * FROM subscriptions
      WHERE tenant_id = $1
        AND status IN ('trialing', 'active', 'past_due')
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [tenantId]);
    return rows[0] || null;
  }

  /**
   * Sincroniza plan en business_profiles
   */
  async _syncPlanToTenant(client, tenantId, plan, status) {
    const effectivePlan = status === 'canceled' || status === 'incomplete_expired' 
      ? 'FREEMIUM' 
      : plan;

    await client.query(
      `UPDATE business_profiles SET saas_plan = $1, updated_at = NOW() WHERE id = $2`,
      [effectivePlan, tenantId]
    );
  }

  /**
   * Handler webhook Stripe (idempotencia por event_id)
   */
  async handleStripeWebhook(event) {
    // Verificar idempotencia
    const eventHash = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
    const { rows: existing } = await pool.query(
      'SELECT 1 FROM webhook_events WHERE provider = $1 AND event_id = $2',
      ['stripe', event.id]
    );
    if (existing.length > 0) {
      console.log('[subscriptionService] Webhook Stripe ya procesado:', event.id);
      return { received: true, duplicate: true };
    }

    try {
      switch (event.type) {
        case 'invoice.paid':
          await this._handleInvoicePaid(event.data.object, 'stripe');
          break;
        case 'invoice.payment_failed':
          await this._handlePaymentFailed(event.data.object, 'stripe');
          break;
        case 'customer.subscription.updated':
          await this._handleSubscriptionUpdated(event.data.object, 'stripe');
          break;
        case 'customer.subscription.deleted':
          await this._handleSubscriptionDeleted(event.data.object, 'stripe');
          break;
        case 'customer.subscription.trial_will_end':
          await this._handleTrialEnding(event.data.object, 'stripe');
          break;
      }

      // Registrar evento procesado
      await pool.query(
        `INSERT INTO webhook_events (provider, event_id, event_type, payload_hash, result)
         VALUES ($1, $2, $3, $4, $5)`,
        ['stripe', event.id, event.type, eventHash, JSON.stringify({ processed: true })]
      );

      return { received: true };
    } catch (error) {
      console.error('[subscriptionService] Error procesando webhook Stripe:', error.message);
      await pool.query(
        `INSERT INTO webhook_events (provider, event_id, event_type, payload_hash, error_message)
         VALUES ($1, $2, $3, $4, $5)`,
        ['stripe', event.id, event.type, eventHash, error.message]
      );
      throw error;
    }
  }

  /**
   * Handler webhook Wompi
   */
  async handleWompiWebhook(event) {
    const eventHash = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
    const { rows: existing } = await pool.query(
      'SELECT 1 FROM webhook_events WHERE provider = $1 AND event_id = $2',
      ['wompi', event.id]
    );
    if (existing.length > 0) {
      return { received: true, duplicate: true };
    }

    try {
      // Wompi usa eventos diferentes, mapear a lógica común
      if (event.type === 'subscription.charge.succeeded') {
        await this._handleInvoicePaid(event.data, 'wompi');
      } else if (event.type === 'subscription.charge.failed') {
        await this._handlePaymentFailed(event.data, 'wompi');
      } else if (event.type === 'subscription.updated') {
        await this._handleSubscriptionUpdated(event.data, 'wompi');
      } else if (event.type === 'subscription.cancelled') {
        await this._handleSubscriptionDeleted(event.data, 'wompi');
      }

      await pool.query(
        `INSERT INTO webhook_events (provider, event_id, event_type, payload_hash, result)
         VALUES ($1, $2, $3, $4, $5)`,
        ['wompi', event.id, event.type, eventHash, JSON.stringify({ processed: true })]
      );

      return { received: true };
    } catch (error) {
      console.error('[subscriptionService] Error procesando webhook Wompi:', error.message);
      await pool.query(
        `INSERT INTO webhook_events (provider, event_id, event_type, payload_hash, error_message)
         VALUES ($1, $2, $3, $4, $5)`,
        ['wompi', event.id, event.type, eventHash, error.message]
      );
      throw error;
    }
  }

  // --- Handlers internos ---

  async _handleInvoicePaid(invoice, provider) {
    const subscriptionId = invoice.subscription || invoice.subscription_id;
    if (!subscriptionId) return;

    const field = provider === 'stripe' ? 'stripe_subscription_id' : 'wompi_subscription_id';
    const customerField = provider === 'stripe' ? 'stripe_customer_id' : 'wompi_customer_id';

    // Actualizar status a active
    await pool.query(
      `UPDATE subscriptions SET status = 'active', updated_at = NOW() WHERE ${field} = $1`,
      [subscriptionId]
    );

    // Crear factura en BD
    const { rows } = await pool.query(
      `SELECT * FROM subscriptions WHERE ${field} = $1`, [subscriptionId]
    );
    if (rows.length > 0) {
      await invoiceService.createInvoiceFromSubscription(null, rows[0], invoice);
    }
  }

  async _handlePaymentFailed(invoice, provider) {
    const subscriptionId = invoice.subscription || invoice.subscription_id;
    if (!subscriptionId) return;

    const field = provider === 'stripe' ? 'stripe_subscription_id' : 'wompi_subscription_id';
    await pool.query(
      `UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE ${field} = $1`,
      [subscriptionId]
    );
  }

  async _handleSubscriptionUpdated(subscription, provider) {
    const field = provider === 'stripe' ? 'stripe_subscription_id' : 'wompi_subscription_id';
    const status = subscription.status;
    const periodStart = new Date(subscription.current_period_start * 1000);
    const periodEnd = new Date(subscription.current_period_end * 1000);
    const cancelAtPeriodEnd = subscription.cancel_at_period_end;

    await pool.query(
      `UPDATE subscriptions 
       SET status = $1, current_period_start = $2, current_period_end = $3, 
           cancel_at_period_end = $4, updated_at = NOW()
       WHERE ${field} = $5`,
      [status, periodStart, periodEnd, cancelAtPeriodEnd, subscription.id]
    );

    // Sincronizar plan si cambió
    const priceId = subscription.items?.data?.[0]?.price?.id || subscription.plan_id;
    const plan = this._mapPriceIdToPlan(priceId, provider);
    if (plan) {
      const { rows } = await pool.query(
        `SELECT tenant_id FROM subscriptions WHERE ${field} = $1`, [subscription.id]
      );
      if (rows.length > 0) {
        await this._syncPlanToTenant(await pool.connect(), rows[0].tenant_id, plan, status);
      }
    }
  }

  async _handleSubscriptionDeleted(subscription, provider) {
    const field = provider === 'stripe' ? 'stripe_subscription_id' : 'wompi_subscription_id';
    await pool.query(
      `UPDATE subscriptions SET status = 'canceled', canceled_at = NOW(), updated_at = NOW() WHERE ${field} = $1`,
      [subscription.id]
    );

    const { rows } = await pool.query(
      `SELECT tenant_id FROM subscriptions WHERE ${field} = $1`, [subscription.id]
    );
    if (rows.length > 0) {
      await this._syncPlanToTenant(await pool.connect(), rows[0].tenant_id, 'FREEMIUM', 'canceled');
    }
  }

  async _handleTrialEnding(subscription, provider) {
    const field = provider === 'stripe' ? 'stripe_subscription_id' : 'wompi_subscription_id';
    const { rows } = await pool.query(
      `SELECT tenant_id FROM subscriptions WHERE ${field} = $1`, [subscription.id]
    );
    if (rows.length > 0) {
      // TODO: Enviar email "tu trial termina en 3 días" (integra con email.service.js)
      console.log('[subscriptionService] Trial ending for tenant:', rows[0].tenant_id);
    }
  }

  // --- Helpers de mapeo precios ---

  _getStripePriceId(plan) {
    const prices = {
      FREE_TRIAL: process.env.STRIPE_PRICE_FREE_TRIAL || 'price_free_trial',
      FREEMIUM: process.env.STRIPE_PRICE_FREEMIUM || 'price_freemium',
      BASIC: process.env.STRIPE_PRICE_BASIC || 'price_basic_monthly',
      PRO: process.env.STRIPE_PRICE_PRO || 'price_pro_monthly',
      ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise_monthly'
    };
    return prices[plan] || prices.FREEMIUM;
  }

  _getWompiPlanId(plan) {
    const plans = {
      FREE_TRIAL: process.env.WOMPI_PLAN_FREE_TRIAL || 'plan_free_trial',
      FREEMIUM: process.env.WOMPI_PLAN_FREEMIUM || 'plan_freemium',
      BASIC: process.env.WOMPI_PLAN_BASIC || 'plan_basic_monthly',
      PRO: process.env.WOMPI_PLAN_PRO || 'plan_pro_monthly',
      ENTERPRISE: process.env.WOMPI_PLAN_ENTERPRISE || 'plan_enterprise_monthly'
    };
    return plans[plan] || plans.FREEMIUM;
  }

  _mapPriceIdToPlan(priceId, provider) {
    // Inverso de los métodos arriba - simplificado
    const plans = ['ENTERPRISE', 'PRO', 'BASIC', 'FREEMIUM', 'FREE_TRIAL'];
    return plans.find(p => {
      const id = provider === 'stripe' ? this._getStripePriceId(p) : this._getWompiPlanId(p);
      return priceId?.includes(id.replace('price_', '').replace('plan_', ''));
    }) || null;
  }

  _comparePlans(planA, planB) {
    const order = { FREE_TRIAL: 0, FREEMIUM: 1, BASIC: 2, PRO: 3, ENTERPRISE: 4 };
    return (order[planA] || 0) - (order[planB] || 0);
  }
}

module.exports = new SubscriptionService();