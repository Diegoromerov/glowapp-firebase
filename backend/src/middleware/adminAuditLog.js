/**
 * GLOWAPP ADMIN AUDIT LOG MIDDLEWARE
 * FIX-FLUTTER-10 (P2) — Trazabilidad de acciones sensibles de administración.
 *
 * Registra de forma append-only, al terminar la respuesta, quién ejecutó la
 * acción (user_id), qué hizo (action), sobre qué (resource / resource_id),
 * cuándo (timestamp), desde dónde (ip) y con qué cliente (user_agent).
 *
 * Uso en una ruta:
 *   router.put('/admin/evidence/:id', authMiddleware, adminMiddleware,
 *     adminAuditLog((req) => `evidence.${String(req.body.action).toLowerCase()}`, 'evidence'),
 *     controller.reviewEvidence);
 *   // o, equivalente:
 *   adminAuditLog({ action: 'document.generate', resource: 'document' })
 *
 * El registro NUNCA debe bloquear ni tumbar la petición: si la persistencia
 * falla, se reporta por consola y la respuesta sigue su curso. La ausencia de
 * traza se ve, pero el admin no se queda sin acción.
 */

// Contrato mínimo de campos exigido por FIX-FLUTTER-10.
const REQUIRED_FIELDS = ['user_id', 'action', 'resource', 'resource_id', 'ip', 'user_agent', 'timestamp'];

/** IP del cliente: prioriza el proxy (x-forwarded-for / x-real-ip), luego req.ip. */
function clientIp(req) {
  const headers = (req && req.headers) || {};
  const forwarded = headers['x-forwarded-for'] || headers['x-real-ip'];
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  if (req && req.ip) return req.ip;
  if (req && req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  if (req && req.connection && req.connection.remoteAddress) return req.connection.remoteAddress;
  return 'unknown';
}

/** La acción puede ser una constante o derivarse de la petición (p.ej. APPROVED/REJECTED). */
function resolveAction(action, req) {
  if (typeof action === 'function') {
    try {
      return action(req) || 'unknown';
    } catch (err) {
      return 'unknown';
    }
  }
  return action || 'unknown';
}

/** Construye el registro con TODOS los campos del contrato. */
function buildAuditRecord(req, res, { action, resource } = {}) {
  const user = (req && req.user) || {};
  const params = (req && req.params) || {};
  const body = (req && req.body) || {};
  const statusCode = res && Number.isFinite(res.statusCode) ? res.statusCode : null;

  return {
    user_id: user.id != null ? user.id : (user.user_id != null ? user.user_id : (user.sub != null ? user.sub : 'anonymous')),
    action: resolveAction(action, req),
    resource: resource || 'unknown',
    resource_id: params.id || params.evidenceId || params.userId || body.id || body.evidenceId || null,
    method: (req && req.method) || null,
    path: (req && (req.originalUrl || req.url)) || null,
    status_code: statusCode,
    ip: clientIp(req),
    user_agent: ((req && req.headers && req.headers['user-agent']) || 'unknown'),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Fábrica. `sink` permite inyectar el destino en pruebas; por defecto persiste
 * en admin_audit_logs vía el repositorio.
 */
function createAdminAuditMiddleware({ sink, onError } = {}) {
  const persist = sink || ((record) => require('../repositories/adminAuditRepository').insertAdminAuditLog(record));
  const reportError = onError || ((err, record) => {
    const action = record ? record.action : 'build';
    console.error(`[adminAuditLog] no se pudo registrar la acción '${action}': ${err && err.message}`);
  });

  return function adminAuditLog(actionOrOptions, maybeResource) {
    const isOptionsObject = actionOrOptions
      && typeof actionOrOptions === 'object'
      && typeof actionOrOptions !== 'function';
    const options = isOptionsObject
      ? actionOrOptions
      : { action: actionOrOptions, resource: maybeResource };

    return function adminAuditLogMiddleware(req, res, next) {
      const flush = () => {
        let record;
        try {
          record = buildAuditRecord(req, res, options);
        } catch (err) {
          reportError(err, null);
          return;
        }
        try {
          Promise.resolve(persist(record)).catch((err) => reportError(err, record));
        } catch (err) {
          reportError(err, record);
        }
      };

      try {
        if (res && typeof res.on === 'function') {
          res.on('finish', flush);
        } else {
          flush();
        }
      } catch (err) {
        reportError(err, null);
      }

      return next();
    };
  };
}

const adminAuditLog = createAdminAuditMiddleware();

module.exports = {
  adminAuditLog,
  createAdminAuditMiddleware,
  buildAuditRecord,
  resolveAction,
  clientIp,
  REQUIRED_FIELDS,
};
