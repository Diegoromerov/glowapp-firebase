// src/routes/rewardsRoutes.js
const express = require('express');
const { wrapRouterAsync } = require('../utils/expressAsync');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const rewardsController = require('../controllers/rewardsController');
const rewardsAdminController = require('../controllers/rewardsAdminController');

const router = express.Router();

// Saldo del fondo de puntos canjeable de la usuaria autenticada.
// El canje no vive aquí: se aplica al crear el pedido, dentro de su transacción.
router.get('/points', authMiddleware, rewardsController.obtenerPuntos);

// Reporte de gestión: pasivo, emisión, canje y vencimiento. Sólo administración:
// son cifras del negocio, no del usuario.
router.get('/reporte', authMiddleware, adminMiddleware, rewardsAdminController.reporte);

// Revisión antifraude: conversiones marcadas por compartir IP o dispositivo con
// quien las invitó. Aprobar acredita; rechazar cierra sin pagar.
router.get('/revisiones', authMiddleware, adminMiddleware, rewardsAdminController.revisiones);
router.post(
  '/revisiones/:id/aprobar',
  authMiddleware,
  adminMiddleware,
  rewardsAdminController.aprobarRevision
);
router.post(
  '/revisiones/:id/rechazar',
  authMiddleware,
  adminMiddleware,
  rewardsAdminController.rechazarRevision
);

wrapRouterAsync(router);
module.exports = router;
