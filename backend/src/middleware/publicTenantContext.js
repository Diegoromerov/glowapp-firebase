// backend/src/middleware/publicTenantContext.js
// Las rutas públicas leen el catálogo, que pertenece al tenant de plataforma.
// Sin este contexto, RLS falla cerrado y la app se ve vacía.

const { pool } = require('../config/db');

let cacheTenantPlataforma = null;

module.exports = async function publicTenantContext(req, res, next) {
  // Las rutas autenticadas ya fijan su propio contexto en tenantContext.js
  if (req.user) return next();

  try {
    if (cacheTenantPlataforma === null) {
      const { rows } = await pool.query('SELECT id FROM tenants WHERE es_plataforma ORDER BY id LIMIT 1');
      cacheTenantPlataforma = rows.length ? rows[0].id : null;
    }
    if (cacheTenantPlataforma !== null) {
      // set_config con is_local = false: persiste en la sesión de la conexión
      // para que todas las consultas de esta petición vean el tenant de plataforma
      await pool.query("SELECT set_config('app.tenant_id', $1, false)", [String(cacheTenantPlataforma)]);
    }
  } catch (err) {
    // No rompemos la petición: si falla la búsqueda del tenant, las tablas
    // sin contexto devolverán 0 filas (comportamiento seguro por defecto).
    console.warn('[publicTenantContext] No se pudo fijar tenant de plataforma:', err.message);
  }
  next();
};