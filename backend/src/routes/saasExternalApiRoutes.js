// External SaaS API. This router deliberately has no user-session middleware:
// each request is authenticated by a tenant-owned API key.
const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { hasEntitlement } = require('../config/saasEntitlements');
const { getLimit, getMonthPeriod } = require('../config/saasCatalog');

const router = express.Router();

router.get('/services', async (req, res) => {
  const authorization = req.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Se requiere Authorization: Bearer <API_KEY>' });
  }
  const rawKey = authorization.slice(7).trim();
  if (!rawKey.startsWith('gsk_live_')) {
    return res.status(401).json({ error: 'API key inválida, expirada o revocada' });
  }

  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  let client;
  let transactionOpen = false;
  try {
    const keyResult = await pool.query('SELECT * FROM saas_api_key_lookup($1)', [keyHash]);
    const key = keyResult.rows[0];
    if (!key) return res.status(401).json({ error: 'API key inválida, expirada o revocada' });
    if (!hasEntitlement(key.saas_plan, 'API_KEYS')) {
      return res.status(403).json({ error: 'El plan actual no incluye integraciones con API' });
    }
    if (!Array.isArray(key.scopes) || !key.scopes.includes('read')) {
      return res.status(403).json({ error: 'La clave no tiene el scope requerido', required: ['read'] });
    }

    const limit = getLimit(key.saas_plan, 'API_CALLS');
    if (limit === 0) {
      return res.status(429).json({ error: 'El plan alcanzó el límite mensual de integraciones', current: 0, limit });
    }
    const { start, end } = getMonthPeriod();
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const pageSize = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;

    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    // usage_metrics and api_keys are isolated by canonical business profile.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(key.tenant_id)]);
    const usage = await client.query(`
      INSERT INTO usage_metrics (tenant_id, feature, period_start, period_end, count, "limit")
      VALUES ($1, 'API_CALLS', $2, $3, 1, $4)
      ON CONFLICT (tenant_id, feature, period_start)
      DO UPDATE SET count = usage_metrics.count + 1,
                    "limit" = EXCLUDED."limit",
                    updated_at = NOW()
      WHERE EXCLUDED."limit" IS NULL
         OR usage_metrics.count + 1 <= EXCLUDED."limit"
      RETURNING count`,
      [key.tenant_id, start, end, limit]);
    if (!usage.rows.length) {
      const current = await client.query(`
        SELECT count FROM usage_metrics
         WHERE tenant_id = $1 AND feature = 'API_CALLS' AND period_start = $2`,
        [key.tenant_id, start]);
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(429).json({
        error: 'Se alcanzó el límite mensual de integraciones del plan',
        current: Number(current.rows[0]?.count || 0), limit, currentPlan: key.saas_plan,
      });
    }

    await client.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [key.id]);
    // Legacy service rows use the salon owner's integer tenant_id. The query
    // also explicitly scopes by canonical profile or its owner to prevent leaks.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(key.legacy_tenant_id)]);
    const services = await client.query(`
      SELECT id, name, description, price, duration_minutes, category,
             is_active, business_profile_id, salon_id
        FROM services
       WHERE (business_profile_id = $1 OR provider_id = $2)
         AND is_active = TRUE
       ORDER BY name ASC, id ASC
       LIMIT $3`, [key.tenant_id, key.provider_id, pageSize]);

    await client.query('COMMIT');
    transactionOpen = false;
    return res.json({
      data: services.rows.map((service) => ({
        ...service,
        price: Number(service.price),
        duration_minutes: Number(service.duration_minutes),
      })),
      pagination: { limit: pageSize },
      usage: { current: Number(usage.rows[0].count), limit: limit === null ? 'unlimited' : limit },
    });
  } catch (error) {
    if (transactionOpen && client) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection cleanup */ }
    }
    console.error('[saasExternalApiRoutes] Error serving services:', error.message);
    return res.status(503).json({ error: 'No se pudo completar la solicitud de integración' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
