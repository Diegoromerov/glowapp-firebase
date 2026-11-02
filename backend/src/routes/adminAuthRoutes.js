// backend/src/routes/adminAuthRoutes.js
const express = require('express');
const router = express.Router();
const { wrapRouterAsync } = require('../utils/expressAsync');
const adminAuthController = require('../controllers/adminAuthController');
const { adminLoginIpLimiter, adminLoginAccountLimiter } = require('../middleware/rateLimiter');
const authAdmin = require('../modules/admin-glow/authAdmin.middleware');

// POST /api/admin/auth/login -> Inicio de sesión administrativo con doble rate limiter (IP + Email)
router.post('/login', adminLoginIpLimiter, adminLoginAccountLimiter, adminAuthController.login);

// POST /api/admin/auth/refresh -> Renovación de tokens (Access 15m, Refresh 8h)
router.post('/refresh', adminAuthController.refresh);

// POST /api/admin/auth/logout -> Cierre de sesión y revocación en Redis blacklist
router.post('/logout', adminAuthController.logout);

// GET /api/admin/auth/session -> Consulta de sesión activa para AuthContext
router.get('/session', authAdmin, adminAuthController.session);

wrapRouterAsync(router);
module.exports = router;
