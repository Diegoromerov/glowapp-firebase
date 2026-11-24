const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const saasContext = require('../middleware/saasContext');
const { requireRole } = require('../middleware/featureGate');
const loyalty = require('../services/salonLoyaltyService');

const router = express.Router();
router.use(authMiddleware, saasContext);

function activeSalon(req, res) {
  if (!req.saas) {
    res.status(401).json({ error: 'Contexto SaaS requerido', message: 'Selecciona un negocio activo.' });
    return null;
  }
  if (!req.saas.salonId) {
    res.status(400).json({ error: 'Selecciona una sede para administrar su fidelización.' });
    return null;
  }
  return { businessProfileId: req.saas.tenantId, salonId: req.saas.salonId };
}

router.get('/program/audit', requireRole('MANAGER'), async (req, res) => {
  const scope = activeSalon(req, res);
  if (!scope) return;
  try { return res.json({ changes: await loyalty.listProgramAudit(scope) }); }
  catch (error) { return handleError(res, error); }
});

function handleError(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
  console.error('[saasLoyaltyRoutes] Error de fidelización:', error.message);
  return res.status(500).json({ error: 'No se pudo completar la operación de fidelización.' });
}

/**
 * @swagger
 * /api/saas/loyalty/program:
 *   get:
 *     summary: Consultar reglas de fidelización de la sede activa
 *     operationId: getSalonLoyaltyProgram
 *     tags: [saas]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Reglas y estado del programa independiente del programa global de GlowApp. }
 *       401: { description: Contexto SaaS requerido. }
 *       400: { description: Falta seleccionar una sede. }
 */
router.get('/program', requireRole('MANAGER'), async (req, res) => {
  const scope = activeSalon(req, res);
  if (!scope) return;
  try {
    const [program, audit] = await Promise.all([loyalty.getProgram(scope), loyalty.listProgramAudit(scope)]);
    return res.json({ ...program, audit });
  } catch (error) { return handleError(res, error); }
});

/**
 * @swagger
 * /api/saas/loyalty/program:
 *   put:
 *     summary: Configurar el programa de puntos de la sede
 *     operationId: saveSalonLoyaltyProgram
 *     tags: [saas]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pointsPerCompletedBooking, pointsPer1000Cop, isEnabled]
 *             properties:
 *               pointsPerCompletedBooking: { type: integer, minimum: 0 }
 *               pointsPer1000Cop: { type: integer, minimum: 0 }
 *               isEnabled: { type: boolean }
 *     responses:
 *       200: { description: Regla guardada y auditada por creador/actualizador. }
 *       400: { description: Regla inválida. }
 *       401: { description: Contexto SaaS requerido. }
 *       403: { description: Rol insuficiente. }
 */
router.put('/program', requireRole('ADMIN'), async (req, res) => {
  const scope = activeSalon(req, res);
  if (!scope) return;
  try { return res.json(await loyalty.saveProgram({ ...scope, actorId: req.user.id, input: req.body || {} })); }
  catch (error) { return handleError(res, error); }
});

/**
 * @swagger
 * /api/saas/loyalty/rewards:
 *   get:
 *     summary: Listar recompensas propias de la sede
 *     operationId: listSalonLoyaltyRewards
 *     tags: [saas]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Recompensas activas; ADMIN y superior pueden incluir inactivas con includeInactive=true. }
 */
router.get('/rewards', requireRole('MANAGER'), async (req, res) => {
  const scope = activeSalon(req, res);
  if (!scope) return;
  try {
    const includeInactive = req.query.includeInactive === 'true' && ['OWNER', 'ADMIN'].includes(req.saas.role);
    return res.json({ rewards: await loyalty.listRewards({ ...scope, includeInactive }) });
  } catch (error) { return handleError(res, error); }
});

router.get('/rewards/audit', requireRole('MANAGER'), async (req, res) => {
  const scope = activeSalon(req, res);
  if (!scope) return;
  try { return res.json({ changes: await loyalty.listRewardAudit(scope) }); }
  catch (error) { return handleError(res, error); }
});

/**
 * @swagger
 * /api/saas/loyalty/rewards:
 *   post:
 *     summary: Crear una recompensa del salón
 *     operationId: createSalonLoyaltyReward
 *     tags: [saas]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, pointsCost]
 *             properties:
 *               name: { type: string, maxLength: 100 }
 *               description: { type: string, maxLength: 500 }
 *               pointsCost: { type: integer, minimum: 1 }
 *               maxRedemptionsPerCustomer: { type: integer, minimum: 1, nullable: true }
 *     responses:
 *       201: { description: Recompensa creada. }
 *       400: { description: Datos inválidos. }
 *       403: { description: Rol insuficiente. }
 */
