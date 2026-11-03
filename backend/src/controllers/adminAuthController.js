// backend/src/controllers/adminAuthController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getJwtSecret } = require('../config/jwt');
const { pool } = require('../config/db');
const redisClient = require('../config/redis');

/**
 * POST /api/admin/auth/login
 * Inicio de sesión exclusivo para administradores.
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });
    }

    // 1. Buscar usuario por email
    const userRes = await pool.query(
      'SELECT id, email, password_hash, rol, nombre FROM usuarios WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    if (!userRes || userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const user = userRes.rows[0];

    // 2. Verificar contraseña con bcrypt
    let isValidPassword = false;
    if (user.password_hash) {
      try {
        isValidPassword = await bcrypt.compare(password, user.password_hash);
      } catch (_) {
        isValidPassword = false;
      }
    }

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    // 3. Consulta RLS-safe para verificar el rol en base de datos y obtener tenant_id
    let dbRole;
    let dbTenantId = null;
    try {
      const identRes = await pool.query('SELECT rol, tenant_id FROM app_usuario_identidad($1::integer)', [user.id]);
      if (identRes && identRes.rows.length > 0) {
        dbRole = identRes.rows[0].rol;
        dbTenantId = identRes.rows[0].tenant_id || null;
      }
    } catch (_) {
      dbRole = user.rol;
    }

    if (!dbRole) dbRole = user.rol;

    if (dbRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
    }

    // 4. Generar Access Token (15m) y Refresh Token (8h) con tope de sesión de 12h
    const jwtSecret = getJwtSecret();
    const sessionStartAt = Math.floor(Date.now() / 1000);

    const accessToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        rol: 'ADMIN',
        role: 'admin',
        tenant_id: dbTenantId,
        type: 'access',
        session_start_at: sessionStartAt
      },
      jwtSecret,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        rol: 'ADMIN',
        role: 'admin',
        tenant_id: dbTenantId,
        type: 'refresh',
        session_start_at: sessionStartAt
      },
      jwtSecret,
      { expiresIn: '8h' }
    );

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      admin: {
        id: user.id,
        email: user.email,
        nombre: user.nombre || 'Administrador',
        rol: 'ADMIN',
        role: 'admin',
        tenant_id: dbTenantId
      }
    });
  } catch (error) {
    console.error('❌ Error en login admin:', error);
    return res.status(500).json({ error: 'Error interno al procesar el inicio de sesión administrativo.' });
  }
};

/**
 * POST /api/admin/auth/refresh
 * Renovación de tokens administrativos.
 * Implementa protección de reutilización de refresh token y tope de sesión de 12h.
 */
exports.refresh = async (req, res) => {
  try {
    const refreshToken = req.body.refreshToken || (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token es requerido.' });
    }

    // 1. Verificar firma y expiración del refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, getJwtSecret());
    } catch (err) {
      return res.status(401).json({ error: 'Refresh token inválido o expirado.' });
    }

    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Token no es de tipo refresh.' });
    }

    // Tope absoluto de sesión de 12 horas
    const now = Math.floor(Date.now() / 1000);
    const sessionStartAt = decoded.session_start_at || now;
    if (now - sessionStartAt > 12 * 3600) {
      return res.status(401).json({ error: 'Sesión expirada (límite máximo 12 horas alcanzado).' });
    }

    // 2. Verificar si el refresh token ha sido revocado en la lista negra de Redis con Fail-Closed
    if (redisClient && (redisClient.isReady || redisClient.isOpen)) {
      try {
        const isBlacklisted = await redisClient.get(`beauty:token_blacklist:${refreshToken}`);
        if (isBlacklisted) {
          return res.status(401).json({ error: 'Refresh token revocado.' });
        }
      } catch (redisErr) {
        console.error('❌ Error Redis blacklist check (refresh):', redisErr.message);
        return res.status(503).json({ error: 'Servicio de autenticación no disponible (Redis).' });
      }
    }

    // 3. Protección contra reutilización: revocar el refresh token usado registrándolo en Redis
    const ttl = decoded.exp ? Math.max(decoded.exp - now, 60) : 8 * 3600;
    if (redisClient && (redisClient.isReady || redisClient.isOpen)) {
      try {
        await redisClient.setEx(`beauty:token_blacklist:${refreshToken}`, ttl, 'revoked');
      } catch (redisErr) {
        console.error('❌ Error al revocar refresh token en Redis:', redisErr.message);
        return res.status(503).json({ error: 'Servicio de autenticación no disponible (Redis).' });
      }
    }

    // 4. Verificar en BD que el usuario siga siendo ADMIN
    let userRes;
    try {
      userRes = await pool.query('SELECT rol, tenant_id FROM app_usuario_identidad($1::integer)', [decoded.id]);
    } catch (_) {
      try {
        userRes = await pool.query('SELECT rol, tenant_id FROM usuarios WHERE id = $1', [decoded.id]);
      } catch (fallbackErr) {
        return res.status(401).json({ error: 'Usuario no encontrado.' });
      }
    }

    if (!userRes || userRes.rows.length === 0 || userRes.rows[0].rol !== 'ADMIN') {
      return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
    }

    const dbTenantId = userRes.rows[0].tenant_id || null;
    const jwtSecret = getJwtSecret();

    // 5. Emitir nuevos tokens preservando session_start_at
    const newAccessToken = jwt.sign(
      {
        id: decoded.id,
        email: decoded.email,
        rol: 'ADMIN',
        role: 'admin',
        tenant_id: dbTenantId,
        type: 'access',
        session_start_at: sessionStartAt
      },
      jwtSecret,
      { expiresIn: '15m' }
    );

    const newRefreshToken = jwt.sign(
      {
        id: decoded.id,
        email: decoded.email,
        rol: 'ADMIN',
        role: 'admin',
        tenant_id: dbTenantId,
        type: 'refresh',
        session_start_at: sessionStartAt
      },
      jwtSecret,
      { expiresIn: '8h' }
    );

    return res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    console.error('❌ Error en refresh token admin:', error);
    return res.status(500).json({ error: 'Error interno al renovar sesión.' });
  }
};

/**
 * POST /api/admin/auth/logout
 * Cierre de sesión administrativo con revocación de tokens en la lista negra de Redis.
 */
exports.logout = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1].trim() : null;
    const refreshToken = req.body.refreshToken;

    const tokensToRevoke = [accessToken, refreshToken].filter(Boolean);

    for (const token of tokensToRevoke) {
      let ttl = 8 * 3600; // Default 8h
      try {
        const decoded = jwt.decode(token);
        if (decoded && decoded.exp) {
          const now = Math.floor(Date.now() / 1000);
          ttl = Math.max(decoded.exp - now, 60);
        }
      } catch (_) {}

      if (redisClient && (redisClient.isReady || redisClient.isOpen)) {
        try {
          await redisClient.setEx(`beauty:token_blacklist:${token}`, ttl, 'revoked');
        } catch (redisErr) {
          console.error('❌ Error Redis blacklist en logout admin:', redisErr.message);
          return res.status(503).json({ error: 'Servicio de autenticación no disponible (Redis).' });
        }
      }
    }

    return res.json({
      success: true,
      message: 'Sesión administrativa cerrada exitosamente.'
    });
  } catch (error) {
    console.error('❌ Error en logout admin:', error);
    return res.status(500).json({ error: 'Error interno al cerrar sesión.' });
  }
};

/**
 * GET /api/admin/auth/session
 * Retorna la información del administrador autenticado.
 */
exports.session = async (req, res) => {
  return res.json({
    success: true,
    admin: req.admin
  });
};
