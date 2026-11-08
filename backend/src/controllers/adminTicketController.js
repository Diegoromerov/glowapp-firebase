// backend/src/controllers/adminTicketController.js
//
// Gestión de PQRSF desde el panel: bandeja, detalle con hilo, cambio de estado y
// prioridad, y respuesta del operador.
//
// El hilo y los tiempos viven en `tickets` / `ticket_mensajes` (migración 007, más las
// columnas de tiempo y autor de la 081). El envío de correo al implicado NO está aquí:
// es la fase siguiente, y antes de enviar hay que arreglar el contrato del servicio de
// correo, que hoy devuelve `success:true` cuando en realidad simula.
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const {
  DIAS_HABILES_ARCO,
  casePlazoMinutos,
  PLAZOS_MINUTOS,
  minutosDe,
  fechaLimite,
  estadoSla,
  respondidoATiempo,
  minutosDeRespuesta,
  diasHabilesEntre,
  fechaLimiteArco,
} = require('../utils/ticketSla');
const { motivoInvalido, valoresValidos } = require('../utils/ticketEsquema');
const { pool } = require('../config/db');
const tenantRouting = require('../config/tenantRouting');
const consentService = require('../services/consentService');

const TIPO_ARCO = 'ARCO_SUPRESION';
const PAGINA_POR_DEFECTO = 1;
const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAX = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Traduce lo que la base rechaza a un 400 con motivo, en vez de un 500 genérico. */
function responderErrorDeBase(error, res, contexto) {
  if (error && error.code === '23514') {
    // check_violation: el caso del botón "Atender" — un valor que el CHECK no admite
    // llegaba como 500 y se leía como "el botón no hace nada".
    return res.status(400).json({
      error: 'VALOR_NO_ADMITIDO',
      message: `El esquema rechazó el cambio: ${error.message}`,
    });
  }
  if (error && error.code === '22P02') {
    return res.status(400).json({
      error: 'FORMATO_INVALIDO',
      message: 'Algún campo tiene un formato que la base no admite.',
    });
  }
  console.error(`❌ ERROR EN ${contexto}:`, error);
  return res.status(500).json({ error: `Error en ${contexto}` });
}

/** Añade los tiempos derivados: SLA, límite y plazo legal si es ARCO. */
function conTiempos(ticket, ahora) {
  const desde = new Date(ticket.fecha_creacion);
  const primera = ticket.primera_respuesta_en ? new Date(ticket.primera_respuesta_en) : null;
  const esArco = ticket.tipo === TIPO_ARCO;
  const limiteLegal = esArco ? fechaLimiteArco(desde) : null;

  return {
    ...ticket,
    sla: {
      estado: estadoSla(ticket.prioridad, desde, ahora, primera),
      plazo_minutos: minutosDe(ticket.prioridad),
      limite: fechaLimite(ticket.prioridad, desde),
      respondido_a_tiempo: respondidoATiempo(ticket.prioridad, desde, primera),
      minutos_primera_respuesta: minutosDeRespuesta(desde, primera),
    },
    legal: esArco
      ? {
          tipo: TIPO_ARCO,
          plazo_dias_habiles: DIAS_HABILES_ARCO,
          limite: limiteLegal,
          vencido: ahora.getTime() > limiteLegal.getTime(),
          dias_habiles_restantes: diasHabilesEntre(ahora, limiteLegal),
          // Declarado a propósito: sin lista de festivos el cálculo no los conoce.
          festivos_incluidos: false,
        }
      : null,
  };
}

