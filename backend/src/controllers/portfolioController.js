// src/controllers/portfolioController.js
const Joi = require('joi');
const { pool } = require('../config/db');
const { Portfolio } = require('../models');

// Validation schema for portfolio items (allow unknown fields)
const portfolioSchema = Joi.object({
  title: Joi.string().allow('', null).optional(),
  description: Joi.string().allow('', null).optional()
}).unknown(true);

// List portfolio items for provider (GET /api/portfolio/provider)
async function listProviderItems(req, res) {
  try {
    const providerId = req.user ? req.user.id : null;
    if (!providerId) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const query = `
      SELECT id, image_url, title, category, likes_count, created_at
      FROM portfolio_items
      WHERE provider_id = $1
      ORDER BY created_at DESC;
    `;
    const result = await pool.query(query, [providerId]);
    return res.json({
      success: true,
      count: result.rows ? result.rows.length : 0,
      data: result.rows || []
    });
  } catch (err) {
    console.error('Error fetching provider portfolio:', err);
    try {
      const items = await Portfolio.findAll({ where: { user_id: req.user.id } });
      return res.json({ success: true, count: items.length, data: items });
    } catch (fallbackErr) {
      return res.status(500).json({ error: 'Error fetching portfolio.' });
    }
  }
}

// List portfolio items for authenticated user (GET /api/portfolio)
async function listItems(req, res) {
  return listProviderItems(req, res);
}

// Create a new portfolio item (POST /api/portfolio)
async function createItem(req, res) {
  try {
    const imageUrl = req.body.image_url || req.body.url;
    const title = req.body.title || null;
    const category = req.body.category || 'hair';

    if (!imageUrl) {
      return res.status(400).json({ error: 'image_url es obligatorio' });
    }

    const providerId = req.user ? req.user.id : null;
    if (!providerId) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const query = `
      INSERT INTO portfolio_items (provider_id, image_url, title, category)
      VALUES ($1, $2, $3, $4)
      RETURNING id, provider_id, image_url, title, category, created_at;
    `;
    const result = await pool.query(query, [
      providerId,
      imageUrl,
      title,
      category
    ]);

    const createdItem = result.rows[0];
    return res.status(201).json({
      success: true,
      message: 'Imagen agregada al portafolio',
      portfolio_item: createdItem,
      ...createdItem
    });
  } catch (err) {
    console.error('Error creating portfolio item:', err);
    try {
      const imageUrl = req.body.image_url || req.body.url || '';
      const item = await Portfolio.create({
        user_id: req.user.id,
        title: req.body.title || 'Trabajo',
        description: req.body.description || '',
        image_url: imageUrl
      });
      const dataVal = item.dataValues || item;
      return res.status(201).json({
        success: true,
        message: 'Imagen agregada al portafolio',
        portfolio_item: dataVal,
        ...dataVal
      });
    } catch (fallbackErr) {
      return res.status(500).json({ error: 'Error al agregar al portafolio.' });
    }
  }
}

// Delete portfolio item (DELETE /api/portfolio/:id)
async function deleteItem(req, res) {
  try {
    const itemId = req.params.id;
    const providerId = req.user ? req.user.id : null;

    if (!providerId) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const query = 'DELETE FROM portfolio_items WHERE id = $1 AND provider_id = $2 RETURNING id;';
    const result = await pool.query(query, [itemId, providerId]);

    if (result.rowCount === 0) {
      try {
        await Portfolio.destroy({ where: { id: itemId, user_id: providerId } });
      } catch (e) {
        // ignore fallback errors
      }
    }

    return res.json({
      success: true,
      message: 'Elemento eliminado del portafolio'
    });
  } catch (err) {
    console.error('Error deleting portfolio item:', err);
    return res.status(500).json({ error: 'Error al eliminar del portafolio.' });
  }
}

module.exports = { listProviderItems, listItems, createItem, deleteItem };
