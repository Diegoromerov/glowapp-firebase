// backend/src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { getJwtSecret, toApiRole } = require('../config/jwt');
const redisClient = require('../config/redis');
const tenantContext = require('./tenantContext');

// Fail-closed POR DEFECTO (AUD-INFRA-01 #14): la comprobación del blacklist de
// tokens sólo puede obviarse cuando NODE_ENV es EXPLÍCITAMENTE 'development' o
// 'test'. Cualquier otro valor —ausente, 'staging', un typo— cierra con 503.
// Antes el guard exigía `NODE_ENV === 'production'`, así que un despliegue mal
// configurado quedaba fail-open y los tokens revocados seguían funcionando.
const FAIL_OPEN_ENVS = new Set(['development', 'test']);
const isFailOpenEnv = () => FAIL_OPEN_ENVS.has(process.env.NODE_ENV);
const REDIS_UNAVAILABLE_MSG =
  'Servicio de autenticación no disponible: no se puede verificar la revocación de tokens. Intente de nuevo en unos segundos.';

// 1. Middleware para verificar autenticación
const authMiddleware = async (req, res, next) => {
  // If req.user is already set (e.g., by test mock), skip verification
  if (req.user) {
    return next();
  }
  const authHeader = req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Se requiere autenticación.' });

  try {
    // Verificación de token revocado (blacklist en Redis).
    // Fail-closed por defecto: si no se puede CONSULTAR la blacklist, se rechaza
    // la petición en vez de dejar pasar un token potencialmente revocado.
    const redisUp = Boolean(redisClient && redisClient.isReady);
    if (!redisUp) {
      if (isFailOpenEnv()) {
        console.warn('⚠️ Redis deshabilitado en dev/test: se omite la verificación de tokens revocados (fail-open explícito).');
      } else {
        return res.status(503).json({ error: REDIS_UNAVAILABLE_MSG });
      }
    } else {
      try {
        const isBlacklisted = await redisClient.get(`beauty:token_blacklist:${token}`);
        if (isBlacklisted) {
          return res.status(401).json({ error: 'Token revocado. Por favor inicie sesión de nuevo.' });
        }
      } catch (redisErr) {
        if (isFailOpenEnv()) {
          console.warn('⚠️ Redis deshabilitado en dev/test: blacklist no consultable:', redisErr.message);
        } else {
          return res.status(503).json({ error: REDIS_UNAVAILABLE_MSG });
        }
      }
    }

    const verified = jwt.verify(token, getJwtSecret());

    // Resolver la identidad SÓLO por la función SECURITY DEFINER
    // `app_usuario_identidad` (migración 068).
    //
    // NO reintroducir una lectura directa de `usuarios` filtrando por `id`
    // (SELECT rol FROM usuarios WHERE id = ...): con RLS+FORCE esa consulta corre
    // sin contexto de inquilino, devuelve 0 filas y convierte el arranque de
    // identidad en un 401 global para TODOS los usuarios.
    // Lo fija `tests/rls_usuarios_isolation.nodetest.js`. Si la función no está
    // disponible, se falla CERRADO (503) en vez de degradar a una lectura rota.
    let userRes;
    try {
      userRes = await pool.query('SELECT rol, tenant_id FROM app_usuario_identidad($1::integer)', [verified.id]);
    } catch (sqlErr) {
      console.error('❌ app_usuario_identidad no disponible — no se puede resolver la identidad:', sqlErr.message);
      return res.status(503).json({
        error: 'Servicio de autenticación no disponible: no se pudo resolver la identidad del usuario.',
      });
    }

    if (!userRes || userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado en el sistema.' });
    }

    const dbRole = userRes.rows[0].rol;
    const dbTenantId = userRes.rows[0].tenant_id || null;

    // AISLAMIENTO DE TENANT (fix P0 — tarjeta t_fix_tenant_04)
    // -------------------------------------------------------
    // authMiddleware NO debe fijar `app.tenant_id` sobre la conexión del pool.
    // El bloque anterior (`set_config($1, $2, false)`) era de alcance SESIÓN
    // (is_local = false): el ajuste sobrevivía al fin de la petición y quedaba
    // pegado a la conexión que volvía al pool. Cualquier petición posterior que
    // reutilizara esa conexión —antes de fijar su propio contexto, o en un
    // camino no autenticado— heredaba el tenant anterior: fuga cross-tenant.
    //
    // El contexto de tenant se establece de forma TRANSACCIONAL (is_local = true)
    // sobre una conexión DEDICADA, por la capa de enrutado de tenant
    // (config/tenantRouting.js + middleware/tenantContext.js), que además
    // redirige las consultas hechas con este `pool` a ESA conexión. Aquí solo se
    // publica el tenant en `req.user` para que esa capa lo aplique.
    //
    // NO reintroducir aquí un set_config de sesión. El test
    // `src/tests/tenantAuthIsolation.test.js` falla si vuelve.

    const rawBpId = verified.businessProfileId;
    const sanitizedBpId = (rawBpId && String(rawBpId).trim() !== 'null' && String(rawBpId).trim() !== 'undefined' && String(rawBpId).trim() !== '')
      ? String(rawBpId).trim()
      : null;

    req.user = {
      id: verified.id,
      email: verified.email,
      role: toApiRole(dbRole),
      // `req.user.rol` se leía en dos sitios sin que nadie lo seteara, así que el guard
      // de consentimiento biométrico nunca pasaba (A360-2026-09-22/A-01).
      rol: dbRole,
      tenant_id: dbTenantId,
      businessProfileId: sanitizedBpId,
      token
    };

    // El contexto de inquilino se establece AQUÍ, que es el único punto donde se
    // conoce: tenantContext abre la conexión DEDICADA, ejecuta BEGIN y fija
    // app.tenant_id dentro de la transacción; a partir de ahí config/db.js enruta
    // las consultas de la petición a esa conexión. Toda ruta que use authMiddleware
    // queda cubierta sin tocar 44 routers.
    //
    // Sin esto el middleware nunca se ejecutaba y las políticas de 068 evaluaban
    // `tenant_id = app_current_tenant_id()` con el ajuste ausente, es decir
    // `tenant_id = NULL`: 0 filas en toda tabla con tenant_id para cualquier rol
    // sin BYPASSRLS (el caso del rol de la aplicación en CI y en cualquier
    // despliegue que no use el superusuario).
    //
    // Nunca se fija aquí un set_config de SESIÓN: eso es una fuga cross-tenant y
    // `src/tests/tenantAuthIsolation.test.js` falla si se reintroduce.
    if (req.user.tenant_id) {
      return tenantContext(req, res, next);
    }

    next();
  } catch (err) {
    console.error('❌ Error en authMiddleware:', err.message);
    res.status(400).json({ error: 'Token inválido o expirado.' });
  }
};

// 2. Middleware para verificar que el usuario sea admin
const adminMiddleware = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Acceso denegado. Autenticación requerida.' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Se requieren privilegios de administrador.' });
  }

  next();
};

// 3. EXPORTAR AMBOS COMO UN OBJETO
module.exports = {
  authMiddleware,
  adminMiddleware,
  verifyToken: authMiddleware
};
