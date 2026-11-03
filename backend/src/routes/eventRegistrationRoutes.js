const { wrapRouterAsync } = require('../utils/expressAsync');
// src/routes/eventRegistrationRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const Joi = require('joi');

// Validation schema for event registration (no body required)
const registrationSchema = Joi.object({});

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

const { registerForEvent } = require('../controllers/eventRegistrationController');

// Register a user for an event
router.post('/events/:id/register', authMiddleware, validate(registrationSchema), registerForEvent);

wrapRouterAsync(router);
module.exports = router;
