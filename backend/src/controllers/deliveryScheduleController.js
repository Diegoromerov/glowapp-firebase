// backend/src/controllers/deliveryScheduleController.js
// Agenda de entrega / Citas de entrega (entrega_en_cita)

const { pool } = require('../config/db');
const { runInTenantTransaction } = require('../config/tenantRouting');

/**
 * GET /api/delivery-slots
 * Ventanas de entrega disponibles por zona y fecha
 * Query: fecha (YYYY-MM-DD), ciudad, departamento, codigo_postal
 */
async function getDeliverySlots(req, res) {
  try {
    const { fecha, ciudad, departamento, codigo_postal } = req.query;
    
    if (!fecha || !ciudad || !departamento) {
      return res.status(400).json({ error: 'fecha, ciudad y departamento son obligatorios' });
    }

    // Buscar zona de envío
    const zonaRes = await pool.query(
      `SELECT id FROM zonas_envio 
       WHERE ciudad ILIKE $1 AND departamento ILIKE $2
       ${codigo_postal ? 'AND $3 LIKE codigo_postal_prefijo || \'%\'' : ''}
       LIMIT 1`,
      codigo_postal ? [ciudad, departamento, codigo_postal] : [ciudad, departamento]
    );

    const zonaId = zonaRes.rows[0]?.id;

    // Obtener ventanas disponibles para la fecha
    // Por ahora generamos slots fijos (mañana/tarde) - en producción vendrían de ventanas_entrega (mig 173)
    const slots = [];
    const baseDate = new Date(fecha + 'T00:00:00-05:00'); // Colombia timezone
    
    // Verificar si es domingo (no hay entrega)
    if (baseDate.getDay() === 0) {
      return res.json({ success: true, data: { fecha, slots: [], mensaje: 'No hay entregas los domingos' } });
    }

    // Slots estándar: Mañana (8-12), Tarde (12-17), Extendida (17-20)
    const slotConfigs = [
      { inicio: '08:00', fin: '12:00', label: 'Mañana (8am - 12pm)', capacidad: 20 },
      { inicio: '12:00', fin: '17:00', label: 'Tarde (12pm - 5pm)', capacidad: 20 },
      { inicio: '17:00', fin: '20:00', label: 'Extendida (5pm - 8pm)', capacidad: 10 },
    ];

    for (const sc of slotConfigs) {
      const inicio = new Date(fecha + 'T' + sc.inicio + '-05:00');
      const fin = new Date(fecha + 'T' + sc.fin + '-05:00');
      
      // Contar ocupadas (pedidos con entrega_en_cita en esta ventana)
      let ocupadas = 0;
      if (zonaId) {
        const countRes = await pool.query(
          `SELECT COUNT(*) FROM pedidos_tienda
           WHERE fecha_entrega_cita = $1
             AND ventana_inicio = $2
             AND zona_id = $3
             AND estado IN ('PAGADO', 'DESPACHADO')`,
          [fecha, sc.inicio, zonaId]
        );
        ocupadas = parseInt(countRes.rows[0].count);
      }

      const disponibles = Math.max(0, sc.capacidad - ocupadas);
      
      if (disponibles > 0) {
        slots.push({
          ventana_inicio: inicio.toISOString(),
          ventana_fin: fin.toISOString(),
          label: sc.label,
          capacidad: sc.capacidad,
          ocupadas,
          disponibles,
          zona_id: zonaId
        });
      }
    }

    res.json({ success: true, data: { fecha, zona_id: zonaId, slots } });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/delivery-slots:', error);
    res.status(500).json({ error: 'Error al obtener ventanas de entrega' });
  }
}

/**
 * POST /api/orders/:id/schedule-delivery
 * Cliente agenda entrega para su pedido
 * Body: { ventana_inicio, ventana_fin } (ISO timestamps)
 */
async function scheduleDelivery(req, res) {
  try {
    const { id } = req.params;
    const { ventana_inicio, ventana_fin } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;
    const tenantId = req.user.tenant_id;

    if (!ventana_inicio || !ventana_fin) {
      return res.status(400).json({ error: 'ventana_inicio y ventana_fin son obligatorios (ISO timestamp)' });
    }

    const result = await runInTenantTransaction({ pool }, tenantId, async (client) => {
      // Verificar pedido pertenece al cliente y está en estado válido
      let whereClause = 'pt.id = $1';
      const params = [id];

      if (userRole === 'client') {
        whereClause += ' AND pt.comprador_id = $2';
        params.push(userId);
      } else if (userRole !== 'admin') {
        return { authorized: false };
      }

      const pedidoRes = await client.query(
        `SELECT pt.*, e.guia, e.estado as envio_estado
         FROM pedidos_tienda pt
         LEFT JOIN envios e ON e.pedido_id = pt.id
         WHERE ${whereClause}`,
        params
      );

      if (pedidoRes.rows.length === 0) {
        return { authorized: false };
      }

      const pedido = pedidoRes.rows[0];

      if (!['PAGADO', 'DESPACHADO'].includes(pedido.estado)) {
        return { invalidState: true, estado: pedido.estado };
      }

      if (!pedido.guia) {
        return { noEnvio: true };
      }

      // Verificar que la ventana no esté pasada
      const inicio = new Date(ventana_inicio);
      const fin = new Date(ventana_fin);
      const ahora = new Date();

      if (inicio <= ahora) {
        return { pastWindow: true };
      }

      if (fin <= inicio) {
        return { invalidWindow: true };
      }

      // Verificar disponibilidad en la zona
      const zonaRes = await client.query(
        `SELECT id FROM zonas_envio 
         WHERE ciudad ILIKE $1 AND departamento ILIKE $2 LIMIT 1`,
        [pedido.ciudad, pedido.departamento]
      );
      const zonaId = zonaRes.rows[0]?.id;

      // Actualizar pedido con cita
      await client.query(
        `UPDATE pedidos_tienda SET
           entrega_en_cita = true,
           fecha_entrega_cita = $1,
           ventana_inicio = $2,
           ventana_fin = $3,
           zona_id = $4,
           actualizado_en = NOW()
         WHERE id = $5`,
        [
          inicio.toISOString().split('T')[0], // fecha
          inicio.toTimeString().slice(0, 5),  // HH:MM
          fin.toTimeString().slice(0, 5),     // HH:MM
          zonaId,
          id
        ]
      );

      // Si hay envío, actualizar también ahí
      if (pedido.guia) {
        await client.query(
          `UPDATE envios SET
             entrega_en_cita = true,
             ventana_inicio = $1,
             ventana_fin = $2
           WHERE guia = $3`,
          [ventana_inicio, ventana_fin, pedido.guia]
        );
      }

      return { success: true, data: { pedido_id: id, ventana_inicio, ventana_fin, zona_id: zonaId } };
    });

    if (!result.authorized) {
      return res.status(403).json({ error: 'No tienes acceso a este pedido' });
    }
    if (result.invalidState) {
      return res.status(400).json({ error: `Pedido en estado ${result.estado}, debe ser PAGADO o DESPACHADO` });
    }
    if (result.noEnvio) {
      return res.status(400).json({ error: 'El pedido no tiene envío asignado aún' });
    }
    if (result.pastWindow) {
      return res.status(400).json({ error: 'La ventana de inicio debe ser futura' });
    }
    if (result.invalidWindow) {
      return res.status(400).json({ error: 'Ventana inválida: fin debe ser posterior a inicio' });
    }

    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/orders/:id/schedule-delivery:', error);
    res.status(500).json({ error: 'Error al agendar entrega' });
  }
}

