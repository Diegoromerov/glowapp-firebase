const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const chatController = require('../controllers/chatController');
const { rateLimitByUser } = require('../middleware/rateLimiter');

// Rate limiter para mensajes de chat por tier de usuario
// Se aplica dinámicamente basado en el tier del usuario
router.get('/chat/conversations', authMiddleware, rateLimitByUser({ tier: 'free' }), chatController.getConversations);
router.get('/chat/messages/:partnerId', authMiddleware, rateLimitByUser({ tier: 'free' }), chatController.getMessages);
router.post('/chat/messages', authMiddleware, rateLimitByUser({ tier: 'free' }), chatController.sendMessage);
router.patch('/chat/messages/:partnerId/read', authMiddleware, rateLimitByUser({ tier: 'free' }), chatController.readMessages);

wrapRouterAsync(router);
module.exports = router;