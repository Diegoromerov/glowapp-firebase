// backend/src/controllers/trackingController.js
// Tracking unificado: cliente (público con rate-limit) + proveedor (autenticado)

const { pool } = require('../config/db');
const { runInTenantTransaction } = require('../config/tenantRouting');

/**
 * GET /api/tracking/:guia
 * Público: tracking unificado para cliente final
 * Rate-limit: 30 req/min por IP (configurado en ruta)
 */
async function getPublicTracking(req, res) {
  try {
    const { guia } = req.params;
    if (!guia || guia.trim().length === 0) {
      return res.status(400).json({ error: 'Guía requerida' });
    }

    // Buscar envío + pedido + eventos de webhook (historial)
    const { rows } = await pool.query(
      `SELECT 
         e.guia, e.transportadora, e.estado, e.url_rastreo, e.label_pdf_url,
         e.creado_en, e.recogido_en, e.entregado_en, e.actualizado_en,
         e.origen_ciudad, e.origen_departamento,
         e.destino_ciudad, e.destino_departamento,
         pt.id as pedido_id, pt.total, pt.nombre_entrega,
         pt.ciudad as destino_ciudad_pedido, pt.departamento as destino_departamento_pedido
       FROM envios e
       JOIN pedidos_tienda pt ON pt.id = e.pedido_id
       WHERE e.guia = $1`,
      [guia]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    const envio = rows[0];
    const simulated = String(envio.guia || '').startsWith('MOCK-')
      || String(envio.label_pdf_url || '').startsWith('https://mock.envia.com/');

    // Obtener historial de estados desde webhook_events
    const historialRes = await pool.query(
      `SELECT 
         we.event_type as evento,
         we.procesado_en as timestamp,
         we.payload->>'ubicacion' as ubicacion,
         we.payload->>'detalle' as detalle,
         'webhook' as fuente
       FROM webhook_events we
       WHERE we.tracking_number = $1
         AND we.procesado_ok = true
       ORDER BY we.procesado_en ASC`,
      [guia]
    );

    // Construir timeline cronológico
    const timeline = [];

    // Estado inicial: CREADO
    timeline.push({
      estado: 'CREADO',
      timestamp: envio.creado_en,
      ubicacion: `${envio.origen_ciudad}, ${envio.origen_departamento}`,
      detalle: simulated
        ? 'Guía simulada; no hay recolección real programada'
        : 'Etiqueta generada, pendiente de recolección',
      fuente: 'sistema',
    });

    // Eventos de webhook
    for (const h of historialRes.rows) {
      timeline.push({
        estado: h.evento,
        timestamp: h.timestamp,
        ubicacion: h.ubicacion || null,
        detalle: h.detalle || null,
        fuente: h.fuente,
      });
    }

    // Si hay recogido_en pero no está en timeline, añadirlo
    if (envio.recogido_en && !timeline.some(t => t.estado === 'RECOGIDO')) {
      timeline.push({
        estado: 'RECOGIDO',
        timestamp: envio.recogido_en,
        ubicacion: `${envio.origen_ciudad}, ${envio.origen_departamento}`,
        detalle: 'Paquete recogido por transportadora',
        fuente: 'sistema',
      });
    }

    // Si hay entregado_en pero no está en timeline, añadirlo
    if (envio.entregado_en && !timeline.some(t => t.estado === 'ENTREGADO')) {
      timeline.push({
        estado: 'ENTREGADO',
        timestamp: envio.entregado_en,
        ubicacion: `${envio.destino_ciudad || envio.destino_ciudad_pedido}, ${envio.destino_departamento || envio.destino_departamento_pedido}`,
        detalle: 'Entrega confirmada',
        fuente: 'sistema',
      });
    }

    // Ordenar por timestamp
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Estimar SLA
    const slaDias = envio.estado === 'ENTREGADO' ? null : 3; // default 3 días

    res.json({
      success: true,
      data: {
        guia: envio.guia,
        transportadora: envio.transportadora,
        simulated,
        estado_actual: envio.estado,
        url_rastreo: envio.url_rastreo,
        pedido_id: envio.pedido_id,
        timeline,
        sla_estimado_dias: slaDias,
        origen: `${envio.origen_ciudad}, ${envio.origen_departamento}`,
        destino: `${envio.destino_ciudad || envio.destino_ciudad_pedido}, ${envio.destino_departamento || envio.destino_departamento_pedido}`,
      },
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/tracking/:guia:', error);
    res.status(500).json({ error: 'Error al obtener tracking' });
  }
}

/**
 * GET /api/provider/tracking/:guia
 * Autenticado (provider/salon): tracking + acciones permitidas
 */
async function getProviderTracking(req, res) {
  const providerId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      const { guia } = req.params;
      if (!guia) {
        return res.status(400).json({ error: 'Guía requerida' });
      }

      // Verificar que el envío pertenece a este proveedor
      const envioRes = await client.query(
        `SELECT 
           e.*, pt.id as pedido_id, pt.total, pt.nombre_entrega, pt.direccion_entrega,
           pt.ciudad, pt.departamento, pt.codigo_postal
         FROM envios e
         JOIN pedidos_tienda pt ON pt.id = e.pedido_id
         WHERE e.guia = $1 AND pt.prestador_comisionado_id = $2`,
        [guia, providerId]
      );

      if (envioRes.rows.length === 0) {
        return res.status(404).json({ error: 'Envío no encontrado o no autorizado' });
      }

      const envio = envioRes.rows[0];
      const simulated = String(envio.guia || '').startsWith('MOCK-')
        || String(envio.label_pdf_url || '').startsWith('https://mock.envia.com/');

      // Historial (mismo query que público)
      const historialRes = await client.query(
        `SELECT 
           we.event_type as evento,
           we.procesado_en as timestamp,
           we.payload->>'ubicacion' as ubicacion,
           we.payload->>'detalle' as detalle,
           'webhook' as fuente
         FROM webhook_events we
         WHERE we.tracking_number = $1
           AND we.procesado_ok = true
         ORDER BY we.procesado_en ASC`,
        [guia]
      );

      // Timeline
      const timeline = [];
      timeline.push({
        estado: 'CREADO',
        timestamp: envio.creado_en,
        ubicacion: `${envio.origen_ciudad}, ${envio.origen_departamento}`,
        detalle: simulated
          ? 'Guía simulada; no hay recolección real programada'
          : 'Etiqueta generada por proveedor',
        fuente: 'sistema',
      });

      for (const h of historialRes.rows) {
        timeline.push({
          estado: h.evento,
          timestamp: h.timestamp,
          ubicacion: h.ubicacion || null,
          detalle: h.detalle || null,
          fuente: h.fuente,
        });
      }

      if (envio.recogido_en && !timeline.some(t => t.estado === 'RECOGIDO')) {
        timeline.push({
          estado: 'RECOGIDO',
          timestamp: envio.recogido_en,
          ubicacion: `${envio.origen_ciudad}, ${envio.origen_departamento}`,
          detalle: 'Recogido por carrier',
          fuente: 'sistema',
        });
      }

      if (envio.entregado_en && !timeline.some(t => t.estado === 'ENTREGADO')) {
        timeline.push({
          estado: 'ENTREGADO',
          timestamp: envio.entregado_en,
          ubicacion: `${envio.ciudad}, ${envio.departamento}`,
          detalle: 'Entregado al cliente',
          fuente: 'sistema',
        });
      }

      timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Acciones permitidas según estado actual
      const accionesPermitidas = [];
      if (envio.estado === 'CREADO') {
        accionesPermitidas.push('programar_recoleccion', 'regenerar_etiqueta', 'cancelar_envio');
      } else if (envio.estado === 'RECOGIDO') {
        accionesPermitidas.push('marcar_despachado', 'reprogramar_recoleccion');
      } else if (envio.estado === 'EN_TRANSITO' || envio.estado === 'EN_CENTRO_DESTINO') {
        accionesPermitidas.push('reprogramar_entrega', 'contactar_carrier');
      } else if (envio.estado === 'SALIDA_ENTREGA') {
        accionesPermitidas.push('marcar_entregado', 'marcar_fallido', 'reprogramar_entrega');
      } else if (envio.estado === 'FALLIDO') {
        accionesPermitidas.push('reprogramar_entrega', 'iniciar_devolucion', 'contactar_cliente');
      } else if (envio.estado === 'DEVUELTO') {
        accionesPermitidas.push('procesar_devolucion');
      }

      res.json({
        success: true,
        data: {
          ...envio,
          simulated,
          timeline,
          acciones_permitidas: accionesPermitidas,
          puede_ver_label: !!envio.label_pdf_url,
          label_pdf_url: envio.label_pdf_url,
          label_zpl: envio.label_zpl,
        },
      });
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/provider/tracking/:guia:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error al obtener tracking' });
  }
}

/**
 * GET /api/admin/logistics/shipments
 * Admin: dashboard CS con filtros
 */
async function getAdminLogisticsShipments(req, res) {
  try {
    const {
      estado,
      carrier,
      fecha_desde,
      fecha_hasta,
      ciudad,
      proveedor_id,
      solo_problematicos,
      page = 1,
      limit = 50,
    } = req.query;

    let where = ['1=1'];
    const params = [];
    let paramIdx = 1;

    if (estado) {
      where.push(`e.estado = $${paramIdx++}`);
      params.push(estado);
    }
    if (carrier) {
      where.push(`e.transportadora = $${paramIdx++}`);
      params.push(carrier);
    }
    if (fecha_desde) {
      where.push(`e.creado_en >= $${paramIdx++}`);
      params.push(fecha_desde);
    }
    if (fecha_hasta) {
      where.push(`e.creado_en <= $${paramIdx++}`);
      params.push(fecha_hasta);
    }
    if (ciudad) {
      where.push(`(e.origen_ciudad ILIKE $${paramIdx} OR e.destino_ciudad ILIKE $${paramIdx})`);
      params.push(`%${ciudad}%`);
      paramIdx++;
    }
    if (proveedor_id) {
      where.push(`e.prestador_id = $${paramIdx++}`);
      params.push(proveedor_id);
    }
    if (solo_problematicos === 'true') {
      where.push(`e.estado IN ('FALLIDO', 'DEVUELTO', 'EN_TRANSITO', 'EN_CENTRO_DESTINO', 'SALIDA_ENTREGA')`);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);

    const { rows } = await pool.query(
      `SELECT 
         e.id, e.guia, e.transportadora, e.estado, e.creado_en, e.recogido_en,
         e.entregado_en, e.actualizado_en, e.url_rastreo,
         e.origen_ciudad, e.origen_departamento,
         e.destino_ciudad, e.destino_departamento,
         pt.id as pedido_id, pt.total, pt.nombre_entrega,
         e.prestador_id AS prestador_comisionado_id,
         u.nombre as proveedor_nombre,
         u.email as proveedor_email
       FROM envios e
       JOIN pedidos_tienda pt ON pt.id = e.pedido_id
       LEFT JOIN usuarios u ON u.id = e.prestador_id
       WHERE ${where.join(' AND ')}
       ORDER BY e.creado_en DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      params
    );

    // Total count
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM envios e
       JOIN pedidos_tienda pt ON pt.id = e.pedido_id
       WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countRes.rows[0].count),
        pages: Math.ceil(countRes.rows[0].count / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/logistics/shipments:', error);
    res.status(500).json({ error: 'Error al obtener envíos' });
  }
}

/**
 * POST /api/admin/logistics/shipments/:id/manual-status
 * Admin: marcar estado manual + nota obligatoria
 */
async function manualStatusShipment(req, res) {
  let client;
  try {
    const { id } = req.params;
    const { estado, nota } = req.body;
    const actorId = req.user?.id;

    const estadosValidos = ['CREADO', 'RECOGIDO', 'EN_TRANSITO', 'EN_CENTRO_DESTINO', 'SALIDA_ENTREGA', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    if (typeof nota !== 'string' || nota.trim().length < 5 || nota.trim().length > 1000) {
      return res.status(400).json({ error: 'Nota obligatoria (mín 5 caracteres)' });
    }
    if (!actorId) return res.status(401).json({ error: 'No se pudo identificar al administrador autenticado' });

    const allowedTransitions = {
      CREADO: ['RECOGIDO', 'EN_TRANSITO', 'FALLIDO', 'DEVUELTO'],
      RECOGIDO: ['EN_TRANSITO', 'EN_CENTRO_DESTINO', 'SALIDA_ENTREGA', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'],
      EN_TRANSITO: ['EN_CENTRO_DESTINO', 'SALIDA_ENTREGA', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'],
      EN_CENTRO_DESTINO: ['EN_TRANSITO', 'SALIDA_ENTREGA', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'],
      SALIDA_ENTREGA: ['EN_TRANSITO', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'],
      FALLIDO: ['EN_TRANSITO', 'ENTREGADO', 'DEVUELTO'],
      ENTREGADO: [],
      DEVUELTO: [],
    };

    client = await pool.connect();
    await client.query('BEGIN');
    const currentResult = await client.query(
      'SELECT id, pedido_id, estado FROM envios WHERE id = $1 FOR UPDATE', [id]
    );
    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Envío no encontrado' });
    }
    const current = currentResult.rows[0];
    if (!(allowedTransitions[current.estado] || []).includes(estado)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Transición no permitida: ${current.estado} → ${estado}` });
    }

    const auditNote = `[MANUAL actor=${actorId} ${current.estado}->${estado} ${new Date().toISOString()}] ${nota.trim()}`;
    const { rows } = await client.query(
      `UPDATE envios SET
         estado = $1,
         observaciones = COALESCE(observaciones, '') || E'\\n' || $2,
         entregado_en = CASE WHEN $1 = 'ENTREGADO' THEN COALESCE(entregado_en, NOW()) ELSE entregado_en END,
         actualizado_en = NOW()
       WHERE id = $3
       RETURNING *`,
      [estado, auditNote, id]
    );

    if (estado === 'ENTREGADO') {
      await client.query(
        `UPDATE pedidos_tienda pt SET estado = 'ENTREGADO', entregado_en = COALESCE(pt.entregado_en, NOW())
          WHERE pt.id = $1 AND EXISTS (SELECT 1 FROM envios e WHERE e.pedido_id = pt.id)
            AND NOT EXISTS (
            SELECT 1 FROM envios e WHERE e.pedido_id = pt.id AND e.estado <> 'ENTREGADO'
          )`,
        [current.pedido_id]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        console.error('❌ ERROR AL REVERTIR CAMBIO MANUAL DE ENVÍO:', rollbackError);
      }
    }
    console.error('❌ ERROR EN POST /api/admin/logistics/shipments/:id/manual-status:', error);
    res.status(500).json({ error: 'Error al actualizar estado' });
  } finally {
    client?.release();
  }
}

