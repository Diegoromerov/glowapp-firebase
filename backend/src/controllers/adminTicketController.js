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

    return res.json({ success: true, data: { ...conTiempos(tickets[0], new Date()), mensajes } });
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
      `SELECT id, estado FROM tickets WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!actuales.length) {
      return res.status(404).json({ error: 'NO_ENCONTRADO', message: 'Ticket no encontrado.' });
    }
    const cambiaEstado = estado !== undefined && estado !== actuales[0].estado;

    const asignaciones = ['fecha_actualizacion = NOW()'];
    const reemplazos = { id };

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
      `SELECT id, estado FROM tickets WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!tickets.length) {
      return res.status(404).json({ error: 'NO_ENCONTRADO', message: 'Ticket no encontrado.' });
    }
    const cambiaEstado = nuevoEstado !== tickets[0].estado;

    const asignaciones = [
      'estado = :nuevoEstado',
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
          replacements: { id, nuevoEstado },
          type: QueryTypes.SELECT,
          transaction: transaccion,
        }
      );

      return { mensaje: insertado[0], ticket: ticket[0] };
    });

    return res.status(201).json({
      success: true,
      message: 'Respuesta registrada.',
      data: {
        ticket: conTiempos(resultado.ticket, new Date()),
        mensaje: resultado.mensaje,
        // Se declara para que el panel no dé por hecho una notificación que la fase
        // siguiente todavía no hace.
        correo_enviado: false,
        correo_pendiente: true,
      },
    });
  } catch (error) {
    return responderErrorDeBase(error, res, 'POST /api/admin/tickets/:id/respuesta');
  }
};

exports.conTiempos = conTiempos;
exports.TIPO_ARCO = TIPO_ARCO;
