// backend/src/services/webhookEventLog.js
//
// Registro de eventos de pasarela en `webhook_events`.
//
// Antes solo lo usaba `subscriptionService` (Stripe/Wompi SaaS). El webhook de la
// tienda cerraba pedidos sin dejar rastro: si un día faltaba un cierre, la única
// evidencia era una línea de log que se pierde. Sin fila no se puede auditar un
// pago ni detectar un evento que nunca llegó.
//
// La tabla tiene UNIQUE(provider, event_id): un reintento de la pasarela no crea
// una segunda fila, actualiza la existente con el último resultado. Eso es lo que
// interesa: el estado final del evento, no cuántas veces se reintentó.

const crypto = require('crypto');

/**
 * Registra (o actualiza) el evento de una pasarela.
 *
 * @param {{ query: Function }} client pool o cliente de una conexión
 * @param {object} datos
 * @param {string} datos.provider nombre de la pasarela ('wompi', 'stripe'…)
 * @param {string|null} datos.eventId id del evento. Si falta, se deriva del payload:
 *   así los reintentos del mismo cuerpo caen en la misma fila en vez de duplicar.
 * @param {string} datos.eventType tipo de evento tal como lo manda la pasarela
 * @param {object} datos.payload cuerpo recibido (solo se guarda su hash)
 * @param {object} [datos.result] resultado legible del procesamiento (jsonb)
 * @param {string|null} [datos.errorMessage] mensaje de error, si lo hubo
 * @returns {Promise<object|null>} la fila registrada
 */
async function recordWebhookEvent(client, {
  provider,
  eventId = null,
  eventType,
  payload = {},
  result = { procesado: true },
  errorMessage = null,
}) {
  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload ?? {}))
    .digest('hex');

  const idEvento = eventId
    ? String(eventId)
    : `${eventType || 'sin-tipo'}:${payloadHash.slice(0, 32)}`;

  const res = await client.query(
    `INSERT INTO webhook_events (provider, event_id, event_type, payload_hash, result, error_message)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (provider, event_id)
     DO UPDATE SET
       result        = EXCLUDED.result,
       error_message = EXCLUDED.error_message,
       processed_at  = now()
     RETURNING id;`,
    [
      String(provider),
      idEvento,
      String(eventType || 'desconocido'),
      payloadHash,
      JSON.stringify(result ?? {}),
      errorMessage,
    ]
  );

  return res.rows[0] || null;
}

module.exports = { recordWebhookEvent };