// ── GET /api/admin/tickets ─────────────────────────────────────────────────────
// Bandeja: filtros por estado, tipo, categoría, prioridad, sin responder y vencidos.
exports.listarTickets = async (req, res) => {
  try {
    const pagina = Math.max(1, parseInt(req.query.page, 10) || PAGINA_POR_DEFECTO);
    const limite = Math.min(LIMITE_MAX, Math.max(1, parseInt(req.query.limit, 10) || LIMITE_POR_DEFECTO));

    const condiciones = [];
    const reemplazos = {};
    const filtrar = (columna, nombre, valor) => {
      if (valor === undefined || valor === '' || valor === 'TODOS') return;
      reemplazos[nombre] = valor;
      condiciones.push(`${columna} = :${nombre}`);
    };

    filtrar('t.estado', 'estado', req.query.estado);
    filtrar('t.tipo', 'tipo', req.query.tipo);
    filtrar('t.categoria', 'categoria', req.query.categoria);
    filtrar('t.prioridad', 'prioridad', req.query.prioridad);

    if (String(req.query.sin_respuesta).toLowerCase() === 'true') {
      condiciones.push('t.primera_respuesta_en IS NULL');
    }
    if (String(req.query.vencidos).toLowerCase() === 'true') {
      condiciones.push(
        `t.primera_respuesta_en IS NULL AND NOW() > t.fecha_creacion + (${casePlazoMinutos('t.prioridad')}) * INTERVAL '1 minute'`
      );
    }

    const filtro = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const conteo = await sequelize.query(
      `SELECT count(*)::int AS total FROM tickets t ${filtro}`,
      { replacements: reemplazos, type: QueryTypes.SELECT }
    );
    const total = conteo[0] ? conteo[0].total : 0;

    const filas = await sequelize.query(
      `SELECT t.id, t.tipo, t.categoria, t.asunto, t.estado, t.prioridad,
              t.fecha_creacion, t.fecha_actualizacion, t.primera_respuesta_en,
              t.resuelto_en, t.cerrado_en,
              u.nombre AS usuario_nombre, u.email AS usuario_email,
              -- mensajes_total, NO mensajes: en el detalle mensajes es el ARRAY del hilo.
              -- La misma clave con dos tipos (numero aqui, coleccion alli) es una trampa
              -- para el panel: un tipo que herede de la fila y se reuse en el detalle
              -- declararia numero donde llega una lista.
              (SELECT count(*)::int FROM ticket_mensajes m WHERE m.ticket_id = t.id) AS mensajes_total,
              (SELECT count(*)::int FROM ticket_mensajes m
                WHERE m.ticket_id = t.id AND m.autor_tipo IN ('OPERADOR','AGENTE')
                  AND m.es_borrador = FALSE) AS respuestas_operador
         FROM tickets t
         JOIN usuarios u ON u.id = t.usuario_id
         ${filtro}
        ORDER BY (t.estado IN ('RESUELTO','CERRADO')) ASC, t.fecha_creacion ASC
        LIMIT :limite OFFSET :desplazamiento`,
      {
        replacements: { ...reemplazos, limite, desplazamiento: (pagina - 1) * limite },
        type: QueryTypes.SELECT,
      }
    );

    const ahora = new Date();
    return res.json({
      success: true,
      page: pagina,
      limit: limite,
      total,
      // El orden deja delante lo que puede incumplir el SLA: primero lo abierto, y dentro
      // de eso lo más antiguo (cola FIFO).
      orden: 'abiertos primero, luego por antigüedad',
      data: filas.map((f) => conTiempos(f, ahora)),
    });
  } catch (error) {
    return responderErrorDeBase(error, res, 'GET /api/admin/tickets');
  }
};

