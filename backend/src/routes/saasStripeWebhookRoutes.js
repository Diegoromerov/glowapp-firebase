const express = require('express');
const stripeService = require('../services/stripeService');
const subscriptionService = require('../services/subscriptionService');

const router = express.Router();

router.post('/', async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Stripe SaaS webhook no configurado' });
  if (!Buffer.isBuffer(req.rawBody)) {
    return res.status(400).json({ error: 'Falta el cuerpo original requerido para verificar la firma' });
  }

  let event;
  try {
    event = stripeService.verifyWebhookSignature(
      req.rawBody,
      req.headers['stripe-signature'],
      secret
    );
  } catch (error) {
    return res.status(400).json({ error: 'Firma de Stripe inválida' });
  }

  try {
    const result = await subscriptionService.handleStripeWebhook(event);
    return res.json(result);
  } catch (error) {
    console.error('[saasStripeWebhookRoutes] Stripe event processing failed:', error.message);
    return res.status(500).json({ error: 'No se pudo procesar el evento; Stripe puede reintentarlo' });
  }
});

module.exports = router;
