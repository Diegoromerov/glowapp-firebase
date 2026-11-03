const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/userPreferencesRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const userPreferencesController = require('../controllers/userPreferencesController');

// GET /api/users/preferences - Obtener preferencias del usuario autenticado
router.get('/preferences', authMiddleware, userPreferencesController.getPreferences);

// PATCH /api/users/preferences - Actualizar preferencias (parcial)
router.patch('/preferences', authMiddleware, userPreferencesController.updatePreferences);

wrapRouterAsync(router);
module.exports = router;