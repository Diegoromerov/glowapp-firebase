// backend/src/routes/enviaWebhook.js
// Webhook handler Envíame — F1 Logística
// Recibe eventos de tracking y actualiza tabla envios + pedidos_tienda

const express = require('express');
const router = express.Router();
const { pool, systemPool } = require('../config/db');
const { runAsSystem } = require('../config/tenantRouting');
const { enviameClient } = require('../services/enviameClient');
const { recordWebhookEvent } = require('../services/webhookEventLog');
const fcmService = require('../services/fcmNotificationService');

// Middleware para capturar raw body (necesario para verificación HMAC)
router.use(express.raw({ type: 'application/json' }));

// Este webhook no nace de una petición autenticada: no hay tenant ni usuario en
// el contexto, y con RLS activo app_rls_user no ve ni envios ni pedidos_tienda
// (medido en staging: 0 filas sin escalar). Igual que el webhook de Wompi, cada
// bloque escala a app_system (BYPASSRLS, alcance transaccional).
const withSystem = (fn) => runAsSystem({ pool, systemPool }, fn);

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
      await withSystem((db) => recordWebhookEvent(db, {
        provider: 'envia',
        eventId: eventData.event_id || `env_${Date.now()}`,
        eventType: eventData.event || 'firma_invalida',
        payload: eventData,
        result: { procesado: false, motivo: 'firma_invalida' },
        errorMessage: 'HMAC signature mismatch'
      })).catch((e) => console.warn('[ENVIA WEBHOOK] No se pudo registrar el evento:', e.message));
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
    // Columnas reales de webhook_events (130 + 164): event_type y payload_hash
    // son NOT NULL; payload/recibido_en no existen en el esquema.
    const webhookRes = await withSystem((db) => db.query(
      `INSERT INTO webhook_events
         (provider, event_id, event_type, payload_hash, evento_tipo,
          tracking_number, shipment_id, payload_previo_hash, procesado_ok, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9::jsonb)
       ON CONFLICT (provider, event_id) DO NOTHING
       RETURNING id`,
      ['envia', normalized.event_id, evento_tipo, payloadHash, evento_tipo,
       tracking_number, shipment_id, payloadHash, JSON.stringify(eventData)]
    ));

    if (webhookRes.rows.length === 0) {
      console.log('[ENVIA WEBHOOK] Evento duplicado (idempotencia por provider+event_id), ignorando');
      return res.json({ received: true, duplicate: true });
    }
    webhookRecordId = webhookRes.rows[0].id;
  } catch (e) {
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
      procesadoOk = await withSystem((db) => _handleStatusUpdate(db, tracking_number, shipment_id, status, timestamp, eventData));
    } else if (evento_tipo === 'pickup.scheduled' || evento_tipo === 'pickup.created') {
      procesadoOk = await withSystem((db) => _handlePickupScheduled(db, tracking_number, shipment_id, eventData));
    } else if (evento_tipo === 'pickup.collected' || evento_tipo === 'pickup.completed') {
      procesadoOk = await withSystem((db) => _handlePickupCollected(db, tracking_number, shipment_id, timestamp, eventData));
    } else if (evento_tipo === 'shipment.delivered') {
      procesadoOk = await withSystem((db) => _handleDelivered(db, tracking_number, shipment_id, timestamp, eventData));
    } else if (evento_tipo === 'shipment.failed' || evento_tipo === 'shipment.returned') {
      procesadoOk = await withSystem((db) => _handleFailedOrReturned(db, tracking_number, shipment_id, status, timestamp, eventData));
    } else {
      console.log(`[ENVIA WEBHOOK] Evento no manejado: ${evento_tipo}`);
      procesadoOk = true; // No es error, solo no hacemos nada
    }
  } catch (e) {
    errorMsg = e.message;
    console.error('[ENVIA WEBHOOK] Error procesando:', e);
  }

  // 6. Actualizar registro webhook_events con resultado
  await withSystem((db) => db.query(
    `UPDATE webhook_events SET
       procesado_ok = $1,
       error_mensaje = $2,
       procesado_en = NOW(),
       reintentos = reintentos + 1
     WHERE id = $3`,
    [procesadoOk, errorMsg, webhookRecordId]
  ));

  const latency = Date.now() - startTime;
  console.log(`[ENVIA WEBHOOK] Procesado en ${latency}ms | OK: ${procesadoOk}`);

  res.json({ received: true, processed: procesadoOk });
});

