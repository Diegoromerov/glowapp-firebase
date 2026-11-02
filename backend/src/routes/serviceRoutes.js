const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/serviceRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const membershipMiddleware = require('../middleware/membership.middleware');
const { requirePermission, RESOURCES, ACTIONS } = require('../middleware/authorization.middleware');
const serviceController = require('../controllers/serviceController');

// 🛡️ Cadena de Protección SaaS: Auth -> Membership -> RBAC -> Controller
router.get(
  '/services/provider',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.SERVICE, ACTIONS.READ),
  serviceController.getProviderServices
);

router.post(
  '/services',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.SERVICE, ACTIONS.CREATE),
  serviceController.createService
);

router.put(
  '/services/:id',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.SERVICE, ACTIONS.UPDATE),
  serviceController.updateService
);

router.delete(
  '/services/:id',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.SERVICE, ACTIONS.DELETE),
  serviceController.deleteService
);

wrapRouterAsync(router);
module.exports = router;
