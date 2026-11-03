const { wrapRouterAsync } = require('../utils/expressAsync');
// src/routes/eventRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const Joi = require('joi');

// Validation schema for creating/updating events
const eventSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional(),
  date: Joi.date().required(),
  location: Joi.string().optional()
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
const {
  getAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
} = require('../controllers/eventController');

// List all events
/**
 * @swagger
 * /api/events:
 *   get:
 *     summary: List all events
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: A list of events.
 */
router.get('/', authMiddleware, getAllEvents);

/**
 * @swagger
 * /api/events/{id}:
 *   get:
 *     summary: Get event by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Event details.
 */
router.get('/:id', authMiddleware, getEventById);

/**
 * @swagger
 * /api/events:
 *   post:
 *     summary: Create a new event
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Event'
 *     responses:
 *       201:
 *         description: Event created.
 */
router.post('/', authMiddleware, validate(eventSchema), createEvent);

/**
 * @swagger
 * /api/events/{id}:
 *   put:
 *     summary: Update an existing event
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Event'
 *     responses:
 *       200:
 *         description: Event updated.
 */
router.put('/:id', authMiddleware, validate(eventSchema), updateEvent);

/**
 * @swagger
 * /api/events/{id}:
 *   delete:
 *     summary: Delete an event
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Event deleted.
 */
router.delete('/:id', authMiddleware, deleteEvent);


wrapRouterAsync(router);
module.exports = router;