/**
 * POST /api/admin/logistics/shipments/:id/reprocess-webhook
 * Admin: reprocesar webhook atascado
 */
async function reprocessWebhook(req, res) {
  try {
    const { id } = req.params;
    const { event_id } = req.body; // opcional: event_id específico

    // Buscar webhook_events fallidos/pendientes para este envío
    let where = 'shipment_id = $1 AND procesado_ok IS NOT TRUE';
    const params = [id];
    if (event_id) {
      where += ' AND event_id = $2';
      params.push(event_id);
    }

    const { rows } = await pool.query(
      `SELECT * FROM webhook_events WHERE ${where} ORDER BY creado_en ASC LIMIT 10`,
      params
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No hay webhooks pendientes para este envío' });
    }

    // Re-enviar al handler (importar dinámicamente para evitar circular)
    const { procesarWebhookEvento } = require('../routes/enviaWebhook');
    const resultados = [];

    for (const we of rows) {
      try {
        // Simular request/response mínimo
        const mockReq = { body: we.payload };
        const mockRes = {
          json: (d) => d,
          status: (c) => ({ json: (d) => ({ status: c, ...d }) }),
        };
        await procesarWebhookEvento(mockReq, mockRes);
        resultados.push({ event_id: we.event_id, ok: true });
      } catch (e) {
        resultados.push({ event_id: we.event_id, ok: false, error: e.message });
      }
    }

    res.json({ success: true, data: { reprocesados: resultados.length, resultados } });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/admin/logistics/shipments/:id/reprocess-webhook:', error);
    res.status(500).json({ error: 'Error al reprocesar webhook' });
  }
}

module.exports = {
  getPublicTracking,
  getProviderTracking,
  getAdminLogisticsShipments,
  manualStatusShipment,
  reprocessWebhook,
};