router.post('/rewards', requireRole('ADMIN'), async (req, res) => {
  const scope = activeSalon(req, res);
  if (!scope) return;
  try {
    const reward = await loyalty.createReward({ ...scope, actorId: req.user.id, input: req.body || {} });
    return res.status(201).json(reward);
  } catch (error) { return handleError(res, error); }
});

/**
 * @swagger
 * /api/saas/loyalty/rewards/{rewardId}:
 *   patch:
 *     summary: Actualizar o desactivar una recompensa
 *     operationId: updateSalonLoyaltyReward
 *     tags: [saas]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: rewardId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Recompensa actualizada. }
 *       404: { description: Recompensa no encontrada en la sede. }
 */
router.patch('/rewards/:rewardId', requireRole('ADMIN'), async (req, res) => {
  const scope = activeSalon(req, res);
  if (!scope) return;
  try {
    return res.json(await loyalty.updateReward({ ...scope, rewardId: req.params.rewardId,
      actorId: req.user.id, input: req.body || {} }));
  } catch (error) { return handleError(res, error); }
});

/**
 * @swagger
 * /api/saas/loyalty/bookings/{bookingId}/award:
 *   post:
 *     summary: Acreditar puntos por una reserva completada y pagada
 *     operationId: awardSalonLoyaltyBooking
 *     tags: [saas]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: bookingId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Acreditación idempotente del programa de esta sede. }
 *       409: { description: Reserva no elegible o programa inactivo. }
 */
router.post('/bookings/:bookingId/award', requireRole('MANAGER'), async (req, res) => {
  const scope = activeSalon(req, res);
  if (!scope) return;
  try {
    return res.json(await loyalty.awardCompletedBooking({ ...scope,
      bookingId: req.params.bookingId, actorId: req.user.id }));
  } catch (error) { return handleError(res, error); }
});

/**
 * @swagger
 * /api/saas/loyalty/bookings/eligible:
 *   get:
 *     summary: Listar reservas completadas y pagadas para acreditar puntos
 *     operationId: listEligibleSalonLoyaltyBookings
 *     tags: [saas]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Hasta 100 reservas lógicas de la sede, con indicador de acreditación previa. }
 */
router.get('/bookings/eligible', requireRole('MANAGER'), async (req, res) => {
  const scope = activeSalon(req, res);
  if (!scope) return;
  try { return res.json({ bookings: await loyalty.listEligibleBookings(scope) }); }
  catch (error) { return handleError(res, error); }
});

/**
 * @swagger
 * /api/saas/loyalty/redemptions:
 *   get:
 *     summary: Consultar canjes de recompensas de la sede
 *     operationId: listSalonLoyaltyRedemptions
 *     tags: [saas]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: status, schema: { type: string, enum: [PENDING, FULFILLED, CANCELLED, ALL], default: PENDING } }]
 *     responses:
 *       200: { description: Lista de canjes en alcance del negocio/sede activos. }
 */
router.get('/redemptions', requireRole('MANAGER'), async (req, res) => {
  const scope = activeSalon(req, res);
  if (!scope) return;
  try { return res.json({ redemptions: await loyalty.listRedemptions({ ...scope, status: req.query.status || 'PENDING' }) }); }
  catch (error) { return handleError(res, error); }
});

/**
 * @swagger
 * /api/saas/loyalty/redemptions/{redemptionId}:
 *   patch:
 *     summary: Entregar o cancelar un canje; cancelar devuelve los puntos
 *     operationId: updateSalonLoyaltyRedemption
 *     tags: [saas]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: redemptionId, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [status], properties: { status: { type: string, enum: [FULFILLED, CANCELLED] } } }
 *     responses:
 *       200: { description: Estado final registrado; el reintegro es idempotente. }
 *       409: { description: El canje ya alcanzó un estado final. }
 */
router.patch('/redemptions/:redemptionId', requireRole('MANAGER'), async (req, res) => {
  const scope = activeSalon(req, res);
  if (!scope) return;
  try {
    return res.json(await loyalty.updateRedemption({ ...scope, redemptionId: req.params.redemptionId,
      actorId: req.user.id, status: req.body?.status }));
  } catch (error) { return handleError(res, error); }
});

module.exports = router;
