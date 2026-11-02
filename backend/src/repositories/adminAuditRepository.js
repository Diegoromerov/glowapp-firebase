/**
 * GLOWAPP ADMIN AUDIT REPOSITORY
 * Persistencia append-only de acciones sensibles de administración.
 *
 * Solo INSERT (y lecturas filtradas): la tabla `admin_audit_logs` bloquea
 * UPDATE/DELETE con un trigger y revoca esos privilegios a los roles de app.
 * FIX-FLUTTER-10 (P2).
 */

const { pool, dbEnMemoria } = require('../config/db');

// Fallback en memoria (modo test/sin base) con la MISMA semántica append-only.
const memoryAdminAuditLogs = [];
let memorySeq = 0;

/** Normaliza el registro al contrato de columnas de `admin_audit_logs`. */
function normalizeRecord(record = {}) {
  const statusCode = Number(record.status_code);
  return {
    user_id: record.user_id != null && record.user_id !== '' ? String(record.user_id) : 'anonymous',
    action: String(record.action || 'unknown'),
    resource: String(record.resource || 'unknown'),
    resource_id: record.resource_id != null && record.resource_id !== '' ? String(record.resource_id) : null,
    method: record.method || null,
    path: record.path || null,
    status_code: Number.isFinite(statusCode) ? statusCode : null,
    ip: record.ip || null,
    user_agent: record.user_agent || null,
    metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata : {},
    created_at: record.timestamp || record.created_at || new Date().toISOString(),
  };
}

class AdminAuditRepository {
  /** Inserta una fila inmutable. Nunca hace UPDATE/DELETE. */
  async insertAdminAuditLog(record) {
    const entry = normalizeRecord(record);
    try {
      const res = await pool.query(
        `INSERT INTO admin_audit_logs
           (user_id, action, resource, resource_id, method, path, status_code, ip, user_agent, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          entry.user_id,
          entry.action,
          entry.resource,
          entry.resource_id,
          entry.method,
          entry.path,
          entry.status_code,
          entry.ip,
          entry.user_agent,
          JSON.stringify(entry.metadata),
          entry.created_at,
        ]
      );
      return res.rows[0];
    } catch (err) {
      // Si hay base disponible y la tabla existe, un fallo de escritura es real.
      // Si la tabla no existe (42P01) o estamos en modo memoria, se cae a memoria local.
      if (err?.code === '42P01' || String(err?.message).includes('does not exist') || dbEnMemoria(err)) {
        const row = { id: ++memorySeq, ...entry };
        memoryAdminAuditLogs.push(row);
        return row;
      }
      throw err;
    }
  }

  /** Lectura de auditoría (para E3/consulta). No muta nada. */
  async listAdminAuditLogs({ userId, action, resource, resourceId, limit = 100 } = {}) {
    const capped = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    try {
      const res = await pool.query(
        `SELECT * FROM admin_audit_logs
          WHERE ($1::text IS NULL OR user_id = $1)
            AND ($2::text IS NULL OR action = $2)
            AND ($3::text IS NULL OR resource = $3)
            AND ($4::text IS NULL OR resource_id = $4)
          ORDER BY created_at DESC
          LIMIT $5`,
        [userId || null, action || null, resource || null, resourceId || null, capped]
      );
      return res.rows;
    } catch (err) {
      if (err?.code === '42P01' || String(err?.message).includes('does not exist') || dbEnMemoria(err)) {
        return memoryAdminAuditLogs
          .filter((r) => (!userId || r.user_id === userId)
            && (!action || r.action === action)
            && (!resource || r.resource === resource)
            && (!resourceId || r.resource_id === resourceId))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, capped);
      }
      throw err;
    }
  }
}

module.exports = new AdminAuditRepository();
module.exports.normalizeRecord = normalizeRecord;
