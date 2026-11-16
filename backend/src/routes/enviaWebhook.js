// backend/src/routes/enviaWebhook.js
// Webhook handler Envíame — F1 Logística
// Recibe eventos de tracking y actualiza tabla envios + pedidos_tienda

const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { enviameClient } = require('../services/enviameClient');
const { recordWebhookEvent } = require('../services/webhookEventLog');
const fcmService = require('../services/fcmNotificationService');

// Middleware para capturar raw body (necesario para verificación HMAC)
router.use(express.raw({ type: 'application/json' }));

// POST /api/webhooks/envia/tracking
router.post('/tracking', async (req, res) => {
  const startTime = Date.now();
  const rawBody = req.body.toString('utf8');
  const signature = req.headers['x-envia-signature'] || req.headers['x-signature'] || '';

  let eventData;
  let webhookRecordId;

  try {
    // 1. Parsear JSON
    eventData = JSON.parse(rawBody);
  } catch (e) {
    console.error('[ENVIA WEBHOOK] JSON inválido:', e.message);
    return res.status(400).json({ error: 'JSON inválido' });
  }

  // 2. Verificar firma (si no es mock mode)
  if (!enviameClient._mockMode) {
    const valid = enviameClient.verifyWebhook(rawBody, signature);
    if (!valid) {
      console.warn('[ENVIA WEBHOOK] Firma inválida', { ip: req.ip });
      await recordWebhookEvent({
        provider: 'envia',
        event_id: eventData.event_id || `env_${Date.now()}`,
        evento_tipo: eventData.event,
        payload: eventData,
        resultado: 'firma_invalida',
        error_mensaje: 'HMAC signature mismatch'
      });
      return res.status(401).json({ error: 'Firma inválida' });
    }
  }

  // 3. Normalizar evento
  const normalized = enviameClient.parseWebhookEvent(eventData);
  const { tracking_number, shipment_id, status, timestamp, evento_tipo } = normalized;

  console.log(`[ENVIA WEBHOOK] ${evento_tipo} | Guía: ${tracking_number} | Estado: ${status}`);

  // 4. Registrar en webhook_events (idempotencia por provider+event_id+payload_hash)
  const payloadHash = require('crypto').createHash('sha256').update(rawBody).digest('hex');
  
  try {
    const webhookRes = await pool.query(
      `INSERT INTO webhook_events (provider, event_id, evento_tipo, tracking_number, shipment_id, payload, payload_previo_hash, procesado_ok)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
       ON CONFLICT (provider, event_id, payload_previo_hash) DO UPDATE SET
         payload = EXCLUDED.payload,
         recibido_en = NOW()
       RETURNING id`,
      ['envia', normalized.event_id, evento_tipo, tracking_number, shipment_id, eventData, payloadHash]
    );
    webhookRecordId = webhookRecordId || webhookRes.rows[0]?.id;
  } catch (e) {
    // Si falla por conflicto único, ya se procesó
    if (e.code === '23505') {
      console.log('[ENVIA WEBHOOK] Evento duplicado (idempotencia), ignorando');
      return res.json({ received: true, duplicate: true });
    }
    throw e;
  }

  // 5. Procesar según tipo de evento
  let procesadoOk = false;
  let errorMsg = null;

  try {
    if (evento_tipo === 'shipment.status_update' || evento_tipo === 'tracking.updated') {
      procesadoOk = await _handleStatusUpdate(tracking_number, shipment_id, status, timestamp, eventData);
    } else if (evento_tipo === 'pickup.scheduled' || evento_tipo === 'pickup.created') {
      procesadoOk = await _handlePickupScheduled(tracking_number, shipment_id, eventData);
    } else if (evento_tipo === 'pickup.collected' || evento_tipo === 'pickup.completed') {
      procesadoOk = await _handlePickupCollected(tracking_number, shipment_id, timestamp, eventData);
    } else if (evento_tipo === 'shipment.delivered') {
      procesadoOk = await _handleDelivered(tracking_number, shipment_id, timestamp, eventData);
    } else if (evento_tipo === 'shipment.failed' || evento_tipo === 'shipment.returned') {
      procesadoOk = await _handleFailedOrReturned(tracking_number, shipment_id, status, timestamp, eventData);
    } else {
      console.log(`[ENVIA WEBHOOK] Evento no manejado: ${evento_tipo}`);
      procesadoOk = true; // No es error, solo no hacemos nada
    }
  } catch (e) {
    errorMsg = e.message;
    console.error('[ENVIA WEBHOOK] Error procesando:', e);
  }

  // 6. Actualizar registro webhook_events con resultado
  await pool.query(
    `UPDATE webhook_events SET 
       procesado_ok = $1, 
       error_mensaje = $2, 
       procesado_en = NOW(),
       reintentos = reintentos + 1
     WHERE id = $3`,
    [procesadoOk, errorMsg, webhookRecordId]
  );

  const latency = Date.now() - startTime;
  console.log(`[ENVIA WEBHOOK] Procesado en ${latency}ms | OK: ${procesadoOk}`);

  res.json({ received: true, processed: procesadoOk });
});

