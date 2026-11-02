const { wrapRouterAsync } = require('../utils/expressAsync');
/**
 * GLOWAPP BUSINESS ROUTES
 * Express router for GlowApp Business Engine REST API (/api/v1/business).
 */

const express = require('express');
const router = express.Router();
const businessController = require('../controllers/businessController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const membershipMiddleware = require('../middleware/membership.middleware');
const { requirePermission, RESOURCES, ACTIONS } = require('../middleware/authorization.middleware');
const subirEvidencia = require('../middleware/evidenceUpload');
const { adminAuditLog } = require('../middleware/adminAuditLog');

// 1. Ruta Pública de Catálogo (Sin autenticación requerida para descubrimiento)
router.get('/verticals', businessController.getVerticals);

// 2. Rutas Privadas del Negocio (Protegidas por Cadena SaaS: Auth -> Membership -> RBAC)
router.post(
  '/diagnostic',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.BUSINESS_PROFILE, ACTIONS.UPDATE),
  businessController.runDiagnostic
);

router.get(
  '/summary',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.BUSINESS_PROFILE, ACTIONS.READ),
  businessController.getSummary
);

// Tareas y Flujos Guiados
router.get(
  '/tasks',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.BUSINESS_PROFILE, ACTIONS.READ),
  businessController.getTasks
);

router.post(
  '/tasks/:id/advance',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.BUSINESS_PROFILE, ACTIONS.UPDATE),
  businessController.advanceTask
);

router.post(
  '/tasks/:id/evidence',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.BUSINESS_PROFILE, ACTIONS.UPDATE),
  subirEvidencia,
  businessController.submitEvidence
);

// Generador Documental y Firmas
router.get(
  '/templates',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.SETTINGS, ACTIONS.READ),
  businessController.getTemplates
);

router.post(
  '/documents/generate',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.BUSINESS_PROFILE, ACTIONS.CREATE),
  adminAuditLog('document.generate', 'document'),
  businessController.generateDocument
);

router.get(
  '/documents/:id/download',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.BUSINESS_PROFILE, ACTIONS.READ),
  businessController.downloadDocument
);

router.post(
  '/documents/:id/request-signature',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.BUSINESS_PROFILE, ACTIONS.UPDATE),
  businessController.requestDocumentSignature
);

router.post(
  '/documents/:id/sign',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.BUSINESS_PROFILE, ACTIONS.UPDATE),
  businessController.signDocument
);

router.post(
  '/documents/:id/version',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.BUSINESS_PROFILE, ACTIONS.UPDATE),
  businessController.createDocumentVersion
);

router.get(
  '/documents/:id/audit',
  authMiddleware,
  membershipMiddleware,
  requirePermission(RESOURCES.BUSINESS_PROFILE, ACTIONS.READ),
  businessController.getDocumentAuditTrail
);

// 3. Rutas de Administración del Sistema (Protegidas por Admin Middleware)
//    Las acciones sensibles quedan trazadas de forma append-only (FIX-FLUTTER-10).
router.get('/admin/queue', authMiddleware, adminMiddleware, businessController.getAdminQueue);
router.put(
  '/admin/evidence/:id',
  authMiddleware,
  adminMiddleware,
  adminAuditLog((req) => `evidence.${String((req.body && req.body.action) || 'review').toLowerCase()}`, 'evidence'),
  businessController.reviewEvidence
);

wrapRouterAsync(router);
module.exports = router;
