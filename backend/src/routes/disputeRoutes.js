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

// La resolución financiera solo se ofrece por el endpoint transaccional de
// paymentRoutes (`PUT /api/admin/disputes/:id/resolve`). No reactivar aquí la
// ruta histórica: solo cambiaba el estado del expediente sin mover los fondos.

wrapRouterAsync(router);
module.exports = router;
