/**
 * Contrato de `payOrder` (pago de pedido de tienda) contra Wompi.
 *
 * Contexto: el checkout ofrecia cinco pasarelas pero NINGUNA podia completarse.
 * `payOrder` usaba `redirect_url`/`customer_data` sin declararlos (ReferenceError),
 * mandaba `payment_method: 'NEQUI'` como string, mandaba a la vez
 * `payment_source_id` y `payment_method` con tarjeta (Wompi exige exactamente uno)
 * y guardaba la REFERENCIA en `transactions.external_id` mientras el webhook busca
 * por el ID de Wompi. Estos tests fijan el contrato para que no vuelva a pasar.
 */

jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn() }
}));

jest.mock('../src/services/wompiClient', () => ({
  isConfigured: jest.fn(() => true),
  createTransaction: jest.fn()
}));

jest.mock('../src/services/precioService', () => ({
  resolverPrecio: jest.fn()
}));

jest.mock('../src/services/shippingService', () => ({
  cotizarEnvio: jest.fn()
}));

jest.mock('../src/services/dianInvoiceClient', () => ({
  isConfigured: jest.fn(() => false),
  generarFactura: jest.fn()
}));

const { pool } = require('../src/config/db');
const wompiClient = require('../src/services/wompiClient');
const orderController = require('../src/controllers/orderController');

const ORDER_ID = '8f14e45f-ceea-467f-a1c0-000000000001';
const WOMPI_TX_ID = 'wompi-tx-abc123';

const ordenPendiente = {
  id: ORDER_ID,
  comprador_id: 1,
  estado: 'PENDIENTE_PAGO',
  total: '18150.00',
  metadata: null
};

function reqPago(body, extra = {}) {
  return {
    params: { id: ORDER_ID },
    body,
    user: { id: 1, email: 'cliente@glowapp.co' },
    ip: '190.0.0.1',
    ...extra
  };
}

function resMock() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const customerDataValido = {
  email: 'cliente@glowapp.co',
  full_name: 'Diego Romero',
  phone_number: '3001234567',
  financial_institution_code: '1007'
};

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockReset();
  wompiClient.createTransaction.mockResolvedValue({
    id: WOMPI_TX_ID,
    status: 'PENDING',
    reference: 'wompi_order_ref',
    asyncPaymentUrl: 'https://sandbox.wompi.co/v1/pse/redirect/abc'
  });

  pool.query.mockImplementation((sql) => {
    if (/SELECT \* FROM pedidos_tienda WHERE id = \$1/i.test(sql)) {
      return Promise.resolve({ rows: [ordenPendiente] });
    }
    if (/INSERT INTO transactions/i.test(sql)) {
      return Promise.resolve({ rows: [{ id: 'tx-local-1' }] });
    }
    return Promise.resolve({ rows: [] });
  });
});

