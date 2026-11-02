const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/disputeRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const disputeController = require('../controllers/disputeController');

// Abrir una disputa para una reserva
router.post('/disputas', authMiddleware, disputeController.createDispute);

// Listar las disputas del usuario autenticado
router.get('/disputas/my-disputes', authMiddleware, disputeController.getMyDisputes);

// Obtener detalle de una disputa
router.get('/disputas/:id', authMiddleware, disputeController.getDisputeById);

// Resolver una disputa (Administrador)
router.patch('/disputas/:id/resolve', authMiddleware, disputeController.resolveDispute);

wrapRouterAsync(router);
module.exports = router;