// ── GET /api/admin/tickets/metricas ────────────────────────────────────────────
// Va ANTES de `/tickets/:id` en el router: si no, 'metricas' se lee como un id.
exports.metricasTickets = async (req, res) => {
  try {
    const ahora = new Date();

    const porEstado = await sequelize.query(
      `SELECT estado, count(*)::int AS total FROM tickets GROUP BY estado ORDER BY estado`,
      { type: QueryTypes.SELECT }
    );

    const porPrioridad = await sequelize.query(
      `SELECT t.prioridad,
              count(*)::int AS total,
              count(*) FILTER (WHERE t.estado NOT IN ('RESUELTO','CERRADO'))::int AS abiertos,
              count(*) FILTER (WHERE t.primera_respuesta_en IS NULL)::int AS sin_respuesta,
              count(*) FILTER (
                WHERE t.primera_respuesta_en IS NULL
                  AND NOW() > t.fecha_creacion + (${casePlazoMinutos('t.prioridad')}) * INTERVAL '1 minute'
              )::int AS vencidos,
              round(avg(EXTRACT(EPOCH FROM (t.primera_respuesta_en - t.fecha_creacion)) / 60)::numeric, 1)::float
                AS minutos_medio_respuesta,
              round(avg(EXTRACT(EPOCH FROM (t.resuelto_en - t.fecha_creacion)) / 60)::numeric, 1)::float
                AS minutos_medio_resolucion
         FROM tickets t
        GROUP BY t.prioridad`,
      { type: QueryTypes.SELECT }
    );

    // ARCO: el plazo es legal y en días HÁBILES, así que no se resuelve en SQL sin un
    // calendario. Son pocas solicitudes, así que se calculan con el helper puro.
    const arcoAbiertas = await sequelize.query(
      `SELECT id, asunto, estado, prioridad, fecha_creacion
         FROM tickets
        WHERE tipo = :tipo AND estado NOT IN ('RESUELTO','CERRADO')`,
      { replacements: { tipo: TIPO_ARCO }, type: QueryTypes.SELECT }
    );
    const arco = arcoAbiertas.map((t) => {
      const limite = fechaLimiteArco(t.fecha_creacion);
      return {
        ...t,
        limite_legal: limite,
        vencido_legal: ahora.getTime() > limite.getTime(),
        dias_habiles_restantes: diasHabilesEntre(ahora, limite),
      };
    });

    const total = porEstado.reduce((suma, e) => suma + e.total, 0);
    const vencidosTotal = porPrioridad.reduce((suma, p) => suma + p.vencidos, 0);
    const sinRespuestaTotal = porPrioridad.reduce((suma, p) => suma + p.sin_respuesta, 0);

    return res.json({
      success: true,
      data: {
        total,
        abiertos: porEstado
          .filter((e) => e.estado !== 'RESUELTO' && e.estado !== 'CERRADO')
          .reduce((suma, e) => suma + e.total, 0),
        vencidos: vencidosTotal,
        sin_respuesta: sinRespuestaTotal,
        por_estado: porEstado,
        por_prioridad: porPrioridad,
        arco: { plazo_dias_habiles: DIAS_HABILES_ARCO, festivos_incluidos: false, abiertas: arco },
      },
    });
  } catch (error) {
    return responderErrorDeBase(error, res, 'GET /api/admin/tickets/metricas');
  }
};

// ── GET /api/admin/tickets/esquema ─────────────────────────────────────────────
// Las opciones del panel (estados, prioridades, tipos, categorías) y los plazos.
//
// POR QUÉ EXISTE: son justo los valores que el panel tiende a copiar en una lista, y una
// lista copiada se desincroniza en cuanto una migración añade un valor — la 045 añadió
// ARCO_SUPRESION a `tickets.tipo` y el código no se enteró. Aquí se sirven desde la misma
// derivación que usa la validación, así que no pueden divergir.
//
// `null` en una columna significa que la base no expone un CHECK derivable para ella: el
// panel debe entonces NO ofrecer desplegable y dejar el campo libre, en vez de inventarse
// las opciones.
exports.esquemaTickets = async (req, res) => {
  try {
    const [estado, prioridad, tipo, categoria] = await Promise.all([
      valoresValidos('tickets', 'estado'),
      valoresValidos('tickets', 'prioridad'),
      valoresValidos('tickets', 'tipo'),
      valoresValidos('tickets', 'categoria'),
    ]);

    return res.json({
      success: true,
      data: {
        valores: { estado, prioridad, tipo, categoria },
        // Los plazos tampoco se copian en el panel: cambiar uno aquí actualizaría la
        // leyenda sin tocar el frontend.
        sla: { plazos_minutos: PLAZOS_MINUTOS },
        legal: { plazo_dias_habiles: DIAS_HABILES_ARCO, festivos_incluidos: false },
      },
    });
  } catch (error) {
    return responderErrorDeBase(error, res, 'GET /api/admin/tickets/esquema');
  }
};