describe('payOrder — contrato con Wompi', () => {
  test('Daviplata: envia payment_method string + customer_data + redirect_url (no lanza ReferenceError)', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({
        payment_method: 'DAVIPLATA',
        acceptance_token: 'acc-token',
        redirect_url: 'https://glowapp.co/pago/resultado',
        customer_data: { email: 'cliente@glowapp.co', full_name: 'Diego', phone_number: '3001234567' }
      }),
      res
    );

    expect(wompiClient.createTransaction).toHaveBeenCalledTimes(1);
    const payload = wompiClient.createTransaction.mock.calls[0][0];
    expect(payload.paymentMethod).toBe('DAVIPLATA');
    expect(payload.paymentSourceId).toBeNull();
    expect(payload.redirectUrl).toBe('https://glowapp.co/pago/resultado');
    expect(payload.customerData).toMatchObject({ full_name: 'Diego', phone_number: '3001234567' });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ async_payment_url: 'https://sandbox.wompi.co/v1/pse/redirect/abc' })
      })
    );
  });

  test('Daviplata: NO exige financial_institution_code (solo lo usa PSE)', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({
        payment_method: 'DAVIPLATA',
        acceptance_token: 'acc-token',
        redirect_url: 'https://glowapp.co/pago/resultado',
        customer_data: { email: 'c@x.co', full_name: 'Diego', phone_number: '3001234567' }
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test('PSE: sin financial_institution_code responde 400 y no llama a Wompi', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({
        payment_method: 'PSE',
        acceptance_token: 'acc-token',
        redirect_url: 'https://glowapp.co/pago/resultado',
        customer_data: { email: 'c@x.co', full_name: 'Diego', phone_number: '3001234567' }
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('PSE: con financial_institution_code pasa y envia el metodo como string', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({
        payment_method: 'PSE',
        acceptance_token: 'acc-token',
        redirect_url: 'https://glowapp.co/pago/resultado',
        customer_data: customerDataValido
      }),
      res
    );
    const payload = wompiClient.createTransaction.mock.calls[0][0];
    expect(payload.paymentMethod).toBe('PSE');
    expect(payload.customerData.financial_institution_code).toBe('1007');
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test('Nequi con telefono: payment_method es OBJETO {type, phone_number}', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({ payment_method: 'NEQUI', acceptance_token: 'acc-token', phone_number: '3001234567' }),
      res
    );
    const payload = wompiClient.createTransaction.mock.calls[0][0];
    expect(payload.paymentMethod).toEqual({ type: 'NEQUI', phone_number: '3001234567' });
    expect(payload.paymentSourceId).toBeNull();
  });

  test('Nequi con fuente de pago: usa payment_source_id y NO manda payment_method', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({ payment_method: 'NEQUI', acceptance_token: 'acc-token', payment_source_id: 'src-1' }),
      res
    );
    const payload = wompiClient.createTransaction.mock.calls[0][0];
    expect(payload.paymentSourceId).toBe('src-1');
    expect(payload.paymentMethod).toBeUndefined();
  });

  test('Tarjeta con fuente de pago: solo payment_source_id (no rompe la exclusividad de Wompi)', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({ payment_method: 'CARD', acceptance_token: 'acc-token', payment_source_id: 'src-card' }),
      res
    );
    const payload = wompiClient.createTransaction.mock.calls[0][0];
    expect(payload.paymentSourceId).toBe('src-card');
    expect(payload.paymentMethod).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test('Tarjeta con token: payment_method {type:CARD, token, installments}', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({ payment_method: 'CARD', acceptance_token: 'acc-token', payment_method_token: 'tok-1' }),
      res
    );
    const payload = wompiClient.createTransaction.mock.calls[0][0];
    expect(payload.paymentMethod).toEqual({ type: 'CARD', token: 'tok-1', installments: 1 });
    expect(payload.paymentSourceId).toBeNull();
  });

  test('el external_id local es el id de WOMPI (lo que busca el webhook), y la referencia va aparte', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({ payment_method: 'NEQUI', acceptance_token: 'acc-token', phone_number: '3001234567' }),
      res
    );

    const insert = pool.query.mock.calls.find(([sql]) => /INSERT INTO transactions/i.test(sql));
    expect(insert).toBeDefined();
    const params = insert[1];
    // [userId, monto, metodo, external_id, referencia_pasarela]
    expect(params[3]).toBe(WOMPI_TX_ID);
    expect(String(params[4])).toMatch(/^wompi_order_/);

    const update = pool.query.mock.calls.find(([sql]) => /UPDATE pedidos_tienda[\s\S]*wompi_external_id/i.test(sql));
    expect(update).toBeDefined();
    expect(update[1][1]).toBe(WOMPI_TX_ID);
    expect(String(update[1][2])).toMatch(/^wompi_order_/);

    // to_jsonb() es POLIMORFICA: con un parametro sin tipo Postgres responde
    // "could not determine polymorphic type because input has type unknown".
    // Paso en produccion y un mock no lo habria cazado; el cast se fija aqui.
    expect(update[0]).toContain('to_jsonb($2::text)');
    expect(update[0]).toContain('to_jsonb($3::text)');
  });

  test('sin acceptance_token responde 400', async () => {
    const res = resMock();
    await orderController.payOrder(reqPago({ payment_method: 'NEQUI', phone_number: '3001234567' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('un 4xx de Wompi se mapea a 402 con detalle, no a un 500 opaco', async () => {
    const err = new Error('invalid payment_method');
    err.status = 422;
    err.body = { error: { messages: { payment_method: ['invalid'] } } };
    wompiClient.createTransaction.mockRejectedValueOnce(err);

    const res = resMock();
    await orderController.payOrder(
      reqPago({ payment_method: 'NEQUI', acceptance_token: 'acc-token', phone_number: '3001234567' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'WOMPI_TRANSACTION_FAILED' })
    );
  });

  test('pedido ya pagado no se vuelve a cobrar', async () => {
    pool.query.mockImplementation((sql) => {
      if (/SELECT \* FROM pedidos_tienda WHERE id = \$1/i.test(sql)) {
        return Promise.resolve({ rows: [{ ...ordenPendiente, estado: 'PAGADO' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = resMock();
    await orderController.payOrder(
      reqPago({ payment_method: 'NEQUI', acceptance_token: 'acc-token', phone_number: '3001234567' }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });
});

describe('payOrder — un pedido no se cobra dos veces', () => {
  test('con una transaccion pendiente reciente responde 409 y NO llama a Wompi', async () => {
    pool.query.mockImplementation((sql) => {
      if (/SELECT \* FROM pedidos_tienda WHERE id = \$1/i.test(sql)) {
        return Promise.resolve({ rows: [ordenPendiente] });
      }
      if (/starts_with\(referencia_pasarela/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'tx-en-curso' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = resMock();
    await orderController.payOrder(
      reqPago({ payment_method: 'NEQUI', phone_number: '3991111111', acceptance_token: 'acc' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('la guarda mira estado pendiente, la referencia del pedido y una ventana de 15 min', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({ payment_method: 'NEQUI', phone_number: '3991111111', acceptance_token: 'acc' }),
      res
    );

    const q = pool.query.mock.calls.find(([sql]) => /starts_with\(referencia_pasarela/i.test(sql));
    expect(q).toBeDefined();
    expect(q[0]).toMatch(/status = 'pending'/);
    expect(q[0]).toMatch(/INTERVAL '15 minutes'/);
    expect(q[1]).toEqual([ORDER_ID]);
    // sin pendientes: el pago sigue su curso normal
    expect(wompiClient.createTransaction).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(202);
  });
});

describe('payOrder — redirect_url validada de verdad (A10: .isEmpty era Dart)', () => {
  test('una URL de solo espacios responde 400 y no llega a Wompi', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({
        payment_method: 'PSE',
        acceptance_token: 'acc',
        redirect_url: '   ',
        customer_data: customerDataValido
      }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('un esquema que no es http(s) responde 400', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({
        payment_method: 'PSE',
        acceptance_token: 'acc',
        redirect_url: 'javascript:alert(1)',
        customer_data: customerDataValido
      }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('una URL https valida sigue cobrando (202)', async () => {
    const res = resMock();
    await orderController.payOrder(
      reqPago({
        payment_method: 'PSE',
        acceptance_token: 'acc',
        redirect_url: 'https://glowapp-frontend-production.up.railway.app/#/pago/resultado',
        customer_data: customerDataValido
      }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(202);
    expect(wompiClient.createTransaction).toHaveBeenCalledTimes(1);
  });
});
