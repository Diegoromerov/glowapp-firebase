const { wrapRouterAsync } = require('../utils/expressAsync');
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const membershipMiddleware = require('../middleware/membership.middleware');
const { requirePermission, RESOURCES, ACTIONS } = require('../middleware/authorization.middleware');
const membershipController = require('../controllers/membershipController');

/**
 * 🛡️ MEMBERSHIP MANAGEMENT ROUTES (GLOWAPP SAAS)
 * Middleware chain: Auth -> Active Context Membership -> RBAC -> Controller
 */

router.get(
  '/',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.READ),
  membershipController.getMembers
);

router.post(
  '/invite',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS),
  membershipController.inviteMember
);

router.patch(
  '/:id/role',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.CHANGE_ROLE),
  membershipController.updateRole
);

router.patch(
  '/:id/status',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS),
  membershipController.updateStatus
);

router.delete(
  '/:id',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.MEMBERSHIP, ACTIONS.MANAGE_MEMBERS),
  membershipController.removeMember
);

wrapRouterAsync(router);
module.exports = router;
