const { wrapRouterAsync } = require('../utils/expressAsync');
// src/routes/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const analyticsController = require('../controllers/analyticsController');

// Log analytics event (telemetry)
router.post('/events', authMiddleware, analyticsController.logEvent);

wrapRouterAsync(router);
module.exports = router;
