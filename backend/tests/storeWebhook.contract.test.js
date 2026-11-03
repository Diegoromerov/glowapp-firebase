/**
 * Contrato de `storeWebhook` (eventos de Wompi para pedidos de tienda).
 *
 * Cubre dos generaciones de defectos:
 *  - El tipo de evento: Wompi manda `"event": "transaction.updated"` como STRING
 *    (docs.wompi.co -> Eventos -> Cuerpo de un evento). Leer `event.event.type` daba
 *    `undefined` y el handler respondia 400 a TODO evento real.
 *  - La integridad: el trabajo se hace en UNA conexion con BEGIN/COMMIT y con la fila
 *    bloqueada (FOR UPDATE). Antes se hacia pool.query('BEGIN') sobre el pool, asi que
 *    la transaccion no envolvia nada, y un pago sin pedido se cerraba en silencio.
 */

jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn(), connect: jest.fn() }
}));

jest.mock('../src/services/wompiClient', () => ({
  verifyEventChecksum: jest.fn(() => ({ valid: true }))
}));

jest.mock('../src/services/precioService', () => ({ resolverPrecio: jest.fn() }));
jest.mock('../src/services/shippingService', () => ({ cotizarEnvio: jest.fn() }));
jest.mock('../src/services/dianInvoiceClient', () => ({
  isConfigured: jest.fn(() => false),
  generarFactura: jest.fn()
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/db');
const wompiClient = require('../src/services/wompiClient');
const orderController = require('../src/controllers/orderController');

function app() {
  const a = express();
  a.use(express.json());
  a.post('/wh', orderController.storeWebhook);
  return a;
}

/** Evento con la forma EXACTA que documenta Wompi. */
function eventoWompi({ status = 'APPROVED', id = 'TX-1', amountInCents = 1815000, reference } = {}) {
  return {
    event: 'transaction.updated',
    data: {
      transaction: {
        id,
        reference:
          reference === undefined
            ? 'wompi_order_8f14e45f-ceea-467f-a1c0-000000000001_1750000000000'
            : reference,
        status,
        amount_in_cents: amountInCents,
        payment_method_type: 'DAVIPLATA'
      }
    },
    environment: 'test',
    signature: {
      properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
      checksum: 'cualquiera-lo-valida-el-mock'
    },
    timestamp: 1750000000
  };
}

let client;

/**
 * Enruta las queries del mock: transaccion, pedido y las guardas de update.
 * `filasPedidoActualizadas` simula rowCount del UPDATE con guarda de estado.
 */
function enrutar({ tx = null, order = null, filasPedidoActualizadas = 1 }) {
  client.query.mockImplementation((sql) => {
    const s = String(sql).trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return Promise.resolve({ rows: [], rowCount: 0 });
    if (/SELECT \* FROM transactions/i.test(s)) return Promise.resolve({ rows: tx ? [tx] : [] });
    if (/SELECT \* FROM pedidos_tienda/i.test(s)) return Promise.resolve({ rows: order ? [order] : [] });
    if (/UPDATE pedidos_tienda SET estado = 'PAGADO'/i.test(s)) {
      return Promise.resolve({ rows: [], rowCount: filasPedidoActualizadas });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
}

function llamadas(re) {
  return client.query.mock.calls.filter(([sql]) => re.test(String(sql)));
}

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockReset();
  pool.query.mockResolvedValue({ rows: [] });
  pool.connect.mockReset();
  client = { query: jest.fn(), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
  enrutar({});
  wompiClient.verifyEventChecksum.mockReturnValue({ valid: true });
});

describe('storeWebhook — formato real de los eventos de Wompi', () => {
  test('acepta el evento con `event` como STRING (200, no 400)', async () => {
    const res = await request(app())
      .post('/wh')
      .send(eventoWompi({ reference: 'referencia_externa_1' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const select = llamadas(/SELECT \* FROM transactions/i);
    expect(select.length).toBe(1);
    // Se busca por el id de Wompi Y por la referencia del pedido: el cobro puede
    // estar registrado solo con la referencia si se inserto antes de crear la
    // transaccion (son valores distintos, no el mismo parametro repetido).
    expect(select[0][1]).toEqual(['TX-1', 'referencia_externa_1']);
    expect(String(select[0][0])).toMatch(/referencia_pasarela = \$2/);
  });

  test('tolera tambien el objeto {type} (compatibilidad)', async () => {
    const evento = eventoWompi({ reference: 'referencia_externa_1' });
    evento.event = { type: 'transaction.updated' };
    const res = await request(app()).post('/wh').send(evento);
    expect(res.status).toBe(200);
  });

  test('un cuerpo sin tipo de evento sigue respondiendo 400', async () => {
    const res = await request(app()).post('/wh').send({ data: { transaction: { id: 'X' } } });
    expect(res.status).toBe(400);
  });

  test('firma invalida responde 401 y no abre conexion', async () => {
    wompiClient.verifyEventChecksum.mockReturnValue({ valid: false, reason: 'checksum no coincide' });
    const res = await request(app()).post('/wh').send(eventoWompi());
    expect(res.status).toBe(401);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe('storeWebhook — integridad del cierre', () => {
  const txPendiente = { id: 'tx-local', status: 'pending', monto_total: 18150 };

  test('APPROVED marca el pedido PAGADO y confirma en una sola conexion', async () => {
    enrutar({ tx: txPendiente, order: { id: 'order-1', estado: 'PENDIENTE_PAGO' } });

    const res = await request(app()).post('/wh').send(eventoWompi());

    expect(res.status).toBe(200);
    const updatePedido = llamadas(/UPDATE pedidos_tienda SET estado = 'PAGADO'/i);
    expect(updatePedido.length).toBe(1);
    expect(updatePedido[0][1]).toEqual(['order-1']);
    // la guarda de estado: no revive un pedido cancelado
    expect(String(updatePedido[0][0])).toMatch(/estado = 'PENDIENTE_PAGO'/);

    const lookup = llamadas(/metadata->>'wompi_external_id'/i);
    expect(lookup.length).toBe(1);
    expect(lookup[0][1]).toEqual(['TX-1']);

    // BEGIN y COMMIT en el MISMO cliente (F7: antes iban por el pool)
    expect(llamadas(/^BEGIN/i).length).toBe(1);
    expect(llamadas(/^COMMIT/i).length).toBe(1);
    expect(llamadas(/^ROLLBACK/i).length).toBe(0);
    expect(client.release).toHaveBeenCalled();
  });

  test('APPROVED sin pedido asociado responde 500 y revierte (no cierra en silencio)', async () => {
    enrutar({ tx: txPendiente, order: null });

    const res = await request(app()).post('/wh').send(eventoWompi());

    expect(res.status).toBe(500);
    expect(llamadas(/^ROLLBACK/i).length).toBe(1);
    expect(llamadas(/^COMMIT/i).length).toBe(0);
    expect(client.release).toHaveBeenCalled();
  });

  test('APPROVED sobre pedido ya cancelado no lo revive y alerta reembolso', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    enrutar({ tx: txPendiente, order: { id: 'order-2', estado: 'CANCELADO' }, filasPedidoActualizadas: 0 });

    const res = await request(app()).post('/wh').send(eventoWompi());

    expect(res.status).toBe(200);
    const alerta = err.mock.calls.map((c) => String(c[0])).join(' ');
    expect(alerta).toMatch(/Reembolso manual/i);
    err.mockRestore();
  });

  test('monto distinto al esperado responde 500 y revierte', async () => {
    enrutar({ tx: txPendiente, order: { id: 'order-1', estado: 'PENDIENTE_PAGO' } });

    const res = await request(app())
      .post('/wh')
      .send(eventoWompi({ amountInCents: 1000 })); // 10.00 en vez de 18150.00

    expect(res.status).toBe(500);
    expect(llamadas(/^ROLLBACK/i).length).toBe(1);
    expect(llamadas(/UPDATE transactions SET status = 'paid'/i).length).toBe(0);
  });

  test('un evento DECLINED no degrada una transaccion ya pagada', async () => {
    enrutar({ tx: { id: 'tx-local', status: 'paid', monto_total: 18150 }, order: null });

    const res = await request(app()).post('/wh').send(eventoWompi({ status: 'DECLINED' }));

    expect(res.status).toBe(200);
    const update = llamadas(/UPDATE transactions SET status = 'failed'/i);
    expect(update.length).toBe(1);
    expect(String(update[0][0])).toMatch(/status <> 'paid'/);
    expect(llamadas(/UPDATE pedidos_tienda SET estado = 'PAGADO'/i).length).toBe(0);
  });

  test('un evento repetido del mismo pago es idempotente', async () => {
    enrutar({ tx: { id: 'tx-local', status: 'paid', monto_total: 18150 }, order: null });

    const res = await request(app()).post('/wh').send(eventoWompi());

    expect(res.status).toBe(200);
    expect(llamadas(/UPDATE transactions SET status = 'paid'/i).length).toBe(0);
    expect(llamadas(/^COMMIT/i).length).toBe(1);
  });

  test('transaccion desconocida con referencia de pedido propia responde 500 (Wompi reintenta)', async () => {
    enrutar({ tx: null });

    const res = await request(app()).post('/wh').send(eventoWompi());

    expect(res.status).toBe(500);
  });

  test('transaccion desconocida con referencia ajena responde 200 (no reintentos inutiles)', async () => {
    enrutar({ tx: null });

    const res = await request(app())
      .post('/wh')
      .send(eventoWompi({ reference: 'otra_cosa_123' }));

    expect(res.status).toBe(200);
  });
});
