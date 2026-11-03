const { wrapRouterAsync } = require('../utils/expressAsync');
// src/routes/portfolioRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const Joi = require('joi');
const portfolioController = require('../controllers/portfolioController');

// Validation schema for creating a portfolio item (allow image_url, title, category, description, url, etc.)
const portfolioSchema = Joi.object({
  image_url: Joi.string().allow('', null).optional(),
  url: Joi.string().allow('', null).optional(),
  title: Joi.string().allow('', null).optional(),
  description: Joi.string().allow('', null).optional(),
  category: Joi.string().allow('', null).optional()
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

// List portfolio items for provider (/api/portfolio/provider)
router.get('/provider', authMiddleware, portfolioController.listProviderItems);

// List portfolio items for authenticated user (/api/portfolio)
router.get('/', authMiddleware, portfolioController.listItems);

// Create a new portfolio item (/api/portfolio)
router.post('/', authMiddleware, validate(portfolioSchema), portfolioController.createItem);

// Delete portfolio item (/api/portfolio/:id)
router.delete('/:id', authMiddleware, portfolioController.deleteItem);

wrapRouterAsync(router);
module.exports = router;
