// src/routes/rewardsRoutes.js
const express = require('express');
const { wrapRouterAsync } = require('../utils/expressAsync');
const { authMiddleware } = require('../middleware/auth');
const rewardsController = require('../controllers/rewardsController');

const router = express.Router();

// Saldo del fondo de puntos canjeable de la usuaria autenticada.
// El canje no vive aquí: se aplica al crear el pedido, dentro de su transacción.
router.get('/points', authMiddleware, rewardsController.obtenerPuntos);

wrapRouterAsync(router);
module.exports = router;
