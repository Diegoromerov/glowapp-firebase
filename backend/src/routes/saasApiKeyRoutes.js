// backend/src/routes/saasApiKeyRoutes.js
const express = require('express');
const { pool } = require('../config/db');
const saasContext = require('../middleware/saasContext');
const { requireEntitlement, requireRole } = require('../middleware/featureGate');
const { authMiddleware } = require('../middleware/auth');
const crypto = require('crypto');

const router = express.Router();

router.use(authMiddleware);
router.use(saasContext);

/**
 * GET /api/saas/api-keys
 * Lista API keys del tenant
 * Requiere: ADMIN u OWNER
 */
router.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { rows } = await pool.query(`
      SELECT id, name, key_prefix, scopes, last_used_at, expires_at, 
             created_at, revoked_at, created_by
      FROM api_keys
      WHERE tenant_id = $1
      ORDER BY created_at DESC;
    `, [req.saas.tenantId]);

    res.json({
      tenantId: req.saas.tenantId,
      apiKeys: rows.map(k => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.key_prefix,
        scopes: k.scopes,
        lastUsedAt: k.last_used_at,
        expiresAt: k.expires_at,
        createdAt: k.created_at,
        revokedAt: k.revoked_at,
        isActive: !k.revoked_at && (!k.expires_at || new Date(k.expires_at) > new Date()),
        createdBy: k.created_by
      }))
    });
  } catch (error) {
    console.error('[saasApiKeyRoutes] Error listing API keys:', error.message);
    res.status(500).json({ error: 'Error listando API keys' });
  }
});

/**
 * POST /api/saas/api-keys
 * Crea nueva API key
 * Requiere: ADMIN u OWNER + entitlement CUSTOM_BRANDING (proxy para API access)
 */
router.post('/', requireRole('ADMIN'), requireEntitlement('CUSTOM_BRANDING'), async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { name, scopes = ['read'], expiresInDays = 365 } = req.body;

    if (!name || name.trim().length < 3) {
      return res.status(400).json({ error: 'Nombre requerido (mín. 3 caracteres)' });
    }

    const validScopes = ['read', 'write', 'webhooks', 'admin'];
    const invalidScopes = scopes.filter(s => !validScopes.includes(s));
    if (invalidScopes.length > 0) {
      return res.status(400).json({ error: 'Scopes inválidos', invalidScopes, validScopes });
    }

    // Generar key: gsk_live_<random> (GlowApp Secret Key)
    const rawKey = `gsk_live_${crypto.randomBytes(24).toString('base64url')}`;
    const keyPrefix = rawKey.substring(0, 12) + '...';
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const { rows } = await pool.query(`
      INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix, scopes, expires_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, key_prefix, scopes, expires_at, created_at;
    `, [req.saas.tenantId, name.trim(), keyHash, keyPrefix, scopes, expiresAt, req.user.id]);

    // DEVOLVER LA KEY COMPLETA UNA SOLA VEZ
    res.status(201).json({
      message: 'API key creada. Guárdala ahora, no se volverá a mostrar.',
      apiKey: {
        id: rows[0].id,
        name: rows[0].name,
        key: rawKey, // SOLO AQUÍ
        keyPrefix: rows[0].key_prefix,
        scopes: rows[0].scopes,
        expiresAt: rows[0].expires_at,
        createdAt: rows[0].created_at
      }
    });
  } catch (error) {
    console.error('[saasApiKeyRoutes] Error creating API key:', error.message);
    res.status(500).json({ error: 'Error creando API key' });
  }
});

/**
 * PATCH /api/saas/api-keys/:keyId
 * Actualiza API key (nombre, scopes, expiración)
 * Requiere: ADMIN u OWNER
 */
router.patch('/:keyId', requireRole('ADMIN'), async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { keyId } = req.params;
    const { name, scopes, expiresInDays } = req.body;

    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (name !== undefined) {
      if (name.trim().length < 3) {
        return res.status(400).json({ error: 'Nombre muy corto' });
      }
      updates.push(`name = $${paramIdx++}`);
      values.push(name.trim());
    }

    if (scopes !== undefined) {
      const validScopes = ['read', 'write', 'webhooks', 'admin'];
      const invalidScopes = scopes.filter(s => !validScopes.includes(s));
      if (invalidScopes.length > 0) {
        return res.status(400).json({ error: 'Scopes inválidos', invalidScopes, validScopes });
      }
      updates.push(`scopes = $${paramIdx++}`);
      values.push(scopes);
    }

    if (expiresInDays !== undefined) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
      updates.push(`expires_at = $${paramIdx++}`);
      values.push(expiresAt);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(req.saas.tenantId, keyId);

    const { rows } = await pool.query(`
      UPDATE api_keys
      SET ${updates.join(', ')}
      WHERE tenant_id = $${paramIdx++} AND id = $${paramIdx} AND revoked_at IS NULL
      RETURNING id, name, key_prefix, scopes, expires_at, updated_at;
    `, values);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'API key no encontrada o revocada' });
    }

    res.json({ message: 'API key actualizada', apiKey: rows[0] });
  } catch (error) {
    console.error('[saasApiKeyRoutes] Error updating API key:', error.message);
    res.status(500).json({ error: 'Error actualizando API key' });
  }
});

