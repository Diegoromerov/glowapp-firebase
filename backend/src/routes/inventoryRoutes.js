const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/inventoryRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const inventoryController = require('../controllers/inventoryController');

// 🔹 OBTENER INVENTARIO EN CONSIGNACIÓN Y ALERTAS
// Ruta publicada en /api/provider/inventory/consignment (la que llama el cliente:
// frontend/lib/services/api_service.dart:2001). El slug anterior era
// 'consignacion' y no coincidía con el cliente, así que aun montada devolvía 404.
router.get('/inventory/consignment', authMiddleware, inventoryController.getProviderConsignmentInventory);

// 🔹 REGISTRAR CONSUMO O VENTA DE INSUMO EN SALÓN SAAS
router.post('/inventory/consume', authMiddleware, inventoryController.consumeInventoryItem);

wrapRouterAsync(router);
module.exports = router;
