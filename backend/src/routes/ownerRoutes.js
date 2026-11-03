const { wrapRouterAsync } = require('../utils/expressAsync');
const express = require('express');
const router = express.Router();
const {
  getOwnerSalones,
  switchSalon,
  getDashboardMetrics,
} = require('../controllers/ownerController');
const { authMiddleware } = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');
const {
  requireOwnerRole,
  requireAnyOwnerSede,
} = require('../middleware/ownerGuard');

// Lista todas las sedes pertenecientes o administradas por el Propietario
router.get('/salones', authMiddleware, tenantContext, requireAnyOwnerSede, getOwnerSalones);

// Cambiar o seleccionar sede activa
router.post('/switch-salon', authMiddleware, tenantContext, requireOwnerRole, switchSalon);

// Dashboard consolidado de métricas multi-sede
router.get('/dashboard-metrics', authMiddleware, tenantContext, requireAnyOwnerSede, getDashboardMetrics);

wrapRouterAsync(router);
module.exports = router;
