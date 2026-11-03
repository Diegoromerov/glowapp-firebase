/**
 * Contrato de `getOrderById` (detalle de pedido de tienda).
 *
 * La app consulta este endpoint mientras espera la confirmacion del webhook. Si la
 * respuesta no trae el estado del COBRO, no puede distinguir "aun pendiente" de
 * "rechazado": el pedido sigue en PENDIENTE_PAGO en ambos casos y el cliente veia
 * "pago en proceso" aunque Wompi hubiera rechazado la transaccion.
 */

jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/services/wompiClient', () => ({}));
jest.mock('../src/services/precioService', () => ({ resolverPrecio: jest.fn() }));
jest.mock('../src/services/shippingService', () => ({ cotizarEnvio: jest.fn() }));
jest.mock('../src/services/dianInvoiceClient', () => ({ isConfigured: jest.fn(() => false) }));

const { pool } = require('../src/config/db');
const orderController = require('../src/controllers/orderController');

const ORDER_ID = '11666d5d-340b-4194-8ac3-f165d16c6724';

function resMock() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const pedido = {
  id: ORDER_ID,
  comprador_id: 7,
  estado: 'PENDIENTE_PAGO',
  subtotal: '33880.00',
  envio: '15400.00',
  iva: '6437.20',
  total: '55717.20',
  metadata: { wompi_external_id: 'TX-9', wompi_reference: 'wompi_order_x_1' }
};

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockReset();
  pool.query.mockImplementation((sql) => {
    if (/FROM pedidos_tienda WHERE id = \$1/i.test(sql)) return Promise.resolve({ rows: [pedido] });
    if (/FROM detalles_pedido_tienda/i.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM transactions WHERE external_id/i.test(sql)) {
      return Promise.resolve({ rows: [{ status: 'failed', estado_pago: 'failed', external_id: 'TX-9' }] });
    }
    return Promise.resolve({ rows: [] });
  });
});

describe('getOrderById — estado del cobro', () => {
  test('devuelve el pedido con el estado del pago (para distinguir rechazo de espera)', async () => {
    const res = resMock();
    await orderController.getOrderById(
      { params: { id: ORDER_ID }, user: { id: 7, role: 'client' } },
      res
    );

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.order.total).toBe('55717.20');
    expect(payload.data.pago).toEqual({ status: 'failed', estado_pago: 'failed', external_id: 'TX-9' });
  });

  test('consulta la transaccion por el id de Wompi guardado en metadata', async () => {
    await orderController.getOrderById(
      { params: { id: ORDER_ID }, user: { id: 7, role: 'client' } },
      resMock()
    );
    const q = pool.query.mock.calls.find(([sql]) => /FROM transactions WHERE external_id/i.test(sql));
    expect(q).toBeDefined();
    expect(q[1]).toEqual(['TX-9']);
  });

  test('sin transaccion asociada devuelve pago null (no inventa estado)', async () => {
    pool.query.mockImplementation((sql) => {
      if (/FROM pedidos_tienda WHERE id = \$1/i.test(sql)) {
        return Promise.resolve({ rows: [{ ...pedido, metadata: {} }] });
      }
      if (/FROM detalles_pedido_tienda/i.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = resMock();
    await orderController.getOrderById(
      { params: { id: ORDER_ID }, user: { id: 7, role: 'client' } },
      res
    );

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.pago).toBeNull();
    const q = pool.query.mock.calls.find(([sql]) => /FROM transactions WHERE external_id/i.test(sql));
    expect(q).toBeUndefined();
  });
});