/**
 * GET /api/orders/:id/delivery-schedule
 * Ver cita agendada de un pedido
 */
async function getDeliverySchedule(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const tenantId = req.user.tenant_id;

    const result = await runInTenantTransaction({ pool }, tenantId, async (client) => {
      let whereClause = 'pt.id = $1';
      const params = [id];

      if (userRole === 'client') {
        whereClause += ' AND pt.comprador_id = $2';
        params.push(userId);
      } else if (['provider', 'salon'].includes(userRole)) {
        whereClause += ' AND pt.prestador_comisionado_id = $2';
        params.push(userId);
      } else if (userRole !== 'admin') {
        return { authorized: false };
      }

      const pedidoRes = await client.query(
        `SELECT pt.entrega_en_cita, pt.fecha_entrega_cita, pt.ventana_inicio, pt.ventana_fin,
                pt.zona_id, e.guia, e.ventana_inicio as envio_ventana_inicio,
                e.ventana_fin as envio_ventana_fin, e.entrega_en_cita as envio_entrega_cita
         FROM pedidos_tienda pt
         LEFT JOIN envios e ON e.pedido_id = pt.id
         WHERE ${whereClause}`,
        params
      );

      if (pedidoRes.rows.length === 0) {
        return { authorized: false };
      }

      return { authorized: true, data: pedidoRes.rows[0] };
    });

    if (!result.authorized) {
      return res.status(403).json({ error: 'No tienes acceso a este pedido' });
    }

    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/orders/:id/delivery-schedule:', error);
    res.status(500).json({ error: 'Error al obtener agenda de entrega' });
  }
}

/**
 * DELETE /api/orders/:id/delivery-schedule
 * Cancelar cita de entrega
 */
async function cancelDeliverySchedule(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const tenantId = req.user.tenant_id;

    const result = await runInTenantTransaction({ pool }, tenantId, async (client) => {
      let whereClause = 'pt.id = $1';
      const params = [id];

      if (userRole === 'client') {
        whereClause += ' AND pt.comprador_id = $2';
        params.push(userId);
      } else if (userRole !== 'admin') {
        return { authorized: false };
      }

      const pedidoRes = await client.query(
        `SELECT pt.entrega_en_cita, e.guia
         FROM pedidos_tienda pt
         LEFT JOIN envios e ON e.pedido_id = pt.id
         WHERE ${whereClause}`,
        params
      );

      if (pedidoRes.rows.length === 0) {
        return { authorized: false };
      }

      const pedido = pedidoRes.rows[0];

      if (!pedido.entrega_en_cita) {
        return { noSchedule: true };
      }

      // Limpiar cita en pedido
      await client.query(
        `UPDATE pedidos_tienda SET
           entrega_en_cita = false,
           fecha_entrega_cita = NULL,
           ventana_inicio = NULL,
           ventana_fin = NULL,
           actualizado_en = NOW()
         WHERE id = $1`,
        [id]
      );

      // Limpiar cita en envío
      if (pedido.guia) {
        await client.query(
          `UPDATE envios SET
             entrega_en_cita = false,
             ventana_inicio = NULL,
             ventana_fin = NULL
           WHERE guia = $1`,
          [pedido.guia]
        );
      }

      return { success: true };
    });

    if (!result.authorized) {
      return res.status(403).json({ error: 'No tienes acceso a este pedido' });
    }
    if (result.noSchedule) {
      return res.status(400).json({ error: 'Este pedido no tiene cita agendada' });
    }

    res.json({ success: true, data: { message: 'Cita de entrega cancelada' } });
  } catch (error) {
    console.error('❌ ERROR EN DELETE /api/orders/:id/delivery-schedule:', error);
    res.status(500).json({ error: 'Error al cancelar cita' });
  }
}

module.exports = {
  getDeliverySlots,
  scheduleDelivery,
  getDeliverySchedule,
  cancelDeliverySchedule
};