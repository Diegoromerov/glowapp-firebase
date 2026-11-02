const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/vtoRoutes.js
const express = require('express');
const router = express.Router();
const vtoService = require('../services/vto/vtoService');
const { authMiddleware } = require('../middleware/auth');

// GET /api/vto/catalog?category=makeup&subtono=cálido
router.get('/catalog', async (req, res) => {
  try {
    const { category, subtono } = req.query;
    const catalog = await vtoService.getCatalog(category, subtono);
    res.json({
      success: true,
      category: category || 'makeup',
      subtono: subtono || 'neutro',
      products: catalog,
    });
  } catch (error) {
    console.error('Error al obtener catálogo VTO:', error.message);
    res.status(500).json({ error: 'Error al obtener catálogo VTO' });
  }
});

// POST /api/vto/nail-tryon
router.post('/nail-tryon', authMiddleware, async (req, res) => {
  try {
    const { style, colorHex } = req.body;
    const userId = req.user?.id || req.body.userId || 1;

    const result = await vtoService.createNailJob(userId, null, style, colorHex);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error en endpoint Nail VTO:', error.message);
    res.status(500).json({ error: 'Error al procesar VTO de uñas' });
  }
});

wrapRouterAsync(router);
module.exports = router;
