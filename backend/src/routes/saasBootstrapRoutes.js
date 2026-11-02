// backend/src/routes/saasBootstrapRoutes.js
/**
 * Provisionamiento del tenant SaaS para el usuario autenticado.
 *
 * Por qué existe:
 *   El onboarding crea salones en `salones` (Business Engine clásico), pero el
 *   middleware saasContext resuelve el tenant desde `business_profiles` +
 *   `memberships`. Sin una fila de membership no hay `req.saas`, y todas las
 *   rutas /api/saas/* responden 401 "Contexto SaaS requerido".
 *
 *   Este router es el puente idempotente: a partir del salón propiedad del
 *   usuario crea (una sola vez) el business_profile y su membership OWNER.
 *
 * Montaje: /api/saas/bootstrap  (authMiddleware, SIN saasContext)
 */
const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const VALID_PLANS = ['FREE_TRIAL', 'FREEMIUM', 'BASIC', 'PRO', 'ENTERPRISE'];

async function resolveVerticalId() {
  const preferred = await pool.query(
    `SELECT id FROM business_verticals
     WHERE code ILIKE '%BELLEZA%' OR code ILIKE '%BEAUTY%'
     ORDER BY name ASC LIMIT 1`
  );
  if (preferred.rows.length > 0) return preferred.rows[0].id;
  const any = await pool.query('SELECT id FROM business_verticals ORDER BY name ASC LIMIT 1');
  return any.rows[0]?.id || null;
}

