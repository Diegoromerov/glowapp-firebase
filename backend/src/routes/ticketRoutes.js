const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/ticketRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const ticketController = require('../controllers/ticketController');

// Crear un nuevo ticket de soporte
router.post('/tickets', authMiddleware, ticketController.createTicket);

// Listar tickets del usuario autenticado
router.get('/tickets/my-tickets', authMiddleware, ticketController.getMyTickets);

// Obtener mensajes de un ticket
router.get('/tickets/:id/messages', authMiddleware, ticketController.getTicketMessages);

// Enviar un mensaje de respuesta a un ticket
router.post('/tickets/:id/messages', authMiddleware, ticketController.createTicketMessage);

wrapRouterAsync(router);
module.exports = router;
