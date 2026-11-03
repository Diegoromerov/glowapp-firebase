const { wrapRouterAsync } = require('../utils/expressAsync');
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const userDeliveryAddressController = require('../controllers/userDeliveryAddressController');

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// GET /api/users/delivery-addresses - Listar todas las direcciones
router.get('/delivery-addresses', userDeliveryAddressController.getDeliveryAddresses);

// GET /api/users/delivery-addresses/default - Obtener dirección por defecto
router.get('/delivery-addresses/default', userDeliveryAddressController.getDefaultDeliveryAddress);

// POST /api/users/delivery-addresses - Crear nueva dirección
router.post('/delivery-addresses', userDeliveryAddressController.createDeliveryAddress);

// PATCH /api/users/delivery-addresses/:id - Actualizar dirección
router.patch('/delivery-addresses/:id', userDeliveryAddressController.updateDeliveryAddress);

// DELETE /api/users/delivery-addresses/:id - Eliminar dirección (soft delete)
router.delete('/delivery-addresses/:id', userDeliveryAddressController.deleteDeliveryAddress);

// PATCH /api/users/delivery-addresses/:id/set-default - Marcar como default
router.patch('/delivery-addresses/:id/set-default', userDeliveryAddressController.setDefaultDeliveryAddress);

wrapRouterAsync(router);
module.exports = router;