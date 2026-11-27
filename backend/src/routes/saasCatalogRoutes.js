const express = require('express');
const { publicCatalog, PLAN_CATALOG, serializePlan } = require('../config/saasCatalog');
const wompiSaasBilling = require('../services/wompiSaasBillingService');

const router = express.Router();

function sendCatalog(res, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ...payload, checkoutAvailable: wompiSaasBilling.isCheckoutAvailable() });
}

// Público para onboarding y comparación comercial; no revela datos de tenants.
router.get('/', (_req, res) => sendCatalog(res, publicCatalog()));

router.get('/:planId', (req, res) => {
  const planId = String(req.params.planId || '').toUpperCase();
  if (!PLAN_CATALOG[planId] || PLAN_CATALOG[planId].publiclyListed === false) {
    return res.status(404).json({ error: 'Plan no encontrado' });
  }
  return sendCatalog(res, { version: publicCatalog().version, plan: serializePlan(planId) });
});

module.exports = router;