// ── GET /api/admin/tickets/:id ─────────────────────────────────────────────────
exports.detalleTicket = async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID.test(id)) {
      return res.status(400).json({ error: 'FORMATO_INVALIDO', message: 'El id del ticket no es un UUID.' });
    }

    const tickets = await sequelize.query(
      `SELECT t.*, u.nombre AS usuario_nombre, u.email AS usuario_email,
              u.phone AS usuario_phone
         FROM tickets t
         JOIN usuarios u ON u.id = t.usuario_id
        WHERE t.id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!tickets.length) {
      return res.status(404).json({ error: 'NO_ENCONTRADO', message: 'Ticket no encontrado.' });
    }

    const mensajes = await sequelize.query(
      `SELECT m.id, m.remitente_id, m.mensaje, m.autor_tipo, m.es_borrador, m.fecha_envio,
              u.nombre AS remitente_nombre
         FROM ticket_mensajes m
         LEFT JOIN usuarios u ON u.id = m.remitente_id
        WHERE m.ticket_id = :id
        ORDER BY m.fecha_envio ASC`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    const auditoria = await sequelize.query(
      `SELECT id, actor_id, event_type, state_before, state_after, details, happened_at
         FROM ticket_workflow_audit WHERE ticket_id = :id ORDER BY happened_at, id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    return res.json({ success: true, data: { ...conTiempos(tickets[0], new Date()), mensajes, auditoria } });
  } catch (error) {
    return responderErrorDeBase(error, res, 'GET /api/admin/tickets/:id');
  }
};