// ────────────────────────────────────────────────────────────────────────
// HANDLERS ESPECÍFICOS
// ────────────────────────────────────────────────────────────────────────

async function _handleStatusUpdate(db, trackingNumber, shipmentId, status, timestamp, rawData) {
  if (!trackingNumber) return false;

  // La transacción la abre runAsSystem (withSystem); aquí no se abre otra.
  // Buscar envío por guía
  const envioRes = await db.query(
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

  // Actualizar envío. actualizado_en va una sola vez: repetirlo en el SET
  // hacía que Postgres rechazara la sentencia con 'multiple assignments'.
  const updateFields = ['estado = $1', 'actualizado_en = NOW()'];
  const updateValues = [estadoInterno];
  let paramIdx = 2;

  if (rawData.tracking_url) {
    updateFields.push(`url_rastreo = $${paramIdx++}`);
    updateValues.push(rawData.tracking_url);
  }

  updateValues.push(trackingNumber);
  await db.query(
    `UPDATE envios SET ${updateFields.join(', ')} WHERE guia = $${paramIdx}`,
    updateValues
  );

  // Si ENTREGADO → actualizar pedido
  if (estadoInterno === 'ENTREGADO') {
    await db.query(
      `UPDATE pedidos_tienda SET estado = 'ENTREGADO', entregado_en = $1 WHERE id = $2`,
      [timestamp ? new Date(timestamp) : new Date(), envio.pedido_id]
    );

    // Notificar al cliente
    await _notifyClientDelivery(db, envio.comprador_id, envio.pedido_id, trackingNumber);
  }

  // Si FALLIDO → crear tarea para CS
  if (estadoInterno === 'FALLIDO') {
    await _createFailedDeliveryTask(db, envio, rawData);
  }

  return true;
}

async function _handlePickupScheduled(db, trackingNumber, shipmentId, rawData) {
  if (!trackingNumber) return false;

  await db.query(
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

async function _handlePickupCollected(db, trackingNumber, shipmentId, timestamp, rawData) {
  if (!trackingNumber) return false;

  await db.query(
    `UPDATE envios SET 
       estado = 'RECOGIDO',
       pickup_confirmed_at = $1,
       actualizado_en = NOW()
     WHERE guia = $2`,
    [timestamp ? new Date(timestamp) : new Date(), trackingNumber]
  );

  // Actualizar pedido a DESPACHADO si estaba en PAGADO
  await db.query(
    `UPDATE pedidos_tienda pt
     SET estado = 'DESPACHADO', despachado_en = $1
     FROM envios e
     WHERE e.guia = $2 AND e.pedido_id = pt.id AND pt.estado = 'PAGADO'`,
    [timestamp ? new Date(timestamp) : new Date(), trackingNumber]
  );

  return true;
}

async function _handleDelivered(db, trackingNumber, shipmentId, timestamp, rawData) {
  return _handleStatusUpdate(db, trackingNumber, shipmentId, 'DELIVERED', timestamp, rawData);
}

async function _handleFailedOrReturned(db, trackingNumber, shipmentId, status, timestamp, rawData) {
  const estadoInterno = status?.toUpperCase().includes('RETURN') ? 'DEVUELTO' : 'FALLIDO';
  return _handleStatusUpdate(db, trackingNumber, shipmentId, estadoInterno, timestamp, rawData);
}

// ────────────────────────────────────────────────────────────────────────
// NOTIFICACIONES Y TAREAS
// ────────────────────────────────────────────────────────────────────────

async function _notifyClientDelivery(db, userId, orderId, trackingNumber) {
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

async function _createFailedDeliveryTask(db, envio, rawData) {
  try {
    // Insertar en tabla de tareas/alertas para CS
    await db.query(
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