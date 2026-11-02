const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../../config/jwt');
const { pool } = require('../../config/db');
const redisClient = require('../../config/redis');

/**
 * Middleware para proteger rutas administrativas.
 * Valida la existencia de un JWT válido y comprueba en base de datos que el rol
 * del usuario sea strictly 'ADMIN'.
 *
 * Utiliza la función RLS-safe app_usuario_identidad($1::integer) con fallback
 * a la tabla usuarios para evitar violaciones de aislamiento multi-tenant.
 */
async function authAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Acceso no autorizado. Se requiere token Bearer.' });
    }

    const token = authHeader.split(' ')[1].trim();

    // Verificación de token revocado en la lista negra de Redis con Fail-Closed
    if (redisClient && (redisClient.isReady || redisClient.isOpen)) {
      try {
        const isBlacklisted = await redisClient.get(`beauty:token_blacklist:${token}`);
        if (isBlacklisted) {
          return res.status(401).json({ error: 'Token revocado. Por favor inicie sesión de nuevo.' });
        }
      } catch (redisErr) {
        console.error('❌ Error Redis blacklist check (authAdmin):', redisErr.message);
        return res.status(503).json({ error: 'Servicio de autenticación no disponible (Redis).' });
      }
    }

    // Verificar firma y expiración del JWT
    let decoded;
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Sesión expirada. Por favor inicie sesión nuevamente.' });
      }
      return res.status(401).json({ error: 'Token de acceso inválido.' });
    }

    if (!decoded || !decoded.id) {
      return res.status(401).json({ error: 'Token de acceso malformado o incompleto.' });
    }

    // Límite absoluto de sesión de 12 horas desde la autenticación inicial
    const nowSec = Math.floor(Date.now() / 1000);
    if (decoded.session_start_at && (nowSec - decoded.session_start_at > 12 * 3600)) {
      return res.status(401).json({ error: 'Sesión expirada (límite máximo 12 horas alcanzado).' });
    }

    // Consulta RLS-safe del rol en la base de datos
    let userRes;
    try {
      userRes = await pool.query('SELECT rol, tenant_id FROM app_usuario_identidad($1::integer)', [decoded.id]);
    } catch (sqlErr) {
      try {
        userRes = await pool.query('SELECT rol, tenant_id FROM usuarios WHERE id = $1', [decoded.id]);
      } catch (fallbackErr) {
        console.error('❌ Error al consultar usuario en DB (authAdmin):', fallbackErr.message);
        return res.status(401).json({ error: 'Usuario no encontrado en el sistema.' });
      }
    }

    if (!userRes || userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado en el sistema.' });
    }

    const dbRole = userRes.rows[0].rol;
    const dbTenantId = userRes.rows[0].tenant_id || null;

    // Validar que el rol devuelto por la base de datos sea estrictamente 'ADMIN'
    if (dbRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
    }

    req.admin = {
      id: decoded.id,
      email: decoded.email,
      rol: 'ADMIN',
      role: 'admin',
      tenant_id: dbTenantId
    };

    next();
  } catch (error) {
    console.error('Error en middleware authAdmin:', error);
    res.status(500).json({ error: 'Error interno al procesar autorización de administrador.' });
  }
}

module.exports = authAdmin;
