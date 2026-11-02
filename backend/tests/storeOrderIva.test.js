/**
 * Totales del pedido: IVA sobre precios de lista.
 *
 * `listas_precios.incluye_iva` decide si el precio ya trae IVA. La lista `cliente`
 * (consumidor final) lo incluye: sumarle 19 % cobraba 19 % mas que el precio
 * exhibido en la vitrina y descuadraba la factura, que asume base + impuesto +
 * envio = total.
 */

jest.mock('../src/config/db', () => ({
  pool: { connect: jest.fn(), query: jest.fn() }
}));

const { pool } = require('../src/config/db');
const { createOrder } = require('../src/controllers/orderController');

const BOOKING_ID = '550e8400-e29b-41d4-a716-446655440000';

function resMock() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

/** Monta la cadena de queries de createOrder con un precio/IVA de lista dados. */
function montarEscenario({ precio, incluyeIva, cantidad = 1 }) {
  const client = { query: jest.fn(), release: jest.fn() };
  pool.connect.mockResolvedValue(client);

  pool.query
    .mockResolvedValueOnce({
      rows: [{ id: 1, codigo: 'cliente', nombre: 'Lista', rol_destino: 'CLIENTE', incluye_iva: incluyeIva }]
    })
    .mockResolvedValueOnce({
      rows: [{ precio, unidad_minima: 1, vigente_desde: '2024-01-01', vigente_hasta: null }]
    });

  client.query
    .mockResolvedValueOnce({ rows: [] })                                   // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: BOOKING_ID, provider_id: 2, client_id: 1 }] }) // booking
    .mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Producto', stock: 50, precio }] }) // FOR UPDATE
    .mockResolvedValueOnce({ rows: [] })                                   // UPDATE stock
    .mockResolvedValueOnce({ rows: [{ tenant_id: 7 }] })                   // tenant
    .mockResolvedValueOnce({ rows: [{ id: 'order-1', estado: 'PENDIENTE_PAGO' }] }) // INSERT pedido
    .mockResolvedValueOnce({ rows: [] })                                   // INSERT detalle
    .mockResolvedValueOnce({ rows: [] });                                  // COMMIT

  return client;
}

function paramsDelInsert(client) {
  const call = client.query.mock.calls.find((c) => c[0].includes('INSERT INTO pedidos_tienda'));
  const [comprador, rol, booking, prestador, comision, subtotal, envio, iva, total] = call[1];
  return { comprador, rol, booking, subtotal, envio, iva, total };
}

const user = { id: 1, role: 'client', email: 'client@test.com' };

async function crearPedido({ precio, incluyeIva, cantidad = 1 }) {
  const client = montarEscenario({ precio, incluyeIva, cantidad });
  const req = {
    user,
    ip: '127.0.0.1',
    body: {
      booking_id: BOOKING_ID, // entrega en cita: sin envio
      nombre_entrega: 'Juan Pérez',
      direccion_entrega: 'Calle 123 #45-67',
      items: [{ producto_id: 1, cantidad }]
    }
  };
  const res = resMock();
  await createOrder(req, res);
  return { res, params: paramsDelInsert(client) };
}

describe('createOrder — IVA segun la lista de precios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset();
    pool.connect.mockReset();
  });

  test('lista que INCLUYE IVA: el total es el precio exhibido, no 1,19x', async () => {
    const { res, params } = await crearPedido({ precio: 33880, incluyeIva: true, cantidad: 1 });

    expect(res.status).toHaveBeenCalledWith(201);
    // 33880 bruto -> base 28471 + IVA 5409
    expect(params.subtotal).toBe(28471);
    expect(params.iva).toBe(5409);
    expect(params.total).toBe(33880); // exactamente lo que decia la vitrina
    expect(params.subtotal + params.iva + params.envio).toBe(params.total);
  });

  test('lista que NO incluye IVA: se suma el 19 % sobre la base', async () => {
    const { params } = await crearPedido({ precio: 50000, incluyeIva: false, cantidad: 2 });
    expect(params.subtotal).toBe(100000);
    expect(params.iva).toBe(19000);
    expect(params.total).toBe(119000);
    expect(params.subtotal + params.iva + params.envio).toBe(params.total);
  });

  test('cantidad > 1 respeta el desglose por linea', async () => {
    const { params } = await crearPedido({ precio: 33880, incluyeIva: true, cantidad: 3 });
    expect(params.subtotal + params.iva).toBe(33880 * 3);
    expect(params.total).toBe(33880 * 3);
    expect(params.iva).toBeGreaterThan(0);
  });

  test('base + IVA + envio siempre reconstruye el total', async () => {
    const { params } = await crearPedido({ precio: 19900, incluyeIva: true, cantidad: 2 });
    expect(params.subtotal + params.iva + params.envio).toBe(params.total);
  });
});
