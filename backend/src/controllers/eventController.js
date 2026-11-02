// src/controllers/eventController.js
const Joi = require('joi');
const { Event } = require('../models');

// Validation schemas (allow unknown fields for flexibility)
const eventSchema = Joi.object().unknown(true);

// Get all events
async function getAllEvents(req, res) {
  try {
    const events = await Event.findAll();
    return res.json(events);
  } catch (err) {
    console.error('Error fetching events:', err);
    return res.status(500).json({ error: 'Error fetching events.' });
  }
}

// Get single event by ID
async function getEventById(req, res) {
  try {
    const { id } = req.params;
    const event = await Event.findByPk(id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    return res.json(event);
  } catch (err) {
    console.error('Error fetching event:', err);
    return res.status(500).json({ error: 'Error fetching event.' });
  }
}

// Create a new event
async function createEvent(req, res) {
  try {
    // Validate request body
    const { error } = eventSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const newEvent = await Event.create(req.body);
    return res.status(201).json(newEvent);
  } catch (err) {
    console.error('Error creating event:', err);
    return res.status(500).json({ error: 'Error creating event.' });
  }
}

// Update an existing event
async function updateEvent(req, res) {
  try {
    const { id } = req.params;
    // Validate request body
    const { error } = eventSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const [updated] = await Event.update(req.body, { where: { id } });
    if (!updated) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const updatedEvent = await Event.findByPk(id);
    return res.json(updatedEvent);
  } catch (err) {
    console.error('Error updating event:', err);
    return res.status(500).json({ error: 'Error updating event.' });
  }
}

// Delete an event
async function deleteEvent(req, res) {
  try {
    const { id } = req.params;
    const deleted = await Event.destroy({ where: { id } });
    if (!deleted) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('Error deleting event:', err);
    return res.status(500).json({ error: 'Error deleting event.' });
  }
}

module.exports = {
  getAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
};
