const { wrapRouterAsync } = require('../utils/expressAsync');
// src/routes/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/jwt');
const analyticsController = require('../controllers/analyticsController');

const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (token) {
      const verified = jwt.verify(token, getJwtSecret());
      req.user = verified;
    }
  } catch (_) {}
  next();
};

// Log analytics event (telemetry)
router.post('/events', optionalAuth, analyticsController.logEvent);

wrapRouterAsync(router);
module.exports = router;
