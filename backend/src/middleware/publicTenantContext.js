// backend/src/middleware/publicTenantContext.js
//
// PROPÓSITO
// ---------
// Las rutas públicas leen el catálogo, que pertenece al tenant de plataforma
// (tenants.es_plataforma = true). Sin contexto, RLS falla cerrado y la app se
// ve vacía: ese era el síntoma de Fase 6.
//
// POR QUÉ NO SE USA set_config(..., false)
// ----------------------------------------
// La primera versión de este archivo hacía:
//
//     await pool.query("SELECT set_config('app.tenant_id', $1, false)", [id]);
//
// Eso es exactamente el defecto que tenantContext.js documenta como eliminado:
//
//   1. `pool.query` toma UNA conexión cualquiera del pool y la devuelve al
//      terminar. La consulta real de la ruta puede caer en OTRA conexión, que
//      no tiene el contexto: el catálogo vuelve vacío de forma intermitente.
//   2. Con is_local = false el ajuste PERSISTE en esa conexión. Al reutilizarla
//      otra petición —de otro inquilino— hereda el tenant de plataforma: es una
//      fuga cross-tenant.
//
// SOLUCIÓN
// --------
// Se reutiliza el mismo mecanismo que las rutas autenticadas: una conexión
// DEDICADA, una transacción real y set_config con is_local = true (el ajuste
// muere en el COMMIT/ROLLBACK). El pool exportado por config/db.js enruta las
// consultas a esa conexión vía AsyncLocalStorage (config/tenantRouting.js), así
// que los controladores no cambian.
//
// ALCANCE
// -------
// Solo rutas de lectura pública (providers, products, services). No se monta
// sobre todo /api: abrir una transacción por petición en login, webhooks o
// sondas encarecería y podría agotar el pool (max 30).

const { pool } = require('../config/db');
const tenantRouting = require('../config/tenantRouting');

let cacheTenantPlataforma = null;

async function obtenerTenantPlataforma() {
  if (cacheTenantPlataforma !== null) return cacheTenantPlataforma;

  const { rows } = await pool.query(
    'SELECT id FROM tenants WHERE es_plataforma ORDER BY id LIMIT 1'
  );
  cacheTenantPlataforma = rows.length ? rows[0].id : null;
  return cacheTenantPlataforma;
}

module.exports = async function publicTenantContext(req, res, next) {
  // Una petición autenticada ya fija su propio contexto en tenantContext.js.
  if (req.user) return next();

  // Dobles de test: un pool sin connect() no puede abrir conexión dedicada.
  // En producción esto no ocurre; si ocurriera, el fail-closed lo aplica
  // tenantContext en las rutas autenticadas.
  if (typeof pool.connect !== 'function') return next();

  let tenantId;
  try {
    tenantId = await obtenerTenantPlataforma();
  } catch (err) {
    // Sin tenant de plataforma no hay contexto: las políticas devuelven 0
    // filas (comportamiento seguro). No se rompe la petición.
    console.warn('[publicTenantContext] No se pudo resolver el tenant de plataforma:', err.message);
    return next();
  }

  if (tenantId === null || tenantId === undefined) return next();

  // Distingue un fallo AL MONTAR la transacción (500: no se puede servir con
  // seguridad) de un fallo de la cadena de aplicación (se reenvía a Express).
  let cadenaIniciada = false;

  try {
    await tenantRouting.runInTenantTransaction({ pool }, tenantId, () => {
      cadenaIniciada = true;
      return new Promise((resolve, reject) => {
        // La transacción se cierra cuando la respuesta termina. Las rutas de
        // catálogo son de solo lectura, así que no hay riesgo de que el cliente
        // lea su propia escritura antes del COMMIT.
        res.once('finish', resolve);
        res.once('close', resolve);
        next((err) => {
          if (err) reject(err);
        });
      });
    });
  } catch (err) {
    if (!cadenaIniciada) return next(err);
    if (res.headersSent) {
      console.error('[publicTenantContext] Error tras enviar la respuesta:', err.message);
      return res.end();
    }
    return next(err);
  }
};