// ── PATCH /api/admin/tickets/:id ───────────────────────────────────────────────
// Estado y prioridad. Es el endpoint que F1 dejó pendiente: aquí es donde se escribe
// `resuelto_en` / `cerrado_en`, que hasta ahora solo tenían el valor del backfill.
exports.actualizarTicket = async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID.test(id)) {
      return res.status(400).json({ error: 'FORMATO_INVALIDO', message: 'El id del ticket no es un UUID.' });
    }

    const { estado, prioridad } = req.body || {};
    if (estado === undefined && prioridad === undefined) {
      return res.status(400).json({
        error: 'SIN_CAMBIOS',
        message: 'Hay que enviar al menos `estado` o `prioridad`.',
      });
    }

    // Los valores admisibles salen del CHECK real de la tabla, no de una lista de aquí.
    if (estado !== undefined) {
      const motivo = await motivoInvalido('tickets', 'estado', estado);
      if (motivo) return res.status(400).json({ error: 'VALOR_NO_ADMITIDO', message: motivo });
    }
    if (prioridad !== undefined) {
      const motivo = await motivoInvalido('tickets', 'prioridad', prioridad);
      if (motivo) return res.status(400).json({ error: 'VALOR_NO_ADMITIDO', message: motivo });
    }

    const actuales = await sequelize.query(
      `SELECT id, estado, tipo, suppression_executed_at FROM tickets WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!actuales.length) {
      return res.status(404).json({ error: 'NO_ENCONTRADO', message: 'Ticket no encontrado.' });
    }
    const cambiaEstado = estado !== undefined && estado !== actuales[0].estado;
    if (actuales[0].tipo === TIPO_ARCO && ['RESUELTO', 'CERRADO'].includes(estado)
        && !actuales[0].suppression_executed_at) {
      return res.status(409).json({
        error: 'SUPRESION_NO_EJECUTADA',
        message: 'Verifica la identidad y ejecuta la supresión ARCO antes de cerrar el caso.',
      });
    }

    const asignaciones = ['fecha_actualizacion = NOW()', 'workflow_actor_id = :actor'];
    const reemplazos = { id, actor: req.user.id };

    if (estado !== undefined) {
      reemplazos.estado = estado;
      asignaciones.push('estado = :estado');
      if (cambiaEstado) {
        // `resuelto_en` describe el estado ACTUAL de la resolución: se marca al resolver
        // y se limpia si el ticket vuelve a abrirse. Un ticket reabierto no puede seguir
        // contando como resuelto en las métricas. El rastro de quién lo reabrió y cuándo
        // queda en admin_audit_logs, que es donde toca.
        if (estado === 'RESUELTO') {
          asignaciones.push('resuelto_en = NOW()', 'cerrado_en = NULL');
        } else if (estado === 'CERRADO') {
          asignaciones.push('cerrado_en = NOW()');
        } else {
          asignaciones.push('resuelto_en = NULL', 'cerrado_en = NULL');
        }
      }
    }

    if (prioridad !== undefined) {
      reemplazos.prioridad = prioridad;
      asignaciones.push('prioridad = :prioridad');
    }

    const filas = await sequelize.query(
      `UPDATE tickets SET ${asignaciones.join(', ')} WHERE id = :id
        RETURNING id, tipo, categoria, asunto, estado, prioridad, fecha_creacion,
                  fecha_actualizacion, primera_respuesta_en, resuelto_en, cerrado_en`,
      { replacements: reemplazos, type: QueryTypes.SELECT }
    );

    return res.json({
      success: true,
      message: cambiaEstado ? `Estado actualizado a ${estado}.` : 'Ticket actualizado.',
      data: conTiempos(filas[0], new Date()),
    });
  } catch (error) {
    return responderErrorDeBase(error, res, 'PATCH /api/admin/tickets/:id');
  }
};

// Verificación explícita antes de tocar datos personales. La comprobación documental
// ocurre fuera de esta API; el operador registra el resultado y queda auditado.
exports.verifyArcoIdentity = async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ error: 'FORMATO_INVALIDO' });
  const method = req.body?.verification_method;
  const reference = req.body?.verification_reference;
  if (req.body?.identity_verified !== true
      || !['DOCUMENTO', 'OTP', 'VIDEO', 'PRESENCIAL', 'OTRO'].includes(method)
      || typeof reference !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(reference)) {
    return res.status(400).json({ error: 'VERIFICACION_REQUERIDA', message: 'Registra la verificación, su método y la referencia interna del comprobante (sin adjuntar documentos de identidad).' });
  }
  try {
    const updated = await sequelize.query(`
      UPDATE tickets SET identity_verified_at = NOW(), identity_verified_by = :admin,
        identity_verification_method = :method, identity_verification_reference = :reference,
        workflow_actor_id = :admin,
        estado = 'EN_PROCESO', fecha_actualizacion = NOW()
      WHERE id = :id AND tipo = :tipo AND suppression_executed_at IS NULL
      RETURNING id, estado, identity_verified_at, identity_verified_by`,
    { replacements: { id, admin: req.user.id, method, reference, tipo: TIPO_ARCO }, type: QueryTypes.SELECT });
    if (!updated.length) return res.status(404).json({ error: 'SOLICITUD_ARCO_NO_ENCONTRADA' });
    return res.json({ success: true, data: updated[0] });
  } catch (error) { return responderErrorDeBase(error, res, 'POST /api/admin/tickets/:id/arco/verify'); }
};

// Conserva solo una cuenta anónima y los registros mínimos de auditoría; no elimina
// soportes financieros sujetos a conservación. Cada categoría y cantidad queda en el
// manifiesto inmutable asociado al caso.
exports.executeArcoSuppression = async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ error: 'FORMATO_INVALIDO' });
  if (req.body?.confirm !== 'SUPRIMIR_DATOS_VERIFICADOS') {
    return res.status(400).json({ error: 'CONFIRMACION_REQUERIDA', message: 'Envía confirm: SUPRIMIR_DATOS_VERIFICADOS.' });
  }
  try {
    const result = await tenantRouting.runAsSystem({ pool }, async (client) => {
        const found = await client.query(`SELECT id, usuario_id FROM tickets
          WHERE id = $1 AND tipo = $2 AND identity_verified_at IS NOT NULL
            AND suppression_executed_at IS NULL FOR UPDATE`, [id, TIPO_ARCO]);
        if (!found.rows.length) {
          const error = new Error('ARCO_NOT_VERIFIED_OR_ALREADY_EXECUTED'); error.code = 'ARCO_NOT_READY'; throw error;
        }
        const userId = found.rows[0].usuario_id;
        const bio = await consentService.deleteBiometricData(userId, { client });
        if (!bio.deleted) { const error = new Error('BIOMETRIC_SUPPRESSION_FAILED'); error.code = 'ARCO_BIOMETRIC_FAILED'; throw error; }
        await client.query(`INSERT INTO marketing_consent_audit (user_id, granted, source)
          SELECT $1, FALSE, 'arco_suppression' WHERE EXISTS
            (SELECT 1 FROM user_preferences WHERE user_id = $1 AND marketing_enabled = TRUE)`, [userId]);
        const preferenceDelete = await client.query('DELETE FROM user_preferences WHERE user_id = $1', [userId]);
        const pushToken = await client.query('UPDATE usuarios SET fcm_token = NULL WHERE id = $1 AND fcm_token IS NOT NULL RETURNING id', [userId]);
        const anonymized = await client.query(`UPDATE usuarios SET
          nombre = 'Titular anonimizado', email = $1, password_hash = '', phone = NULL,
          foto_url = NULL, is_active = FALSE
          WHERE id = $2 RETURNING id`, [`arco_${userId}_${Date.now()}@deleted.glowapp.invalid`, userId]);
        if (!anonymized.rowCount) { const error = new Error('USER_NOT_FOUND'); error.code = 'ARCO_USER_NOT_FOUND'; throw error; }
        const messagesDeleted = await client.query(`DELETE FROM ticket_mensajes WHERE ticket_id IN
          (SELECT id FROM tickets WHERE usuario_id = $1)`, [userId]);
        const ticketsRedacted = await client.query(`UPDATE tickets SET asunto = 'Registro de solicitud de privacidad',
          descripcion = 'Contenido redactado tras ejecutar supresión ARCO.', evidencia_urls = '{}'
          WHERE usuario_id = $1 AND id <> $2`, [userId, id]);
        const manifest = {
          account_anonymized: true, biometric_records_deleted: bio.recordsAffected,
          preferences_deleted: preferenceDelete.rowCount, push_tokens_deleted: pushToken.rowCount,
          support_threads_redacted: ticketsRedacted.rowCount, support_messages_deleted: messagesDeleted.rowCount,
          financial_and_transactional_records: 'retained_where_legally_required',
          executed_by: req.user.id,
        };
        manifest.request_content_redacted = true;
        const completed = await client.query(`UPDATE tickets SET suppression_executed_at = NOW(),
          suppression_manifest = $2::jsonb, identity_verified_by = $3,
          workflow_actor_id = $3,
          asunto = 'Solicitud ARCO ejecutada', descripcion = 'Contenido de la solicitud redactado tras la supresión.', evidencia_urls = '{}',
          estado = 'RESUELTO', resuelto_en = NOW(), fecha_actualizacion = NOW()
          WHERE id = $1 RETURNING id, estado, suppression_executed_at, suppression_manifest`,
        [id, JSON.stringify(manifest), req.user.id]);
        return completed.rows[0];
    });
    return res.json({ success: true, message: 'Supresión ejecutada; el manifiesto registra categorías conservadas por obligaciones legales.', data: result });
  } catch (error) {
    if (error.code === 'ARCO_NOT_READY') return res.status(409).json({ error: error.code, message: 'La solicitud debe existir, estar verificada y no haberse ejecutado.' });
    if (error.code === 'ARCO_BIOMETRIC_FAILED') return res.status(503).json({ error: error.code, message: 'Falló la supresión biométrica; no se anonimizó la cuenta.' });
    if (error.code === 'ARCO_USER_NOT_FOUND') return res.status(404).json({ error: error.code });
    return responderErrorDeBase(error, res, 'POST /api/admin/tickets/:id/arco/execute');
  }
};

exports.auditoriaTicket = async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'FORMATO_INVALIDO' });
  try {
    const rows = await sequelize.query(`SELECT id, requester_id, actor_id, event_type,
      state_before, state_after, details, happened_at FROM ticket_workflow_audit
      WHERE ticket_id = :id ORDER BY happened_at, id`,
    { replacements: { id: req.params.id }, type: QueryTypes.SELECT });
    return res.json({ success: true, data: rows });
  } catch (error) { return responderErrorDeBase(error, res, 'GET /api/admin/tickets/:id/audit'); }
};

// ── POST /api/admin/tickets/:id/respuesta ──────────────────────────────────────
// Responde como operador: guarda el mensaje en el hilo, mueve el estado y fija
// `primera_respuesta_en` si es la primera. El correo al implicado es la fase siguiente.
exports.responderTicket = async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID.test(id)) {
      return res.status(400).json({ error: 'FORMATO_INVALIDO', message: 'El id del ticket no es un UUID.' });
    }

    const { mensaje, estado } = req.body || {};
    // Misma regla que en el hilo del usuario: ni vacío ni solo espacios.
    if (typeof mensaje !== 'string' || mensaje.trim().length === 0) {
      return res.status(400).json({ error: 'MENSAJE_VACIO', message: 'El mensaje no puede estar vacío.' });
    }
    const texto = mensaje.trim();

    let nuevoEstado = estado;
    if (nuevoEstado !== undefined) {
      const motivo = await motivoInvalido('tickets', 'estado', nuevoEstado);
      if (motivo) return res.status(400).json({ error: 'VALOR_NO_ADMITIDO', message: motivo });
    } else {
      // Sin estado explícito, responder deja el ticket esperando al usuario.
      nuevoEstado = 'ESPERANDO_RESPUESTA_USUARIO';
    }

    const tickets = await sequelize.query(
      `SELECT id, estado, tipo, suppression_executed_at FROM tickets WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!tickets.length) {
      return res.status(404).json({ error: 'NO_ENCONTRADO', message: 'Ticket no encontrado.' });
    }
    if (tickets[0].tipo === TIPO_ARCO && ['RESUELTO', 'CERRADO'].includes(nuevoEstado)
        && !tickets[0].suppression_executed_at) {
      return res.status(409).json({ error: 'SUPRESION_NO_EJECUTADA', message: 'Ejecuta la supresión ARCO antes de cerrar el caso.' });
    }
    const cambiaEstado = nuevoEstado !== tickets[0].estado;

    const asignaciones = [
      'estado = :nuevoEstado',
      'workflow_actor_id = :actor',
      'fecha_actualizacion = NOW()',
      // La PRIMERA respuesta del operador es la que fija el tiempo de respuesta; COALESCE
      // hace que una segunda no la sobrescriba.
      'primera_respuesta_en = COALESCE(primera_respuesta_en, NOW())',
    ];
    if (cambiaEstado) {
      if (nuevoEstado === 'RESUELTO') asignaciones.push('resuelto_en = NOW()', 'cerrado_en = NULL');
      else if (nuevoEstado === 'CERRADO') asignaciones.push('cerrado_en = NOW()');
      else asignaciones.push('resuelto_en = NULL', 'cerrado_en = NULL');
    }

    // El mensaje y el estado del ticket van juntos o no van: si se guardara solo uno, el
    // hilo diría que se respondió y el ticket seguiría abierto (o al revés).
    const resultado = await sequelize.transaction(async (transaccion) => {
      const insertado = await sequelize.query(
        `INSERT INTO ticket_mensajes (ticket_id, remitente_id, mensaje, autor_tipo, es_borrador)
         VALUES (:id, :remitente, :texto, 'OPERADOR', FALSE)
         RETURNING id, ticket_id, remitente_id, mensaje, autor_tipo, es_borrador, fecha_envio`,
        {
          replacements: { id, remitente: req.user.id, texto },
          type: QueryTypes.SELECT,
          transaction: transaccion,
        }
      );

      const ticket = await sequelize.query(
          `UPDATE tickets SET ${asignaciones.join(', ')} WHERE id = :id
          RETURNING id, tipo, categoria, asunto, estado, prioridad, fecha_creacion,
                    fecha_actualizacion, primera_respuesta_en, resuelto_en, cerrado_en`,
        {
          replacements: { id, nuevoEstado, actor: req.user.id },
          type: QueryTypes.SELECT,
          transaction: transaccion,
        }
      );

      return { mensaje: insertado[0], ticket: ticket[0] };
    });

    let notification = { status: 'not_configured' };
    try {
      const recipient = await sequelize.query(
        `SELECT u.email FROM tickets t JOIN usuarios u ON u.id = t.usuario_id WHERE t.id = :id`,
        { replacements: { id }, type: QueryTypes.SELECT }
      );
      const mailer = require('../services/emailService');
      if (recipient[0]?.email && (process.env.BREVO_API_KEY || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS))) {
        const sent = await mailer.sendEmail({ to: recipient[0].email, subject: 'Actualización de tu solicitud GlowApp',
          data: { text: `Hay una actualización en tu ticket ${id}. Ingresa a GlowApp > Centro de Soporte > Mis solicitudes para consultarla.` } });
        notification = sent?.devMode ? { status: 'not_configured' } : { status: 'sent' };
      }
    } catch (mailError) { console.error('[tickets] respuesta guardada; notificación no enviada:', mailError.message); notification = { status: 'failed' }; }

    return res.status(201).json({
      success: true,
      message: 'Respuesta registrada.',
      data: {
        ticket: conTiempos(resultado.ticket, new Date()),
        mensaje: resultado.mensaje,
        notification,
      },
    });
  } catch (error) {
    return responderErrorDeBase(error, res, 'POST /api/admin/tickets/:id/respuesta');
  }
};

exports.conTiempos = conTiempos;
exports.TIPO_ARCO = TIPO_ARCO;