/**
 * POST /api/saas/api-keys/:keyId/revoke
 * Revoca API key
 * Requiere: ADMIN u OWNER
 */
router.post('/:keyId/revoke', requireRole('ADMIN'), async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { keyId } = req.params;

    const { rows } = await pool.query(`
      UPDATE api_keys
      SET revoked_at = NOW(), revoked_by = $1
      WHERE tenant_id = $2 AND id = $3 AND revoked_at IS NULL
      RETURNING id, name, revoked_at;
    `, [req.user.id, req.saas.tenantId, keyId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'API key no encontrada o ya revocada' });
    }

    res.json({ message: 'API key revocada', apiKey: rows[0] });
  } catch (error) {
    console.error('[saasApiKeyRoutes] Error revoking API key:', error.message);
    res.status(500).json({ error: 'Error revocando API key' });
  }
});

/**
 * DELETE /api/saas/api-keys/:keyId
 * Elimina API key revocada (purga)
 * Requiere: OWNER
 */
router.delete('/:keyId', requireRole('OWNER'), async (req, res) => {
  try {
    if (!req.saas) return res.status(401).json({ error: 'Contexto SaaS requerido' });

    const { keyId } = req.params;

    const { rows } = await pool.query(`
      DELETE FROM api_keys
      WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NOT NULL
      RETURNING id;
    `, [req.saas.tenantId, keyId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'API key no encontrada o no revocada (revoca primero)' });
    }

    res.json({ message: 'API key eliminada permanentemente' });
  } catch (error) {
    console.error('[saasApiKeyRoutes] Error deleting API key:', error.message);
    res.status(500).json({ error: 'Error eliminando API key' });
  }
});

/**
 * POST /api/saas/api-keys/verify
 * Verifica una API key (endpoint público para validar keys en requests)
 * NO requiere authMiddleware - se usa como middleware en otras rutas
 */
router.post('/verify', async (req, res) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey || !apiKey.startsWith('gsk_live_')) {
      return res.status(400).json({ valid: false, error: 'Formato de key inválido' });
    }

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const { rows } = await pool.query(`
      SELECT ak.*, bp.id as tenant_id, bp.name as tenant_name, bp.saas_plan
      FROM api_keys ak
      JOIN business_profiles bp ON bp.id = ak.tenant_id
      WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL
        AND (ak.expires_at IS NULL OR ak.expires_at > NOW());
    `, [keyHash]);

    if (rows.length === 0) {
      return res.status(401).json({ valid: false, error: 'API key inválida, expirada o revocada' });
    }

    const key = rows[0];

    // Actualizar last_used_at (async, no bloquear)
    pool.query(
      `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
      [key.id]
    ).catch(() => {});

    res.json({
      valid: true,
      tenant: {
        id: key.tenant_id,
        name: key.tenant_name,
        plan: key.saas_plan
      },
      scopes: key.scopes,
      keyName: key.name
    });
  } catch (error) {
    console.error('[saasApiKeyRoutes] Error verifying API key:', error.message);
    res.status(500).json({ valid: false, error: 'Error verificando API key' });
  }
});

/**
 * Middleware Express para proteger rutas con API Key
 * Uso: router.get('/webhook', apiKeyAuth(['webhooks']), controller);
 */
function apiKeyAuth(requiredScopes = []) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header requerido: Bearer gsk_live_...' });
    }

    const apiKey = authHeader.substring(7);
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    try {
      const { rows } = await pool.query(`
        SELECT ak.*, bp.id as tenant_id, bp.name as tenant_name, bp.saas_plan
        FROM api_keys ak
        JOIN business_profiles bp ON bp.id = ak.tenant_id
        WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL
          AND (ak.expires_at IS NULL OR ak.expires_at > NOW());
      `, [keyHash]);

      if (rows.length === 0) {
        return res.status(401).json({ error: 'API key inválida, expirada o revocada' });
      }

      const key = rows[0];

      // Verificar scopes
      if (requiredScopes.length > 0) {
        const hasScope = requiredScopes.some(s => key.scopes.includes(s));
        if (!hasScope) {
          return res.status(403).json({ 
            error: 'Scope insuficiente', 
            required: requiredScopes, 
            current: key.scopes 
          });
        }
      }

      // Poblar req para uso posterior
      req.apiKey = {
        id: key.id,
        name: key.name,
        scopes: key.scopes,
        tenantId: key.tenant_id,
        tenantName: key.tenant_name,
        plan: key.saas_plan
      };

      // Actualizar last_used_at (fire-and-forget)
      pool.query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [key.id]).catch(() => {});

      next();
    } catch (error) {
      console.error('[apiKeyAuth] Error:', error.message);
      res.status(500).json({ error: 'Error validando API key' });
    }
  };
}

module.exports = router;
module.exports.apiKeyAuth = apiKeyAuth;