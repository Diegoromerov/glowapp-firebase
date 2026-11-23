const express = require('express');
const { publicCatalog, PLAN_CATALOG, serializePlan } = require('../config/saasCatalog');

const router = express.Router();

// Público para onboarding y comparación comercial; no revela datos de tenants.
router.get('/', (_req, res) => res.json(publicCatalog()));

router.get('/:planId', (req, res) => {
  const planId = String(req.params.planId || '').toUpperCase();
  if (!PLAN_CATALOG[planId]) return res.status(404).json({ error: 'Plan no encontrado' });
  return res.json({ version: 1, plan: serializePlan(planId) });
});

module.exports = router;
