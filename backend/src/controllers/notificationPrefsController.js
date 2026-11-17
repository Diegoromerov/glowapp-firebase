// backend/src/controllers/notificationPrefsController.js
// Preferencias de notificaciones por usuario

const { pool } = require('../config/db');
const { runInTenantTransaction } = require('../config/tenantRouting');

/**
 * GET /api/notifications/prefs
 * Obtiene preferencias del usuario autenticado
 */
async function getNotificationPrefs(req, res) {
  const usuarioId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT evento_tipo, canal, habilitado, metadata
         FROM usuario_notificaciones_prefs
         WHERE usuario_id = $1
         ORDER BY evento_tipo, canal`,
        [usuarioId]
      );

      // Agrupar por evento_tipo para UI más cómoda
      const grouped = {};
      for (const r of rows) {
        if (!grouped[r.evento_tipo]) grouped[r.evento_tipo] = {};
        grouped[r.evento_tipo][r.canal] = {
          habilitado: r.habilitado,
          metadata: r.metadata,
        };
      }

      res.json({ success: true, data: grouped });
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/notifications/prefs:', error);
    res.status(500).json({ error: 'Error al obtener preferencias' });
  }
}

/**
 * POST /api/notifications/prefs
 * Actualiza preferencias (body: { evento_tipo, canal, habilitado, metadata? })
 * También acepta array de cambios: { cambios: [{evento_tipo, canal, habilitado, metadata?}] }
 */
async function updateNotificationPrefs(req, res) {
  const usuarioId = req.user.id;
  const tenantId = req.user.tenant_id;
  const { cambios, evento_tipo, canal, habilitado, metadata } = req.body;

  const updates = cambios || (evento_tipo && canal && typeof habilitado === 'boolean'
    ? [{ evento_tipo, canal, habilitado, metadata }]
    : []);

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Formato inválido: usar {cambios: [...]} o {evento_tipo, canal, habilitado}' });
  }

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      const resultados = [];

      for (const c of updates) {
        const { evento_tipo: et, canal: cn, habilitado: hab, metadata: meta } = c;
        if (!et || !cn || typeof hab !== 'boolean') {
          resultados.push({ evento_tipo: et, canal: cn, ok: false, error: 'Campos requeridos: evento_tipo, canal, habilitado' });
          continue;
        }

        const resUpsert = await client.query(
          `INSERT INTO usuario_notificaciones_prefs (usuario_id, evento_tipo, canal, habilitado, metadata)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (usuario_id, evento_tipo, canal) DO UPDATE SET
             habilitado = EXCLUDED.habilitado,
             metadata = EXCLUDED.metadata,
             actualizado_en = NOW()
           RETURNING *`,
          [usuarioId, et, cn, hab, JSON.stringify(meta || {})]
        );

        resultados.push({ evento_tipo: et, canal: cn, ok: true, data: resUpsert.rows[0] });
      }

      res.json({ success: true, data: resultados });
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/notifications/prefs:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error al actualizar preferencias' });
  }
}

/**
 * POST /api/notifications/prefs/reset
 * Resetea a valores por defecto (opt-in para críticos push/email, sms solo críticos)
 */
async function resetNotificationPrefs(req, res) {
  const usuarioId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      // Borrar preferencias actuales
      await client.query(`DELETE FROM usuario_notificaciones_prefs WHERE usuario_id = $1`, [usuarioId]);

      // Re-insertar defaults (mismo seed que migración 170)
      await client.query(
        `INSERT INTO usuario_notificaciones_prefs (usuario_id, evento_tipo, canal, habilitado)
         SELECT $1, e.evento_tipo, c.canal,
           CASE
             WHEN e.evento_tipo IN ('FALLIDO','DEVUELTO','SALIDA_ENTREGA') AND c.canal = 'sms' THEN true
             WHEN c.canal IN ('push','email') THEN true
             ELSE false
           END
         FROM (VALUES
           ('CREADO'), ('RECOGIDO'), ('EN_TRANSITO'), ('EN_CENTRO_DESTINO'),
           ('SALIDA_ENTREGA'), ('ENTREGADO'), ('FALLIDO'), ('DEVUELTO'),
           ('DEVOLUCION_SOLICITADA'), ('DEVOLUCION_APROBADA'), ('DEVOLUCION_RECHAZADA'),
           ('DEVOLUCION_RECIBIDA'), ('DEVOLUCION_REEMBOLSADA')
         ) AS e(evento_tipo)
         CROSS JOIN (VALUES ('push'), ('email'), ('sms')) AS c(canal)
         ON CONFLICT DO NOTHING`,
        [usuarioId]
      );

      res.json({ success: true, data: { message: 'Preferencias reseteadas a valores por defecto' } });
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/notifications/prefs/reset:', error);
    res.status(500).json({ error: 'Error al resetear preferencias' });
  }
}

module.exports = {
  getNotificationPrefs,
  updateNotificationPrefs,
  resetNotificationPrefs,
};