/** Tenant actual del usuario, o null si aún no está provisionado. */
async function findTenant(userId) {
  const { rows } = await pool.query(
    `SELECT m.id AS membership_id, m.role, m.status,
            bp.id AS business_profile_id, bp.name, bp.saas_plan, bp.tenant_id
     FROM memberships m
     JOIN business_profiles bp ON bp.id = m.business_profile_id
     WHERE m.user_id = $1 AND m.status = 'ACTIVE'
     ORDER BY m.accepted_at DESC NULLS LAST, m.created_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

function toPayload(row) {
  return {
    id: row.business_profile_id,
    name: row.name,
    plan: row.saas_plan || 'FREE_TRIAL',
    role: row.role,
    membershipId: row.membership_id,
    tenantId: row.tenant_id,
  };
}

/**
 * GET /api/saas/bootstrap
 * Devuelve el tenant activo del usuario autenticado.
 */
router.get('/', async (req, res) => {
  try {
    const tenant = await findTenant(req.user.id);
    if (!tenant) {
      return res.status(404).json({ error: 'Usuario sin tenant SaaS provisionado', provisioned: false });
    }
    res.json({ provisioned: true, profile: toPayload(tenant) });
  } catch (error) {
    console.error('[saasBootstrapRoutes] GET error:', error.message);
    res.status(500).json({ error: 'Error obteniendo el perfil de negocio' });
  }
});

/**
 * POST /api/saas/bootstrap
 * Provisiona el tenant del usuario a partir de su salón. Idempotente.
 * Body: { plan?: 'FREE_TRIAL'|'FREEMIUM'|'BASIC'|'PRO'|'ENTERPRISE', name?: string }
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const existing = await findTenant(req.user.id);
    if (existing) {
      return res.status(200).json({ provisioned: true, created: false, profile: toPayload(existing) });
    }

    const plan = (req.body?.plan || 'FREE_TRIAL').toUpperCase();
    if (!VALID_PLANS.includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido', validPlans: VALID_PLANS });
    }

    const { rows: salones } = await pool.query(
      `SELECT id, nombre_salon FROM salones
       WHERE id_dueno = $1
       ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    );
    const salon = salones[0];
    if (!salon) {
      return res.status(409).json({
        error: 'El usuario no tiene un salón registrado; crea el salón antes de provisionar el tenant SaaS',
      });
    }

    const verticalId = await resolveVerticalId();
    if (!verticalId) {
      return res.status(409).json({ error: 'No hay verticales de negocio configurados (business_verticals vacío)' });
    }

    const name = (req.body?.name || salon.nombre_salon || '').toString().trim().slice(0, 150);
    if (name.length < 2) {
      return res.status(400).json({ error: 'Nombre de negocio inválido' });
    }

    const profileId = `salon-${salon.id}`.slice(0, 36);
    const membershipId = crypto.randomUUID();
    const tenantId = `tenant-${salon.id}`.slice(0, 64);

    await client.query('BEGIN');

    const { rows: inserted } = await client.query(
      `INSERT INTO business_profiles
         (id, provider_id, vertical_id, name, onboarding_mode, lifecycle_stage,
          compliance_score, city, country, tenant_id, saas_plan)
       VALUES ($1, $2, $3, $4, 'EXISTING_BUSINESS', 'OPERATION', 45.00, 'Bogotá', 'Colombia', $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         saas_plan = COALESCE(business_profiles.saas_plan, EXCLUDED.saas_plan),
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, name, saas_plan, tenant_id`,
      [profileId, req.user.id, verticalId, name, tenantId, plan]
    );

    await client.query(
      `INSERT INTO memberships
         (id, user_id, business_profile_id, role, status, accepted_at, created_by_user_id)
       VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP, $2)
       ON CONFLICT (user_id, business_profile_id) DO UPDATE SET
         role = 'OWNER',
         status = 'ACTIVE',
         accepted_at = COALESCE(memberships.accepted_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP`,
      [membershipId, req.user.id, profileId]
    );

    await client.query('COMMIT');

    const tenant = await findTenant(req.user.id);
    console.log(`[saasBootstrap] Tenant provisionado para usuario ${req.user.id} → ${inserted[0].id} (${plan})`);

    res.status(201).json({
      provisioned: true,
      created: true,
      profile: toPayload(tenant || {
        business_profile_id: inserted[0].id,
        name: inserted[0].name,
        saas_plan: inserted[0].saas_plan,
        role: 'OWNER',
        membership_id: membershipId,
        tenant_id: inserted[0].tenant_id,
      }),
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* la transacción pudo no haberse abierto */
    }
    console.error('[saasBootstrapRoutes] POST error:', error.message);
    res.status(500).json({ error: 'Error provisionando el tenant SaaS', detail: error.message });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/saas/bootstrap:
 *   get:
 *     summary: Tenant SaaS activo del usuario autenticado
 *     description: |
 *       Devuelve el business_profile y el rol del usuario dentro del tenant.
 *       Responde 404 con `provisioned: false` cuando el usuario todavía no tiene
 *       membership activa (caso típico: salón creado sin perfil SaaS).
 *     operationId: get_api_saas_bootstrap
 *     tags: [saas]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Tenant provisionado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 provisioned: { type: boolean, example: true }
 *                 profile:
 *                   $ref: '#/components/schemas/SaasBootstrapProfile'
 *       401:
 *         description: Token ausente o inválido
 *       404:
 *         description: Usuario sin tenant provisionado
 *       500:
 *         description: Error resolviendo el perfil
 *   post:
 *     summary: Provisiona el tenant SaaS desde el salón del usuario
 *     description: |
 *       Idempotente. Si el usuario ya tiene membership activa devuelve 200 con
 *       `created: false`. En caso contrario crea el `business_profile` a partir de
 *       su salón y una membership `OWNER`, y devuelve 201 con `created: true`.
 *       Requiere que el usuario tenga un salón registrado y que exista al menos
 *       una vertical de negocio.
 *     operationId: post_api_saas_bootstrap
 *     tags: [saas]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               plan:
 *                 type: string
 *                 enum: [FREE_TRIAL, FREEMIUM, BASIC, PRO, ENTERPRISE]
 *                 default: FREE_TRIAL
 *               name:
 *                 type: string
 *                 maxLength: 150
 *     responses:
 *       201:
 *         description: Tenant creado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 provisioned: { type: boolean, example: true }
 *                 created: { type: boolean, example: true }
 *                 profile:
 *                   $ref: '#/components/schemas/SaasBootstrapProfile'
 *       200:
 *         description: Tenant ya existente (no se creó nada)
 *       400:
 *         description: Plan o nombre inválido
 *       409:
 *         description: Sin salón registrado o sin verticales configurados
 *       500:
 *         description: Error provisionando el tenant
 *
 * components:
 *   schemas:
 *     SaasBootstrapProfile:
 *       type: object
 *       properties:
 *         id: { type: string, example: salon-42 }
 *         name: { type: string, example: Salón Glow }
 *         plan: { type: string, example: FREE_TRIAL }
 *         role: { type: string, example: OWNER }
 *         membershipId: { type: string, format: uuid }
 *         tenantId: { type: string, example: tenant-42 }
 */
module.exports = router;
