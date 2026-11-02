// backend/src/middleware/salonEntitlement.js
/**
 * E-04 (D-GL-027) — compuerta de plan para las rutas del salón.
 *
 * POR QUÉ NO SE REUSA `featureGate.requireEntitlement`
 * Ese middleware lee `req.saas`, que sólo puebla `saasContext` a partir de una
 * membresía activa. Las rutas `/api/salon/*` no pasan por ahí (se autorizan con
 * el guard de salón), así que montarlo devolvería 401 en todos los salones que
 * aún no tienen identidad provisionada. Aquí el plan se lee del propio salón,
 * que es la fuente que el cliente ya muestra.
 *
 * El cuerpo del 403 es el mismo que el de `featureGate` para que el cliente
 * trate igual las dos rutas de bloqueo (`error`, `required`, `currentPlan`).
 */

const { pool } = require('../config/db');
const { hasEntitlement } = require('../config/saasEntitlements');

/**
 * Exige que el plan del salón incluya la capacidad indicada.
 * Requiere `req.salonId` resuelto antes (p. ej. por `requireSalonAdmin`).
 *
 * @param {string} capability capacidad de `saasEntitlements`
 * @param {{ query: Function }} [db] inyectable para pruebas
 */
function requireSalonEntitlement(capability, db = pool) {
  return async function salonEntitlement(req, res, next) {
    try {
      const salonId = req.salonId || req.body?.salon_id || req.params?.salonId;
      if (!salonId) {
        return res.status(400).json({ error: 'salon_id es obligatorio.' });
      }

      const { rows } = await db.query(
        `SELECT plan_saas FROM salones WHERE id = $1`,
        [salonId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'El salón no existe.' });
      }

      const plan = String(rows[0].plan_saas || 'FREE_TRIAL').toUpperCase();
      if (!hasEntitlement(plan, capability)) {
        return res.status(403).json({
          error: 'Plan no incluye esta función',
          required: capability,
          currentPlan: plan,
          upgradeUrl: '/api/saas/checkout',
        });
      }

      req.salonPlan = plan;
      return next();
    } catch (error) {
      console.error('❌ ERROR requireSalonEntitlement:', error.message);
      return res.status(500).json({ error: 'No se pudo verificar el plan del salón.' });
    }
  };
}

module.exports = { requireSalonEntitlement };
