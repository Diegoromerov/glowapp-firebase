// El webhook de la tienda cerraba pedidos pero no dejaba rastro: `webhook_events`
// solo la escribían las suscripciones. Sin fila no se puede auditar un pago ni
// detectar un evento que nunca llegó. Esta entrada centraliza el registro para
// todos los webhooks de pasarela.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const { recordWebhookEvent } = require(
  path.join(__dirname, '..', 'services', 'webhookEventLog')
);

function clienteEspia(filas = [{ id: 'evt-uuid' }]) {
  const llamadas = [];
  return {
    llamadas,
    query: async (sql, params) => {
      llamadas.push({ sql, params });
      return { rows: filas };
    },
  };
}

test('inserta el evento con proveedor, tipo y hash del payload', async () => {
  const client = clienteEspia();
  const payload = { event: 'transaction.updated', data: { transaction: { id: 'w-1' } } };

  const fila = await recordWebhookEvent(client, {
    provider: 'wompi',
    eventId: 'w-1',
    eventType: 'transaction.updated',
    payload,
    result: { estado: 'pedido_pagado' },
  });

  const { sql, params } = client.llamadas[0];
  assert.match(sql, /INSERT INTO webhook_events/i);
  assert.match(sql, /ON CONFLICT/i, 'debe ser idempotente por (provider, event_id)');
  assert.equal(params[0], 'wompi');
  assert.equal(params[1], 'w-1');
  assert.equal(params[2], 'transaction.updated');
  assert.equal(
    params[3],
    crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    'payload_hash debe ser sha256 del payload'
  );
  assert.match(params[4], /pedido_pagado/);
  assert.equal(fila.id, 'evt-uuid');
});

test('guarda el mensaje de error cuando el procesamiento falla', async () => {
  const client = clienteEspia();

  await recordWebhookEvent(client, {
    provider: 'wompi',
    eventId: 'w-2',
    eventType: 'transaction.updated',
    payload: { a: 1 },
    result: { estado: 'error' },
    errorMessage: 'Transacción de pedido no registrada; reintentar',
  });

  assert.equal(client.llamadas[0].params[5], 'Transacción de pedido no registrada; reintentar');
});

test('sin id del evento usa un id derivado del payload (los reintentos no duplican)', async () => {
  const client = clienteEspia();
  const payload = { event: 'transaction.updated', data: {} };

  const uno = await recordWebhookEvent(client, {
    provider: 'wompi', eventId: null, eventType: 'transaction.updated', payload,
  });
  const dos = await recordWebhookEvent(client, {
    provider: 'wompi', eventId: null, eventType: 'transaction.updated', payload,
  });

  const id1 = client.llamadas[0].params[1];
  const id2 = client.llamadas[1].params[1];
  assert.ok(id1 && id1.length > 10, 'debe generar un id');
  assert.equal(id1, id2, 'el mismo payload debe dar el mismo id');
  assert.ok(uno && dos);
});

test('el resultado va como JSON en la columna jsonb', async () => {
  const client = clienteEspia();

  await recordWebhookEvent(client, {
    provider: 'wompi',
    eventId: 'w-3',
    eventType: 'transaction.updated',
    payload: {},
    result: { estado: 'ok', pedido: 'abc' },
  });

  assert.match(client.llamadas[0].sql, /\$5::jsonb/);
  assert.deepEqual(JSON.parse(client.llamadas[0].params[4]), { estado: 'ok', pedido: 'abc' });
});
