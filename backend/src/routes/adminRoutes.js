const { wrapRouterAsync } = require('../utils/expressAsync');
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db'); 
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { adminAuditLog } = require('../middleware/adminAuditLog');
const adminAuditRepository = require('../repositories/adminAuditRepository');

// 🔹 GET /api/admin/audit-logs — Obtener traza de auditoría append-only
router.get('/audit-logs', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, action, resource, resourceId, limit } = req.query;
    const logs = await adminAuditRepository.listAdminAuditLogs({
      userId,
      action,
      resource,
      resourceId,
      limit
    });
    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/audit-logs:', error);
    res.status(500).json({ error: 'Error al obtener registros de auditoría.' });
  }
});

// 🔹 Obtenes lista completa de disputas para panel administrativo
router.get('/disputes', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.id, d.booking_id, d.tipo_actor, d.tipo, d.descripcion, d.evidencia_urls, d.monto_disputado, d.estado, d.nota_resolucion, d.creado_at, d.sla_limite_at,
             u_init.nombre AS iniciado_por_nombre, u_init.email AS iniciado_por_email,
             u_client.nombre AS cliente_nombre, u_client.email AS cliente_email,
             u_prov.nombre AS prestador_nombre, u_prov.email AS prestador_email
      FROM disputas d
      JOIN usuarios u_init ON d.iniciado_por = u_init.id
      JOIN bookings b ON d.booking_id = b.id
      JOIN usuarios u_client ON b.client_id = u_client.id
      JOIN usuarios u_prov ON b.provider_id = u_prov.id
      ORDER BY d.creado_at DESC;
    `);
    res.json({
      success: true,
      disputes: result.rows
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/disputes:', error);
    res.status(500).json({ error: 'Error al obtener lista de disputas.' });
  }
});

// 🔹 Resolver disputa y dictaminar porcentaje de fondos
router.patch('/disputes/:id/resolve', authMiddleware, adminMiddleware, adminAuditLog({ action: 'dispute.resolve', resource: 'dispute' }), async (req, res) => {
  try {
    const disputeId = req.params.id;
    const adminId = req.user.id;
    const { resolucion, porcentaje_prestador, nota_resolucion } = req.body;

    if (!resolucion || porcentaje_prestador === undefined || !nota_resolucion) {
      return res.status(400).json({ error: 'Todos los campos de resolución son requeridos.' });
    }

    const pct = parseFloat(porcentaje_prestador);

    const checkDispute = await pool.query('SELECT * FROM disputas WHERE id = $1', [disputeId]);
    if (checkDispute.rows.length === 0) {
      return res.status(404).json({ error: 'Disputa no encontrada.' });
    }

    const dispute = checkDispute.rows[0];

    const result = await pool.query(`
      UPDATE disputas
      SET estado = 'RESUELTA',
          resuelto_por = $1,
          resolucion = $2,
          porcentaje_prestador = $3,
          nota_resolucion = $4,
          resuelto_at = NOW(),
          actualizado_at = NOW()
      WHERE id = $5
      RETURNING *;
    `, [adminId, resolucion, pct, nota_resolucion, disputeId]);

    const finalBookingStatus = pct > 0 ? 'COMPLETADA' : 'CANCELADA';
    await pool.query(`
      UPDATE bookings
      SET estado = $1
      WHERE id = $2;
    `, [finalBookingStatus, dispute.booking_id]);

    res.json({
      success: true,
      message: 'Disputa resuelta con éxito.',
      dispute: result.rows[0]
    });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/admin/disputes/:id/resolve:', error);
    res.status(500).json({ error: 'Error al resolver la disputa.' });
  }
});

// 🔹 GET /api/admin/providers/fiscal — Responsabilidad de IVA de los prestadores
//
// Alimenta la vista «Prestadores · IVA» del panel (fase 4 del plan de captura de
// la responsabilidad de IVA; hallazgo W13 de .hermes/REVISAR.md).
//
// `?estado=` acepta: todos (por defecto), sin_declarar, declarado, override.
// Los tres estados son mutuamente excluyentes y cubren TODAS las filas:
//   MANUAL       — un admin fijó el valor a mano (D1); manda sobre el RUT.
//   DECLARADA    — declaró el código de su RUT y no hay override.
//   SIN_DECLARAR — ni RUT ni override: no se presume responsable (D3).
router.get('/providers/fiscal', authMiddleware, adminMiddleware, async (req, res) => {
  const FILTROS = {
    todos: '',
    sin_declarar: 'AND u.rut_responsabilidad_codigo IS NULL AND u.responsable_iva_override IS NULL',
    declarado: 'AND u.rut_responsabilidad_codigo IS NOT NULL AND u.responsable_iva_override IS NULL',
    override: 'AND u.responsable_iva_override IS NOT NULL',
  };

  const estado = String(req.query.estado || 'todos');
  if (!Object.prototype.hasOwnProperty.call(FILTROS, estado)) {
    return res.status(400).json({
      error: `Estado no reconocido: '${estado}'.`,
      estados_validos: Object.keys(FILTROS),
    });
  }

  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.nombre, u.email, u.rut_numero,
             u.rut_responsabilidad_codigo, u.responsable_iva,
             u.responsable_iva_override, u.responsabilidad_iva_fuente,
             u.responsabilidad_iva_actualizada_at,
             u.responsabilidad_iva_cambiada_por,
             admin.nombre AS cambiada_por_nombre
      FROM usuarios u
      LEFT JOIN usuarios admin ON admin.id = u.responsabilidad_iva_cambiada_por
      WHERE u.rol = 'PRESTADOR' ${FILTROS[estado]}
      ORDER BY u.nombre ASC
    `);

    const prestadores = rows.map((r) => {
      // `false` explícito SÍ es un override (alguien lo apagó a mano): sólo NULL
      // significa «sin override».
      const hayOverride = r.responsable_iva_override !== null && r.responsable_iva_override !== undefined;
      return {
        id: r.id,
        nombre: r.nombre,
        email: r.email,
        rut_numero: r.rut_numero || null,
        rut_responsabilidad_codigo: r.rut_responsabilidad_codigo === null ? null : Number(r.rut_responsabilidad_codigo),
        responsable_iva: r.responsable_iva,
        override: hayOverride ? r.responsable_iva_override : null,
        fuente: r.responsabilidad_iva_fuente || null,
        actualizada_at: r.responsabilidad_iva_actualizada_at || null,
        cambiada_por: r.responsabilidad_iva_cambiada_por || null,
        cambiada_por_nombre: r.cambiada_por_nombre || null,
        estado: hayOverride
          ? 'MANUAL'
          : (r.rut_responsabilidad_codigo === null ? 'SIN_DECLARAR' : 'DECLARADA'),
      };
    });

    // El censo se cuenta sobre TODOS los prestadores, no sobre el subconjunto
    // filtrado: si no, los contadores de la cabecera serían un eco del filtro y
    // mentirían justo cuando el admin filtra para ver el alcance del problema.
    const censo = await pool.query(
      `SELECT rut_responsabilidad_codigo, responsable_iva_override
         FROM usuarios WHERE rol = 'PRESTADOR'`
    );
    const resumen = {
      total_prestadores: censo.rows.length,
      declarados: 0,
      sin_declarar: 0,
      override: 0,
    };
    for (const r of censo.rows) {
      if (r.responsable_iva_override !== null && r.responsable_iva_override !== undefined) resumen.override += 1;
      else if (r.rut_responsabilidad_codigo === null) resumen.sin_declarar += 1;
      else resumen.declarados += 1;
    }

    res.json({ success: true, estado, resumen, prestadores });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/providers/fiscal:', error);
    res.status(500).json({ error: 'Error al obtener la responsabilidad de IVA de los prestadores.' });
  }
});

wrapRouterAsync(router);
module.exports = router;