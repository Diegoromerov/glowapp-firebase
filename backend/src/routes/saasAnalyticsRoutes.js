const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const saasContext = require('../middleware/saasContext');
const { requireEntitlement, requireRole } = require('../middleware/featureGate');
const { getBusinessAnalytics } = require('../services/saasBusinessAnalyticsService');

const router = express.Router();
router.use(authMiddleware, saasContext);

/**
 * @swagger
 * /api/saas/analytics:
 *   get:
 *     summary: Consultar indicadores agregados del negocio SaaS
 *     description: Requiere sesión activa, capacidad ADVANCED_ANALYTICS y rol OWNER, ADMIN o MANAGER. Solo devuelve agregados; nunca datos personales de clientes.
 *     operationId: getSaasBusinessAnalytics
 *     tags: [saas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *         description: Primer día inclusivo en calendario America/Bogota; por defecto últimos 30 días.
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *         description: Último día inclusivo en calendario America/Bogota; máximo 366 días por período.
 *     responses:
 *       200:
 *         description: KPIs agregados por reservas, caja, clientes recurrentes, ocupación e inventario.
 *       400:
 *         description: Fechas inválidas, invertidas o período mayor a 366 días.
 *       401:
 *         description: Sesión o contexto de negocio ausente.
 *       403:
 *         description: El plan no incluye analítica avanzada o el rol no tiene acceso.
 *       500:
 *         description: No se pudo consultar la analítica.
 */
// Analítica financiera y comercial agregada: solo gerencia/administración y
// planes que ya incluyen ADVANCED_ANALYTICS. La sede procede de saasContext,
// que valida el header contra una membresía activa del mismo negocio.
router.get('/', requireEntitlement('ADVANCED_ANALYTICS'), requireRole('MANAGER'), async (req, res) => {
  try {
    const data = await getBusinessAnalytics({
      tenantId: req.saas.tenantId,
      salonId: req.saas.salonId || null,
      query: req.query,
    });
    return res.json(data);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[saasAnalyticsRoutes] No se pudo calcular la analítica:', error.message);
    return res.status(500).json({ error: 'No se pudo consultar la analítica del negocio.' });
  }
});

module.exports = router;
