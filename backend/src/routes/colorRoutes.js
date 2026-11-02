const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/colorRoutes.js
const express = require('express');
const router = express.Router();
const theColorApi = require('../services/theColorApi');
const { authMiddleware } = require('../middleware/auth');

// GET /api/color/palette?hex=FF6B6B&count=5&mode=analogic
router.get('/palette', authMiddleware, async (req, res) => {
  const { hex, count = 5, mode = 'analogic' } = req.query;

  if (!hex) {
    return res.status(400).json({ error: 'hex es obligatorio' });
  }

  try {
    const palette = await theColorApi.getPalette(hex, parseInt(count), mode);
    res.json({ palette });
  } catch (error) {
    console.error('Error en /palette:', error);
    res.status(500).json({ error: 'Error al generar paleta' });
  }
});

wrapRouterAsync(router);
module.exports = router;
