const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { requireSalonEntitlement } = require('../middleware/salonEntitlement');
const loyalty = require('../services/salonLoyaltyService');

const router = express.Router();
router.use(authMiddleware);

function handleError(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
  console.error('[salonLoyaltyCustomerRoutes] Error:', error.message);
  return res.status(500).json({ error: 'No se pudo consultar la fidelización del salón.' });
}

/**
 * @swagger
 * /api/salon-loyalty/salons/{salonId}/me:
 *   get:
 *     summary: Consultar saldo y movimientos propios del programa de un salón
 *     operationId: getMySalonLoyaltyBalance
 *     tags: [loyalty]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: salonId, required: true, schema: { type: integer, minimum: 1 } }]
 *     responses:
 *       200: { description: Saldo y últimos 50 movimientos del usuario autenticado, solo para esa sede. }
 *       401: { description: Sesión requerida. }
 */
router.get('/salons/:salonId/me', requireSalonEntitlement('LOYALTY'), async (req, res) => {
  const salonId = Number(req.params.salonId);
  if (!Number.isSafeInteger(salonId) || salonId < 1) return res.status(400).json({ error: 'Identificador de sede inválido.' });
  try { return res.json(await loyalty.customerSummary({ salonId, customerUserId: req.user.id })); }
  catch (error) { return handleError(res, error); }
});

/**
 * @swagger
 * /api/salon-loyalty/salons/{salonId}/rewards:
 *   get:
 *     summary: Consultar recompensas activas de un salón
 *     operationId: listPublicSalonLoyaltyRewards
 *     tags: [loyalty]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: salonId, required: true, schema: { type: integer, minimum: 1 } }]
 *     responses:
 *       200: { description: Catálogo activo; no incluye reglas internas ni datos de otros clientes. }
 */
router.get('/salons/:salonId/rewards', requireSalonEntitlement('LOYALTY'), async (req, res) => {
  const salonId = Number(req.params.salonId);
  if (!Number.isSafeInteger(salonId) || salonId < 1) return res.status(400).json({ error: 'Identificador de sede inválido.' });
  try { return res.json(await loyalty.customerRewards({ salonId })); }
  catch (error) { return handleError(res, error); }
});

/**
 * @swagger
 * /api/salon-loyalty/salons/{salonId}/rewards/{rewardId}/redeem:
 *   post:
 *     summary: Solicitar el canje de una recompensa del salón
 *     operationId: redeemSalonLoyaltyReward
 *     tags: [loyalty]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: salonId, required: true, schema: { type: integer, minimum: 1 } }
 *       - { in: path, name: rewardId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [idempotencyKey], properties: { idempotencyKey: { type: string, minLength: 8, maxLength: 120 } } }
 *     responses:
 *       200: { description: Canje pendiente, con descuento atómico del saldo del salón. }
 *       409: { description: Programa desactivado, saldo insuficiente o límite de canjes alcanzado. }
 */
router.post('/salons/:salonId/rewards/:rewardId/redeem', requireSalonEntitlement('LOYALTY'), async (req, res) => {
  const salonId = Number(req.params.salonId);
  if (!Number.isSafeInteger(salonId) || salonId < 1) return res.status(400).json({ error: 'Identificador de sede inválido.' });
  try {
    const result = await loyalty.redeem({ salonId, customerUserId: req.user.id, rewardId: req.params.rewardId,
      key: req.body?.idempotencyKey });
    return res.status(200).json(result);
  } catch (error) { return handleError(res, error); }
});

module.exports = router;
