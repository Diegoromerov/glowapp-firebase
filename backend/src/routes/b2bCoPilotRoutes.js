const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/b2bCoPilotRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const b2bCoPilotService = require('../services/b2bCoPilotService');

// POST /api/b2b/auto-reply-review → Auto-respuesta a reseñas
router.post('/b2b/auto-reply-review', authMiddleware, async (req, res) => {
  try {
    const { rating, reviewText, clientName } = req.body;
    const result = await b2bCoPilotService.generateReviewAutoReply({ rating, reviewText, clientName });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/b2b/dynamic-pricing → Aplicar precios dinámicos
router.post('/api/b2b/dynamic-pricing', authMiddleware, async (req, res) => {
  try {
    const { providerId, serviceId, discountPercentage } = req.body;
    const result = await b2bCoPilotService.updateDynamicPricingRules({ providerId, serviceId, discountPercentage });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

wrapRouterAsync(router);
module.exports = router;
