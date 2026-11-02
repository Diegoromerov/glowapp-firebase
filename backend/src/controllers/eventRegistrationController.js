// src/controllers/eventRegistrationController.js
const { EventRegistration, Event } = require('../models');
// Register a user for an event. Validation is performed in route middleware.
async function registerForEvent(req, res) {
  try {
    const { id: eventId } = req.params;
    const userId = req.user.id;
    // Verify event exists
    const event = await Event.findByPk(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const registration = await EventRegistration.create({ event_id: eventId, user_id: userId });
    return res.status(201).json(registration);
  } catch (err) {
    console.error('Error registering for event:', err);
    return res.status(500).json({ error: 'Error registering for event.' });
  }
}

module.exports = {
  registerForEvent,
};
