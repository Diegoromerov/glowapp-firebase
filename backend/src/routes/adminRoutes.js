const { wrapRouterAsync } = require('../utils/expressAsync');
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db'); 
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { adminAuditLog } = require('../middleware/adminAuditLog');
const adminAuditRepository = require('../repositories/adminAuditRepository');
const {
  ACCIONES,
  ESTADOS,
  transicionar,
  responsabilidadDesdeCodigo,
} = require('../services/fiscalRevision');
const fcmNotificationService = require('../services/fcmNotificationService');
const { notifyDisputeUsers } = require('../services/disputeNotifications');
const { validarEvidencias } = require('../utils/disputaEvidencias');

const UUID_DISPUTA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/users/profile?q=... — datos de cuenta no fiscales, para hoja de vida administrativa.
router.get('/users/profile', authMiddleware, adminMiddleware, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) return res.status(400).json({ success: false, error: 'Escribe al menos 2 caracteres para buscar.' });
  try {
    await pool.query('SET LOCAL ROLE app_system');
    const term = `%${q}%`;
    const { rows } = await pool.query(`
      SELECT id, nombre, email, phone, foto_url, ciudad, bio, slug,
             auth_provider, provider_id, rol, worker_type, onboarding_completo, is_active,
             email_verificado, creado_en, fecha_alta,
             habeas_data_accepted_at, habeas_data_ip, terminos_accepted_at, terminos_ip,
             tenant_id, estado_operativo, estado_operativo_desde, estado_operativo_motivo,
             referral_code, referred_by_user_id, referral_converted_at,
             glowai_plan, glowai_diagnosticos_mes, glowai_ciclo_reset_at,
             streak_actual, streak_maximo, streak_ultimo_registro, ultimo_nivel_notificado,
             colorimetria_diagnosticos_mes, colorimetria_mes_referencia,
             glowstyle_outfits_mes, glowstyle_mes_referencia,
             visibilidad_suspendida
        FROM usuarios
       WHERE (rol IS NULL OR rol::text NOT IN ('ADMIN', 'SUPERADMIN', 'admin', 'superadmin'))
         AND (nombre ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR id::text = $2)
       ORDER BY nombre ASC
       LIMIT 100
    `, [term, q]);
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/users/profile:', error);
    return res.status(500).json({ success: false, error: 'No se pudo consultar el perfil del usuario.' });
  }
});

// Oculta/restaura perfiles de proveedores sin afectar la autenticación de la cuenta.
router.patch('/users/:id/visibility', authMiddleware, adminMiddleware, adminAuditLog({ action: 'user.visibility.update', resource: 'user' }), async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const suspended = req.body?.suspended;
  if (!Number.isSafeInteger(id) || id <= 0 || typeof suspended !== 'boolean') {
    return res.status(400).json({ success: false, error: 'Solicitud de visibilidad inválida.' });
  }
  try {
    await pool.query('SET LOCAL ROLE app_system');
    const { rows } = await pool.query(`
      UPDATE usuarios
         SET visibilidad_suspendida = $1
       WHERE id = $2 AND rol::text IN ('PRESTADOR', 'SALON')
       RETURNING id, nombre, rol, visibilidad_suspendida
    `, [suspended, id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'No se encontró un perfil público de proveedor para actualizar.' });
    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/admin/users/:id/visibility:', error);
    return res.status(500).json({ success: false, error: 'No se pudo actualizar la visibilidad del perfil.' });
  }
});

