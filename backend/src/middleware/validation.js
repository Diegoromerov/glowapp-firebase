// src/middleware/validation.js
const Joi = require('joi');

/**
 * Middleware to validate badge creation payload.
 * Expects a JSON body with `badge_id` (integer, required).
 */
function validateBadge(req, res, next) {
  const schema = Joi.object({
    badge_id: Joi.number().integer().required()
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
}

module.exports = { validateBadge };
