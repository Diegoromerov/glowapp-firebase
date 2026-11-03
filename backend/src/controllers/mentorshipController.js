// src/controllers/mentorshipController.js
const Joi = require('joi');
const { MentorshipSession } = require('../models');

// Validation schema for mentorship sessions (allow unknown fields)
const mentorshipSchema = Joi.object({
  mentor_id: Joi.number().integer().required(),
  mentee_id: Joi.number().integer().required(),
  scheduled_at: Joi.date().required()
}).unknown(true);

// List mentorship sessions for authenticated user (as mentor)
async function listSessions(req, res) {
  try {
    const sessions = await MentorshipSession.findAll({ where: { mentor_id: req.user.id } });
    return res.json(sessions);
  } catch (err) {
    console.error('Error fetching mentorship sessions:', err);
    return res.status(500).json({ error: 'Error fetching mentorship sessions.' });
  }
}

// Create a mentorship session
async function createSession(req, res) {
  try {
    // Validate request body
    const { error } = mentorshipSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    // Ensure the mentor_id matches the authenticated user
    if (req.body.mentor_id && parseInt(req.body.mentor_id) !== req.user.id) {
      return res.status(403).json({ error: 'Mentor ID does not match authenticated user.' });
    }
    const session = await MentorshipSession.create(req.body);
    return res.status(201).json(session);
  } catch (err) {
    console.error('Error creating mentorship session:', err);
    return res.status(500).json({ error: 'Error creating mentorship session.' });
  }
}

module.exports = { listSessions, createSession };
