// backend/src/middleware/salonEntitlement.js
/**
 * E-04 (D-GL-027) — compuerta de plan para las rutas del salón.
 *
 * POR QUÉ NO SE REUSA `featureGate.requireEntitlement`
 * Ese middleware lee `req.saas`, que sólo puebla `saasContext` a partir de una
 * membresía activa. Las rutas `/api/salon/*` no pasan por ahí (se autorizan con
 * el guard de salón), así que montarlo devolvería 401 en todos los salones que
 * aún no tienen identidad provisionada. El plan se lee de
 * `business_profiles.saas_plan`, fuente canónica. `salones.plan_saas` es una
 * copia heredada que no se actualiza en todas las mutaciones de suscripción y
 * no debe usarse para autorizar módulos.
 *
 * El cuerpo del 403 es el mismo que el de `featureGate` para que el cliente
 * trate igual las dos rutas de bloqueo (`error`, `required`, `currentPlan`).
 */

const { pool, systemPool } = require('../config/db');
const { hasEntitlement } = require('../config/saasEntitlements');
const { runAsSystem, runInTenantTransaction } = require('../config/tenantRouting');

async function readSalonPlanForMember(salonId, req, db) {
  const readPlan = (client) => client.query(
    `SELECT bp.saas_plan
       FROM salones s
       JOIN business_profiles bp ON bp.id = s.business_profile_id
      WHERE s.id = $1`,
    [salonId]
  );

  // Injection point for focused middleware tests; production must always set
  // user and tenant context because business_profiles and salones are RLS-bound.
  if (db !== pool || typeof db.connect !== 'function') return db.query(
    `SELECT bp.saas_plan
       FROM salones s
       JOIN business_profiles bp ON bp.id = s.business_profile_id
      WHERE s.id = $1`,
    [salonId]
  );

  return runInTenantTransaction({ pool }, req.user?.tenant_id ?? null, req.user?.id ?? null, async (client) => {
    if (!req.user?.tenant_id && req.user?.id) {
      const { rows } = await client.query('SELECT tenant_id FROM usuarios WHERE id = $1', [req.user.id]);
      const tenantId = rows[0]?.tenant_id;
      if (tenantId !== undefined && tenantId !== null) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenantId)]);
      }
    }
    return readPlan(client);
  });
}

/**
 * Exige que el plan del salón incluya la capacidad indicada.
 * Requiere `req.salonId` resuelto antes (p. ej. por `requireSalonAdmin`).
 *
 * @param {string|string[]} capability capacidad o capacidades alternativas de `saasEntitlements`
 * @param {{ query: Function }} [db] inyectable para pruebas
 */
function requireSalonEntitlement(capability, db = pool) {
  return async function salonEntitlement(req, res, next) {
    try {
      const salonId = req.salonId || req.body?.salon_id || req.params?.salonId;
      if (!salonId) {
        return res.status(400).json({ error: 'salon_id es obligatorio.' });
      }

      const { rows } = await readSalonPlanForMember(salonId, req, db);

      if (rows.length === 0) {
        return res.status(404).json({ error: 'El salón no existe.' });
      }

      const plan = String(rows[0].saas_plan || 'FREE_TRIAL').toUpperCase();
      const required = Array.isArray(capability) ? capability : [capability];
      if (!required.some((item) => hasEntitlement(plan, item))) {
        return res.status(403).json({
          error: 'Plan no incluye esta función',
          required: Array.isArray(capability) ? capability : capability,
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

/**
 * Entitlement lookup for customer-facing salon features that intentionally
 * cross tenant boundaries (for example, a customer viewing a salon's rewards).
 * The tenant's canonical plan is read through the audited system connection; the actual
 * feature service must still scope every read/write to salonId and customerId.
 * Do not use this for salon administration routes: those must first establish
 * membership with requireSalonRole/requireSalonAdmin and use the tenant-scoped
 * requireSalonEntitlement above.
 */
function requirePublicSalonEntitlement(capability) {
  return async function publicSalonEntitlement(req, res, next) {
    const salonId = req.params?.salonId;
    if (!/^\d+$/.test(String(salonId || '')) || !Number.isSafeInteger(Number(salonId)) || Number(salonId) < 1) {
      return res.status(400).json({ error: 'Identificador de sede inválido.' });
    }

    try {
      const { rows } = await runAsSystem({ pool, systemPool }, (client) => client.query(
        `SELECT CASE
                  WHEN bp.id IS NULL THEN s.plan_saas
                  ELSE bp.saas_plan
                END AS saas_plan
           FROM salones s
           LEFT JOIN business_profiles bp ON bp.id = s.business_profile_id
          WHERE s.id = $1`, [Number(salonId)]
      ));
      if (!rows.length) return res.status(404).json({ error: 'El salón no existe.' });

      const plan = String(rows[0].saas_plan || 'FREE_TRIAL').toUpperCase();
      const required = Array.isArray(capability) ? capability : [capability];
      if (!required.some((item) => hasEntitlement(plan, item))) {
        return res.status(403).json({
          error: 'Plan no incluye esta función',
          required: Array.isArray(capability) ? capability : capability,
          upgradeUrl: '/api/saas/checkout',
        });
      }

      req.salonPlan = plan;
      return next();
    } catch (error) {
      console.error('❌ ERROR requirePublicSalonEntitlement:', error.message);
      return res.status(500).json({ error: 'No se pudo verificar el plan del salón.' });
    }
  };
}

module.exports = { requireSalonEntitlement, requirePublicSalonEntitlement };