// GET /api/admin/providers/profile?q=... — búsqueda y hoja de vida administrativa.
router.get('/providers/profile', authMiddleware, adminMiddleware, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) {
    return res.status(400).json({ success: false, error: 'Escribe al menos 2 caracteres para buscar.' });
  }

  try {
    const term = `%${q}%`;
    const { rows } = await pool.query(`
      SELECT u.id, u.nombre, u.email, u.phone, u.foto_url, u.rol,
             u.onboarding_completo, u.glowai_plan, u.glowai_diagnosticos_mes,
             u.glowai_ciclo_reset_at, u.streak_actual, u.streak_maximo,
             u.streak_ultimo_registro, u.is_active,
             u.rut_numero, u.rut_responsabilidad_codigo, u.responsable_iva,
             u.revision_estado AS rut_revision_estado,
             p.business_name, p.description, p.rating_avg, p.rating_count,
             p.estatus_verificacion, p.documento_id_url, p.certificacion_url,
             p.rut_url, p.is_active AS perfil_activo, p.active_start_hour,
             p.active_end_hour, p.weekly_schedule
        FROM usuarios u
        LEFT JOIN perfiles_prestador p ON p.id = u.id
       WHERE u.rol = 'PRESTADOR'
         AND (u.nombre ILIKE $1 OR u.rut_numero ILIKE $1 OR u.phone ILIKE $1)
       ORDER BY u.nombre ASC
       LIMIT 100
    `, [term]);

    return res.json({ success: true, count: rows.length, data: rows.map((row) => ({
      ...row,
      is_verified: row.estatus_verificacion === 'APROBADO',
      rating_avg: Number(row.rating_avg || 0),
      rating_count: Number(row.rating_count || 0),
      glowai_diagnosticos_mes: Number(row.glowai_diagnosticos_mes || 0),
      streak_actual: Number(row.streak_actual || 0),
      streak_maximo: Number(row.streak_maximo || 0),
    })) });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/providers/profile:', error);
    return res.status(500).json({ success: false, error: 'No se pudo consultar el perfil del proveedor.' });
  }
});

// Bandeja de disputas: usa app_system dentro del contexto transaccional de la
// petición para consultar los registros que cruzan los tenants de cliente y proveedor.
router.get('/disputes/inbox', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('SET LOCAL ROLE app_system');
    const estado = String(req.query.estado || 'TODOS').toUpperCase();
    const q = String(req.query.q || '').trim().slice(0, 120);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const estadosValidos = ['TODOS', 'ABIERTA', 'EN_REVISION', 'RESUELTA', 'CERRADA'];
    if (!estadosValidos.includes(estado)) return res.status(400).json({ error: 'Filtro de estado inválido.' });

    const where = `($1 = 'TODOS' OR d.estado::text = $1)
      AND ($2 = '' OR d.id::text ILIKE '%' || $2 || '%' OR u_c.nombre ILIKE '%' || $2 || '%'
        OR u_p.nombre ILIKE '%' || $2 || '%' OR COALESCE(s.name, '') ILIKE '%' || $2 || '%')`;
    const [rows, total, metrics] = await Promise.all([
      pool.query(`SELECT d.id, d.booking_id, d.tipo_actor, d.tipo, d.descripcion, d.evidencia_urls,
          d.monto_disputado, d.estado, d.resolucion, d.nota_resolucion, d.creado_at, d.sla_limite_at,
          b.scheduled_at AS booking_fecha, b.valor_bruto, b.pago_neto_prestador,
          u_i.nombre AS iniciado_por_nombre, u_i.email AS iniciado_por_email,
          u_c.nombre AS cliente_nombre, u_c.email AS cliente_email,
          u_p.nombre AS prestador_nombre, u_p.email AS prestador_email,
          s.name AS servicio_nombre,
          GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - d.creado_at)) / 3600))::int AS horas_abierta,
          (d.sla_limite_at IS NOT NULL AND d.sla_limite_at < NOW()) AS sla_vencido,
          (SELECT COUNT(*)::int FROM disputa_mensajes m WHERE m.disputa_id = d.id) AS mensajes_total
        FROM disputas d
        JOIN bookings b ON b.id = d.booking_id
        LEFT JOIN usuarios u_i ON u_i.id = d.iniciado_por
        LEFT JOIN usuarios u_c ON u_c.id = b.client_id
        LEFT JOIN usuarios u_p ON u_p.id = b.provider_id
        LEFT JOIN services s ON s.id = b.service_id
        WHERE ${where}
        ORDER BY CASE WHEN d.estado IN ('ABIERTA','EN_REVISION') THEN 0 ELSE 1 END,
          d.sla_limite_at ASC NULLS LAST, d.creado_at DESC
        LIMIT $3 OFFSET $4`, [estado, q, limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS total FROM disputas d
        JOIN bookings b ON b.id = d.booking_id
        LEFT JOIN usuarios u_c ON u_c.id = b.client_id
        LEFT JOIN usuarios u_p ON u_p.id = b.provider_id
        LEFT JOIN services s ON s.id = b.service_id WHERE ${where}`, [estado, q]),
      pool.query(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE estado = 'ABIERTA')::int AS abiertas,
        COUNT(*) FILTER (WHERE estado = 'EN_REVISION')::int AS en_revision,
        COUNT(*) FILTER (WHERE estado IN ('ABIERTA','EN_REVISION') AND sla_limite_at < NOW())::int AS vencidas,
        COUNT(*) FILTER (WHERE estado IN ('RESUELTA','CERRADA'))::int AS cerradas
        FROM disputas`),
    ]);
    return res.json({ success: true, data: rows.rows, total: total.rows[0].total, page, limit, metricas: metrics.rows[0] });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/disputes/inbox:', error);
    return res.status(500).json({ error: 'No se pudo cargar la bandeja de disputas.' });
  }
});

