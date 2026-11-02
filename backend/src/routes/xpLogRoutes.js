const { wrapRouterAsync } = require('../utils/expressAsync');
// src/routes/xpLogRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const xpLogController = require('../controllers/xpLogController');
const Joi = require('joi');

// Auditoría 2026-09-22 (B19): el esquema de la tabla es (user_id, xp_amount, reason).
// Este validador exigía `points`/`description`, que no existen: la ruta rechazaba
// (400) la petición correcta y aceptaba la que después fallaba en la base de datos.
// Se acepta `points` como alias heredado para no romper clientes antiguos.
const xpLogSchema = Joi.object({
  xp_amount: Joi.number().integer().required(),
  reason: Joi.string().max(255).allow('', null).optional(),
  metadata: Joi.object().optional(),
}).unknown(true);

// Middleware to validate request body against a Joi schema
function validate(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    next();
  };
}

// Normaliza el alias heredado `points` -> `xp_amount` antes de validar
function normalizeXpPayload(req, res, next) {
  if (req.body && req.body.xp_amount === undefined && req.body.points !== undefined) {
    req.body.xp_amount = req.body.points;
  }
  next();
}

// Get XP logs for the authenticated user
router.get('/', authMiddleware, xpLogController.getLogs);

// Create a new XP log entry
router.post('/', authMiddleware, normalizeXpPayload, validate(xpLogSchema), xpLogController.createLog);

// Convert XP to Wallet Cashback balance
router.post('/convert-cashback', authMiddleware, xpLogController.convertXpToCashback);

wrapRouterAsync(router);
module.exports = router;
