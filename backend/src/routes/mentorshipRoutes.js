const { wrapRouterAsync } = require('../utils/expressAsync');
// src/routes/mentorshipRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const mentorshipController = require('../controllers/mentorshipController');
const Joi = require('joi');

// Validation schema for mentorship session creation
const mentorshipSchema = Joi.object({
  mentor_id: Joi.number().integer().required(),
  mentee_id: Joi.number().integer().required(),
  scheduled_at: Joi.date().required()
});

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

// List mentorship sessions for the authenticated mentor
router.get('/sessions', authMiddleware, mentorshipController.listSessions);

// Create a mentorship session
router.post('/sessions', authMiddleware, validate(mentorshipSchema), mentorshipController.createSession);

wrapRouterAsync(router);
module.exports = router;