router.get('/disputes/:id/review', authMiddleware, adminMiddleware, async (req, res) => {
  if (!UUID_DISPUTA.test(req.params.id)) return res.status(400).json({ error: 'Identificador de disputa inválido.' });
  try {
    await pool.query('SET LOCAL ROLE app_system');
    const result = await pool.query(`SELECT d.*, b.client_id, b.provider_id, b.valor_bruto,
        b.pago_neto_prestador, b.scheduled_at AS booking_fecha,
        u_i.nombre AS iniciado_por_nombre, u_i.email AS iniciado_por_email,
        u_c.nombre AS cliente_nombre, u_c.email AS cliente_email,
        u_p.nombre AS prestador_nombre, u_p.email AS prestador_email, s.name AS servicio_nombre
      FROM disputas d JOIN bookings b ON b.id = d.booking_id
      LEFT JOIN usuarios u_i ON u_i.id = d.iniciado_por
      LEFT JOIN usuarios u_c ON u_c.id = b.client_id
      LEFT JOIN usuarios u_p ON u_p.id = b.provider_id
      LEFT JOIN services s ON s.id = b.service_id WHERE d.id = $1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Disputa no encontrada.' });
    const mensajes = await pool.query(`SELECT m.id, m.remitente_id, m.audiencia, m.mensaje, m.evidencia_urls, m.creado_at,
        u.nombre AS remitente_nombre
      FROM disputa_mensajes m LEFT JOIN usuarios u ON u.id = m.remitente_id
      WHERE m.disputa_id = $1 ORDER BY m.creado_at ASC, m.id ASC`, [req.params.id]);
    return res.json({ success: true, data: { ...result.rows[0], mensajes: mensajes.rows } });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/disputes/:id/review:', error);
    return res.status(500).json({ error: 'No se pudo cargar el expediente.' });
  }
});

router.patch('/disputes/:id/review', authMiddleware, adminMiddleware,
  adminAuditLog({ action: 'dispute.review', resource: 'dispute' }), async (req, res) => {
    if (!UUID_DISPUTA.test(req.params.id)) return res.status(400).json({ error: 'Identificador de disputa inválido.' });
    try {
      await pool.query('SET LOCAL ROLE app_system');
      const result = await pool.query(`UPDATE disputas SET estado = 'EN_REVISION', workflow_actor_id = $2, actualizado_at = NOW()
        WHERE id = $1 AND estado = 'ABIERTA' RETURNING id, estado, actualizado_at`, [req.params.id, req.user.id]);
      if (!result.rows.length) {
        const existe = await pool.query('SELECT id, estado FROM disputas WHERE id = $1', [req.params.id]);
        if (!existe.rows.length) return res.status(404).json({ error: 'Disputa no encontrada.' });
        if (existe.rows[0].estado === 'EN_REVISION') return res.json({ success: true, data: existe.rows[0] });
        return res.status(409).json({ error: 'Solo se puede iniciar la revisión de una disputa abierta.' });
      }
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error('❌ ERROR EN PATCH /api/admin/disputes/:id/review:', error);
      return res.status(500).json({ error: 'No se pudo iniciar la revisión.' });
    }
  });

router.post('/disputes/:id/messages', authMiddleware, adminMiddleware,
  adminAuditLog({ action: 'dispute.message.create', resource: 'dispute' }), async (req, res) => {
    if (!UUID_DISPUTA.test(req.params.id)) return res.status(400).json({ error: 'Identificador de disputa inválido.' });
    const mensaje = typeof req.body?.mensaje === 'string' ? req.body.mensaje.trim() : '';
    const audiencia = req.body?.audiencia === 'INTERNA' ? 'INTERNA' : 'PARTES';
    if (!mensaje || mensaje.length > 4000) return res.status(400).json({ error: 'Escribe un mensaje de 1 a 4.000 caracteres.' });
    const validacionEvidencias = validarEvidencias(req.body?.evidencia_urls);
    if (!validacionEvidencias.ok) return res.status(validacionEvidencias.status).json({ error: 'EVIDENCIA_INVALIDA', mensaje: validacionEvidencias.message });
    try {
      await pool.query('SET LOCAL ROLE app_system');
      const result = await pool.query(`INSERT INTO disputa_mensajes (disputa_id, remitente_id, audiencia, mensaje, evidencia_urls, tenant_id)
        SELECT d.id, $2, $3, $4, $5, COALESCE(d.tenant_id, b.tenant_id, u_p.tenant_id, u_c.tenant_id, $6)
        FROM disputas d JOIN bookings b ON b.id = d.booking_id
        LEFT JOIN usuarios u_p ON u_p.id = b.provider_id
        LEFT JOIN usuarios u_c ON u_c.id = b.client_id
        WHERE d.id = $1
        RETURNING id, disputa_id, remitente_id, audiencia, mensaje, evidencia_urls, creado_at`,
      [req.params.id, req.user.id, audiencia, mensaje, validacionEvidencias.evidence, req.user.tenant_id || null]);
      if (!result.rows.length) return res.status(404).json({ error: 'Disputa no encontrada.' });
      let notification = { status: 'internal_note' };
      if (audiencia === 'PARTES') {
        const partes = await pool.query(
          `SELECT b.id AS booking_id, b.client_id, b.provider_id
           FROM disputas d JOIN bookings b ON b.id = d.booking_id WHERE d.id = $1`,
          [req.params.id]);
        const row = partes.rows[0];
        if (row) notification = await notifyDisputeUsers({
          userIds: [row.client_id, row.provider_id], disputeId: req.params.id,
          bookingId: row.booking_id, actorId: req.user.id,
          message: 'El equipo de GlowApp respondió a tu disputa. Consulta el expediente en la app.',
        });
      }
      return res.status(201).json({ success: true, data: result.rows[0], aviso: audiencia === 'PARTES'
        ? 'Respuesta guardada en el expediente.'
        : 'Nota interna guardada; solo visible para el equipo.', notification });
    } catch (error) {
      console.error('❌ ERROR EN POST /api/admin/disputes/:id/messages:', error);
      return res.status(500).json({ error: 'No se pudo guardar el mensaje.' });
    }
  });

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
//
// `?revision=` filtra por el ciclo del DOCUMENTO (D-GL-030): sin_enviar,
// pendiente (la cola del equipo), aprobada, rechazada. Es ortogonal a `estado`:
// un prestador puede tener código declarado y el soporte todavía sin revisar.
router.get('/providers/fiscal', authMiddleware, adminMiddleware, async (req, res) => {
  const FILTROS = {
    todos: '',
    sin_declarar: 'AND u.rut_responsabilidad_codigo IS NULL AND u.responsable_iva_override IS NULL',
    declarado: 'AND u.rut_responsabilidad_codigo IS NOT NULL AND u.responsable_iva_override IS NULL',
    override: 'AND u.responsable_iva_override IS NOT NULL',
  };

  const REVISIONES = {
    todas: '',
    sin_enviar: `AND u.revision_estado = '${ESTADOS.SIN_ENVIAR}'`,
    pendiente: `AND u.revision_estado = '${ESTADOS.PENDIENTE}'`,
    aprobada: `AND u.revision_estado = '${ESTADOS.APROBADA}'`,
    rechazada: `AND u.revision_estado = '${ESTADOS.RECHAZADA}'`,
  };

  const estado = String(req.query.estado || 'todos');
  if (!Object.prototype.hasOwnProperty.call(FILTROS, estado)) {
    return res.status(400).json({
      error: `Estado no reconocido: '${estado}'.`,
      estados_validos: Object.keys(FILTROS),
    });
  }

  const revision = String(req.query.revision || 'todas');
  if (!Object.prototype.hasOwnProperty.call(REVISIONES, revision)) {
    return res.status(400).json({
      error: `Revisión no reconocida: '${revision}'.`,
      revisiones_validas: Object.keys(REVISIONES),
    });
  }

  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.nombre, u.email,
             COALESCE(u.rut_solicitado_numero, u.rut_numero) AS rut_numero,
             COALESCE(u.rut_solicitado_responsabilidad_codigo, u.rut_responsabilidad_codigo) AS rut_responsabilidad_codigo,
             u.responsable_iva,
             u.responsable_iva_override, u.responsabilidad_iva_fuente,
             u.responsabilidad_iva_actualizada_at,
             u.responsabilidad_iva_cambiada_por,
             u.revision_estado, u.revision_nota,
             COALESCE(u.rut_solicitado_soporte_url, u.rut_soporte_url) AS rut_soporte_url,
             u.rut_cargado_at,
             u.revisado_por, u.revisado_at,
             admin.nombre AS cambiada_por_nombre,
             revisor.nombre AS revisado_por_nombre
      FROM usuarios u
      LEFT JOIN usuarios admin ON admin.id = u.responsabilidad_iva_cambiada_por
      LEFT JOIN usuarios revisor ON revisor.id = u.revisado_por
      WHERE u.rol = 'PRESTADOR' ${FILTROS[estado]} ${REVISIONES[revision]}
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
        // Ciclo del documento (D-GL-030). El equipo revisa `PENDIENTE`.
        revision_estado: r.revision_estado || ESTADOS.SIN_ENVIAR,
        revision_nota: r.revision_nota || null,
        soporte_url: r.rut_soporte_url || null,
        cargado_at: r.rut_cargado_at || null,
        revisado_por: r.revisado_por || null,
        revisado_por_nombre: r.revisado_por_nombre || null,
        revisado_at: r.revisado_at || null,
      };
    });

    // El censo se cuenta sobre TODOS los prestadores, no sobre el subconjunto
    // filtrado: si no, los contadores de la cabecera serían un eco del filtro y
    // mentirían justo cuando el admin filtra para ver el alcance del problema.
    const censo = await pool.query(
      `SELECT rut_responsabilidad_codigo, responsable_iva_override, revision_estado
         FROM usuarios WHERE rol = 'PRESTADOR'`
    );
    const resumen = {
      total_prestadores: censo.rows.length,
      declarados: 0,
      sin_declarar: 0,
      override: 0,
      // Cola del equipo: estos son los que esperan una mirada humana.
      revision: { sin_enviar: 0, pendiente: 0, aprobada: 0, rechazada: 0 },
    };
    for (const r of censo.rows) {
      if (r.responsable_iva_override !== null && r.responsable_iva_override !== undefined) resumen.override += 1;
      else if (r.rut_responsabilidad_codigo === null) resumen.sin_declarar += 1;
      else resumen.declarados += 1;

      const rev = String(r.revision_estado || ESTADOS.SIN_ENVIAR).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(resumen.revision, rev)) resumen.revision[rev] += 1;
    }

    res.json({ success: true, estado, revision, resumen, prestadores });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/providers/fiscal:', error);
    res.status(500).json({ error: 'Error al obtener la responsabilidad de IVA de los prestadores.' });
  }
});

// PATCH /api/admin/providers/:id/fiscal/correction — corrección manual revisada.
// Conserva intacta la casilla declarada y guarda el criterio humano como override
// MANUAL, junto con motivo, valor previo y valor aplicado en la bitácora append-only.
router.patch(
  '/providers/:id/fiscal/correction',
  authMiddleware,
  adminMiddleware,
  adminAuditLog({ action: 'provider.fiscal.correction', resource: 'provider' }),
  async (req, res) => {
    const id = Number(req.params.id);
    const responsable = req.body?.responsable_iva;
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID de prestador inválido.' });
    }
    if (typeof responsable !== 'boolean') {
      return res.status(400).json({ error: 'Selecciona si el prestador es responsable de IVA.' });
    }
    if (motivo.length < 10 || motivo.length > 500) {
      return res.status(400).json({ error: 'Explica el motivo de la corrección (10 a 500 caracteres).' });
    }

    try {
      const anterior = await pool.query(
        `SELECT id, rut_numero, rut_responsabilidad_codigo, responsable_iva,
                responsable_iva_override, responsabilidad_iva_fuente
           FROM usuarios WHERE id = $1 AND rol = 'PRESTADOR'`,
        [id]
      );
      if (!anterior.rows.length) {
        return res.status(404).json({ error: 'Prestador no encontrado.' });
      }

      const previo = anterior.rows[0];
      const actualizado = await pool.query(
        `UPDATE usuarios
            SET responsable_iva = $2,
                responsable_iva_override = $2,
                responsabilidad_iva_fuente = 'MANUAL',
                responsabilidad_iva_actualizada_at = NOW(),
                responsabilidad_iva_cambiada_por = $3
          WHERE id = $1 AND rol = 'PRESTADOR'
          RETURNING id, rut_numero, rut_responsabilidad_codigo, responsable_iva,
                    responsable_iva_override, responsabilidad_iva_fuente,
                    responsabilidad_iva_actualizada_at, responsabilidad_iva_cambiada_por`,
        [id, responsable, req.user.id]
      );

      req.auditMetadata = {
        motivo,
        rut_responsabilidad_codigo: previo.rut_responsabilidad_codigo,
        fuente_anterior: previo.responsabilidad_iva_fuente || null,
        responsable_iva_anterior: previo.responsable_iva,
        override_anterior: previo.responsable_iva_override,
        responsable_iva_aplicado: actualizado.rows[0].responsable_iva,
      };

      return res.json({ success: true, fiscal: actualizado.rows[0] });
    } catch (error) {
      console.error('❌ ERROR EN PATCH /api/admin/providers/:id/fiscal/correction:', error);
      return res.status(500).json({ error: 'No se pudo guardar la corrección fiscal.' });
    }
  }
);

// 🔹 POST /api/admin/providers/:id/fiscal/revision — aprobar o rechazar el RUT
//
// D-GL-030: el prestador no puede publicar hasta que su RUT esté aprobado. La
// DIAN no ofrece consulta automatizable, así que la aprobación es humana y queda
// auditada (quién, cuándo, con qué nota).
//
// Al aprobar, `responsable_iva` se aplica desde el código 48/49 del RUT —salvo
// que exista un override manual, que manda (D1 de la migración 087).
router.post(
  '/providers/:id/fiscal/revision',
  authMiddleware,
  adminMiddleware,
  adminAuditLog((req) => `provider.fiscal.${String((req.body && req.body.accion) || 'revision').toLowerCase()}`, 'provider'),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID de prestador inválido.' });
    }

    const { accion, nota } = req.body || {};

    try {
      const { rows } = await pool.query(
        `SELECT COALESCE(rut_solicitado_numero, rut_numero) AS rut_numero,
                COALESCE(rut_solicitado_responsabilidad_codigo, rut_responsabilidad_codigo) AS rut_responsabilidad_codigo,
                responsable_iva_override, revision_estado,
                COALESCE(rut_solicitado_soporte_url, rut_soporte_url) AS rut_soporte_url
           FROM usuarios
          WHERE id = $1 AND rol = 'PRESTADOR'`,
        [id]
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'Prestador no encontrado.' });
      }

      const fila = rows[0];
      const transicion = transicionar({ actual: fila.revision_estado, accion, nota });
      if (!transicion.valido) {
        return res.status(409).json({ error: 'TRANSICION_INVALIDA', detalle: transicion.motivo });
      }

      // Aprobar sin código declarado dejaría `responsable_iva` sin fundamento:
      // no se inventa el valor, se pide primero la declaración.
      let responsable = null;
      if (transicion.estado === ESTADOS.APROBADA) {
        if (!fila.rut_soporte_url) {
          return res.status(409).json({
            error: 'SIN_SOPORTE',
            detalle: 'No hay RUT cargado para aprobar.',
          });
        }
        responsable = responsabilidadDesdeCodigo(fila.rut_responsabilidad_codigo);
        if (responsable === null) {
          return res.status(409).json({
            error: 'RESPONSABILIDAD_NO_DETERMINABLE',
            detalle: 'El prestador debe declarar el código 48 o 49 del RUT antes de aprobar.',
          });
        }
      }

      const hayOverride =
        fila.responsable_iva_override !== null && fila.responsable_iva_override !== undefined;

      const actualizado = await pool.query(
                    `UPDATE usuarios
                        SET rut_numero = CASE WHEN $2 = 'APROBADA' THEN COALESCE(rut_solicitado_numero, rut_numero) ELSE rut_numero END,
                            rut_responsabilidad_codigo = CASE WHEN $2 = 'APROBADA' THEN COALESCE(rut_solicitado_responsabilidad_codigo, rut_responsabilidad_codigo) ELSE rut_responsabilidad_codigo END,
                            rut_soporte_url = CASE WHEN $2 = 'APROBADA' THEN COALESCE(rut_solicitado_soporte_url, rut_soporte_url) ELSE rut_soporte_url END,
                            rut_soporte_hash = CASE WHEN $2 = 'APROBADA' THEN COALESCE(rut_solicitado_soporte_hash, rut_soporte_hash) ELSE rut_soporte_hash END,
                            rut_soporte_mime = CASE WHEN $2 = 'APROBADA' THEN COALESCE(rut_solicitado_soporte_mime, rut_soporte_mime) ELSE rut_soporte_mime END,
                            rut_soporte_bytes = CASE WHEN $2 = 'APROBADA' THEN COALESCE(rut_solicitado_soporte_bytes, rut_soporte_bytes) ELSE rut_soporte_bytes END,
                            rut_solicitado_numero = CASE WHEN $2 = 'APROBADA' THEN NULL ELSE rut_solicitado_numero END,
                            rut_solicitado_responsabilidad_codigo = CASE WHEN $2 = 'APROBADA' THEN NULL ELSE rut_solicitado_responsabilidad_codigo END,
                            rut_solicitado_soporte_url = CASE WHEN $2 = 'APROBADA' THEN NULL ELSE rut_solicitado_soporte_url END,
                            rut_solicitado_soporte_hash = CASE WHEN $2 = 'APROBADA' THEN NULL ELSE rut_solicitado_soporte_hash END,
                            rut_solicitado_soporte_mime = CASE WHEN $2 = 'APROBADA' THEN NULL ELSE rut_solicitado_soporte_mime END,
                            rut_solicitado_soporte_bytes = CASE WHEN $2 = 'APROBADA' THEN NULL ELSE rut_solicitado_soporte_bytes END,
                            revision_estado = $2,
                            revision_nota = $3,
                            revisado_por = $4,
                            revisado_at = NOW(),
                            onboarding_completo = CASE WHEN $6 THEN true ELSE onboarding_completo END,
                            responsable_iva = COALESCE($5, responsable_iva),
                            responsabilidad_iva_fuente = CASE WHEN $5::boolean IS NULL THEN responsabilidad_iva_fuente ELSE 'RUT' END,
                            responsabilidad_iva_actualizada_at = CASE WHEN $5::boolean IS NULL THEN responsabilidad_iva_actualizada_at ELSE NOW() END,
                            responsabilidad_iva_cambiada_por = CASE WHEN $5::boolean IS NULL THEN responsabilidad_iva_cambiada_por ELSE $4 END
                      WHERE id = $1
                      RETURNING id, rut_numero, rut_responsabilidad_codigo, responsable_iva,
                                responsable_iva_override, responsabilidad_iva_fuente,
                                revision_estado, revision_nota, revisado_por, revisado_at, onboarding_completo`,
                    [id, transicion.estado, transicion.nota || null, req.user.id, hayOverride ? null : responsable, transicion.estado === ESTADOS.APROBADA]
                  );

            await pool.query(
              `UPDATE provider_fiscal_change_requests
                  SET estado = $2, revisado_por = $3, revisado_at = NOW(), nota_revision = $4
                WHERE id = (
                  SELECT id FROM provider_fiscal_change_requests
                   WHERE provider_id = $1 AND estado = 'PENDIENTE'
                   ORDER BY solicitado_at DESC, id DESC LIMIT 1
                )`,
              [id, transicion.estado, req.user.id, transicion.nota || null]
            );

            // 🔔 Enviar notificación push FCM al prestador cuando se aprueba el RUT
            if (transicion.estado === ESTADOS.APROBADA) {
              try {
                const { rows: userRows } = await pool.query(
                  `SELECT u.fcm_token, p.estatus_verificacion
                     FROM usuarios u
                     LEFT JOIN perfiles_prestador p ON p.id = u.id
                    WHERE u.id = $1`,
                  [id]
                );
                const notificationUser = userRows[0];
                const fcmToken = notificationUser?.fcm_token || null;
                if (fcmToken) {
                  const verificacionCompleta = notificationUser.estatus_verificacion === 'APROBADO';
                  await fcmNotificationService.sendPushNotification(fcmToken, {
                    title: '✅ Tu RUT fue aprobado',
                    body: verificacionCompleta
                      ? 'La revisión fiscal terminó. Ya puedes publicar servicios y recibir citas en GlowApp.'
                      : 'La revisión fiscal terminó. La verificación de identidad y acreditación sigue pendiente; te avisaremos cuando finalice.',
                    data: {
                      type: 'PROVIDER_RUT_APPROVED',
                      deep_link: verificacionCompleta ? '/home' : '/auth/verification-pending',
                    },
                  });
                }
              } catch (pushErr) {
                console.warn('⚠️ No se pudo enviar push de aprobación RUT:', pushErr.message);
              }
            }

            res.json({
        ok: true,
        revision: {
          prestador_id: id,
          estado: transicion.estado,
          nota: transicion.nota || null,
          responsable_iva: actualizado.rows[0].responsable_iva,
          override_respetado: hayOverride,
        },
        fiscal: actualizado.rows[0],
      });
    } catch (error) {
      console.error('❌ ERROR EN POST /api/admin/providers/:id/fiscal/revision:', error);
      res.status(500).json({ error: 'Error al registrar la revisión del RUT.' });
    }
  }
);

wrapRouterAsync(router);
module.exports = router;
