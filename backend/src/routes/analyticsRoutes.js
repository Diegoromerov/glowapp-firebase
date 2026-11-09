const { wrapRouterAsync } = require('../utils/expressAsync');
// src/routes/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authMiddleware } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');

// Telemetría: ruta PÚBLICA a propósito.
//
// Antes exigía authMiddleware y eso cegaba la observabilidad: el embudo anónimo
// (quien navega el catálogo sin cuenta) y los crash reports de una sesión que
// aún no tiene token se descartaban con un 401. El controller ya persiste
// `user_id: null`, así que el token no aportaba aislamiento: solo perdía datos.
//
// El freno es por IP, que es lo que realmente protege la base de un bucle de
// eventos: 120 por minuto deja margen a un cliente legítimo (una pantalla manda
// 1-3 eventos) y corta un bucle.
const { rateLimitByIP } = require('../middleware/rateLimiter');
const analyticsLimiter = rateLimitByIP({ windowMs: 60 * 1000, limit: 120 });

// Log analytics event (telemetry)
router.post('/events', analyticsLimiter, analyticsController.logEvent);

// El consumidor del embudo: solo administración. Devuelve conteos, no datos
// personales (el controller nunca guarda user_id ni metadata libre).
router.get('/summary', authMiddleware, requireRol('admin'), analyticsController.summary);

wrapRouterAsync(router);
module.exports = router;