// ────────────────────────────────────────────────────────────────────────
// HANDLERS ESPECÍFICOS
// ────────────────────────────────────────────────────────────────────────

async function _handleStatusUpdate(trackingNumber, shipmentId, status, timestamp, rawData) {
  if (!trackingNumber) return false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Buscar envío por guía
    const envioRes = await client.query(
      `SELECT e.*, pt.estado as pedido_estado, pt.comprador_id, pt.prestador_comisionado_id
       FROM envios e
       JOIN pedidos_tienda pt ON pt.id = e.pedido_id
       WHERE e.guia = $1`,
      [trackingNumber]
    );

    if (envioRes.rows.length === 0) {
      console.warn(`[ENVIA WEBHOOK] Envío no encontrado para guía ${trackingNumber}`);
      return false;
    }

    const envio = envioRes.rows[0];
    
    // Mapear estado Envíame → estado interno
    const estadoMap = {
      'CREATED': 'CREADO',
      'LABEL_GENERATED': 'CREADO',
      'PICKUP_SCHEDULED': 'CREADO',
      'PICKED_UP': 'RECOGIDO',
      'IN_TRANSIT': 'EN_TRANSITO',
      'AT_DESTINATION_HUB': 'EN_CENTRO_DESTINO',
      'OUT_FOR_DELIVERY': 'SALIDA_ENTREGA',
      'DELIVERED': 'ENTREGADO',
      'DELIVERY_FAILED': 'FALLIDO',
      'RETURNED': 'DEVUELTO',
      'CANCELLED': 'DEVUELTO'
    };
    
    const estadoInterno = estadoMap[status?.toUpperCase()] || status?.toUpperCase() || 'CREADO';
    
    // Actualizar envío
    const updateFields = ['estado = $1', 'actualizado_en = NOW()'];
    const updateValues = [estadoInterno];
    let paramIdx = 2;

    if (timestamp) {
      updateFields.push(`actualizado_en = $${paramIdx++}`);
      updateValues.push(new Date(timestamp));
    }
    
    if (rawData.tracking_url) {
      updateFields.push(`url_rastreo = $${paramIdx++}`);
      updateValues.push(rawData.tracking_url);
    }

    updateValues.push(trackingNumber);
    await client.query(
      `UPDATE envios SET ${updateFields.join(', ')} WHERE guia = $${paramIdx}`,
      updateValues
    );

    // Si ENTREGADO → actualizar pedido
    if (estadoInterno === 'ENTREGADO') {
      await client.query(
        `UPDATE pedidos_tienda SET estado = 'ENTREGADO', entregado_en = $1 WHERE id = $2`,
        [timestamp ? new Date(timestamp) : new Date(), envio.pedido_id]
      );
      
      // Notificar al cliente
      await _notifyClientDelivery(client, envio.comprador_id, envio.pedido_id, trackingNumber);
    }

    // Si FALLIDO → crear tarea para CS
    if (estadoInterno === 'FALLIDO') {
      await _createFailedDeliveryTask(client, envio, rawData);
    }

    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function _handlePickupScheduled(trackingNumber, shipmentId, rawData) {
  if (!trackingNumber) return false;

  await pool.query(
    `UPDATE envios SET 
       pickup_scheduled_at = $1,
       pickup_window_start = $2,
       pickup_window_end = $3,
       pickup_id = $4,
       actualizado_en = NOW()
     WHERE guia = $5`,
    [
      rawData.scheduled_at || rawData.pickup_window_start,
      rawData.pickup_window_start,
      rawData.pickup_window_end,
      rawData.pickup_id || shipmentId,
      trackingNumber
    ]
  );
  return true;
}

async function _handlePickupCollected(trackingNumber, shipmentId, timestamp, rawData) {
  if (!trackingNumber) return false;

  await pool.query(
    `UPDATE envios SET 
       estado = 'RECOGIDO',
       pickup_confirmed_at = $1,
       actualizado_en = NOW()
     WHERE guia = $2`,
    [timestamp ? new Date(timestamp) : new Date(), trackingNumber]
  );

  // Actualizar pedido a DESPACHADO si estaba en PAGADO
  await pool.query(
    `UPDATE pedidos_tienda pt
     SET estado = 'DESPACHADO', despachado_en = $1
     FROM envios e
     WHERE e.guia = $2 AND e.pedido_id = pt.id AND pt.estado = 'PAGADO'`,
    [timestamp ? new Date(timestamp) : new Date(), trackingNumber]
  );

  return true;
}

async function _handleDelivered(trackingNumber, shipmentId, timestamp, rawData) {
  return _handleStatusUpdate(trackingNumber, shipmentId, 'DELIVERED', timestamp, rawData);
}

async function _handleFailedOrReturned(trackingNumber, shipmentId, status, timestamp, rawData) {
  const estadoInterno = status?.toUpperCase().includes('RETURN') ? 'DEVUELTO' : 'FALLIDO';
  return _handleStatusUpdate(trackingNumber, shipmentId, estadoInterno, timestamp, rawData);
}

// ────────────────────────────────────────────────────────────────────────
// NOTIFICACIONES Y TAREAS
// ────────────────────────────────────────────────────────────────────────

async function _notifyClientDelivery(client, userId, orderId, trackingNumber) {
  try {
    await fcmService.sendToUser(userId, {
      title: '📦 ¡Tu pedido ha sido entregado!',
      body: `Pedido #${orderId.slice(0,8)} fue entregado. Guía: ${trackingNumber}`,
      data: { type: 'ORDER_DELIVERED', orderId, trackingNumber, screen: `/store/orders/${orderId}` }
    });
  } catch (e) {
    console.warn('[ENVIA WEBHOOK] FCM entrega falló:', e.message);
  }
}

async function _createFailedDeliveryTask(client, envio, rawData) {
  try {
    // Insertar en tabla de tareas/alertas para CS
    await client.query(
      `INSERT INTO tareas_cs (tipo, prioridad, titulo, descripcion, datos_contexto, estado, creado_en)
       VALUES ('ENTREGA_FALLIDA', 'ALTA', $1, $2, $3, 'PENDIENTE', NOW())
       ON CONFLICT DO NOTHING`,
      [
        `Entrega fallida: Pedido ${envio.pedido_id.slice(0,8)}`,
        `Guía ${envio.guia} (${envio.transportadora}) falló: ${rawData.failure_reason || 'Sin motivo'}. Requiere reprogramación o devolución.`,
        JSON.stringify({ envio_id: envio.id, pedido_id: envio.pedido_id, guia: envio.guia, transportadora: envio.transportadora, raw: rawData })
      ]
    );
  } catch (e) {
    console.warn('[ENVIA WEBHOOK] No se pudo crear tarea CS:', e.message);
  }
}

module.exports = router;