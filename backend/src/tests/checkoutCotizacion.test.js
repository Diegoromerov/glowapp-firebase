// Paridad entre la cotización que se cobra en la app y el pedido que se
// inserta en pedidos_tienda, más el IVA discriminado.
//
// Todo corre en memoria: pool y resolverPrecio son mocks, el cliente pg es
// falso. No hay escrituras en ninguna base de datos.

jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn()
  }
}));

jest.mock('../services/precioService', () => ({
  resolverPrecio: jest.fn()
}));

const { pool } = require('../config/db');
const { resolverPrecio } = require('../services/precioService');
const orderController = require('../controllers/orderController');

const ZONAS = [
  {
    ciudad: 'Bogotá',
    tarifa_base: '9000.00',
    tarifa_por_kg: '400.00',
    gratis_desde_monto: '300000.00',
    transportadora_default: 'Servientrega',
    activa: true
  },
  {
    ciudad: 'OTRO',
    tarifa_base: '15000.00',
    tarifa_por_kg: '800.00',
    gratis_desde_monto: '480000.00',
    transportadora_default: 'Coordinadora',
    activa: true
  }
];

function clienteFalso() {
  const insertsPedido = [];
  const client = {
    insertsPedido,
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      const q = String(sql);
      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return { rows: [] };
      if (q.includes('FROM productos WHERE id')) {
        return { rows: [{ id: 101, nombre: 'Crema de prueba', stock: 10 }] };
      }
      if (q.includes('UPDATE productos SET stock')) return { rows: [] };
      if (q.includes('FROM zonas_envio')) return { rows: ZONAS };
      // Main resolvió el NOT NULL de pedidos_tienda.tenant_id leyendo el tenant del
      // comprador (o el de plataforma). Sin fila, el checkout responde 409.
      if (q.includes('app_platform_tenant_id()')) {
        return { rows: [{ tenant_id: '00000000-0000-0000-0000-0000000000aa' }] };
      }
      if (q.includes('INSERT INTO pedidos_tienda')) {
        insertsPedido.push(params);
        return {
          rows: [
            {
              id: '00000000-0000-0000-0000-000000000001',
              subtotal: params[5],
              envio: params[6],
              iva: params[7],
              total: params[8],
              estado: 'PENDIENTE_PAGO'
            }
          ]
        };
      }
      return { rows: [] };
    })
  };
  return client;
}

function respuestaFalsa() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

const BODY = {
  nombre_entrega: 'Cliente de prueba',
  direccion_entrega: 'Calle 100 #15-20',
  ciudad_entrega: 'Bogotá',
  items: [{ producto_id: 101, cantidad: 1 }]
};

describe('IVA discriminado y paridad cotización ↔ pedido', () => {
  let client;

  beforeEach(() => {
    client = clienteFalso();
    pool.connect.mockResolvedValue(client);
    pool.query.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM zonas_envio')) return { rows: ZONAS };
      return { rows: [] };
    });
    resolverPrecio.mockResolvedValue({
      lista: 'cliente',
      precio: 30000,
      unidad_minima: 1,
      incluye_iva: true
    });
  });

  test('cotización: 30.000 de vitrina → base 25.210, iva 4.790 y total 40.200 con envío 10.200', async () => {
    const req = { user: { id: 5, role: 'client' }, body: BODY };
    const res = respuestaFalsa();

    await orderController.cotizarEnvio(req, res);

    expect(res.statusCode).toBeNull();
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      // El pedido guarda la base neta; la vitrina cobra 30.000 con IVA dentro.
      subtotal: 25210,
      subtotal_con_iva: 30000,
      iva: 4790,
      envio: 10200,
      total: 40200
    });
    expect(res.body.data.envio_detalle.zona).toBe('Bogotá');
    // La cotización no escribe: no hay INSERT ni BEGIN en el cliente falso.
    expect(client.insertsPedido).toHaveLength(0);
  });

  test('el total cobrado (cotización) es idéntico al total insertado en pedidos_tienda', async () => {
    const reqCotizacion = { user: { id: 5, role: 'client' }, body: BODY };
    const resCotizacion = respuestaFalsa();
    await orderController.cotizarEnvio(reqCotizacion, resCotizacion);
    const cotizacion = resCotizacion.body.data;

    const reqPedido = { user: { id: 5, role: 'client' }, body: BODY };
    const resPedido = respuestaFalsa();
    await orderController.createOrder(reqPedido, resPedido);

    expect(resPedido.statusCode).toBe(201);
    expect(client.insertsPedido).toHaveLength(1);

    // [comprador, rol, booking, prestador, comisión, subtotal, envio, iva, total, ...]
    const params = client.insertsPedido[0];
    expect(params[5]).toBe(cotizacion.subtotal);
    expect(params[6]).toBe(cotizacion.envio);
    expect(params[7]).toBe(cotizacion.iva);
    expect(params[8]).toBe(cotizacion.total);

    // Y el pedido insertado coincide con lo que la app manda a la pasarela.
    expect(resPedido.body.data.order.total).toBe(40200);
    expect(resPedido.body.data.envio.envio).toBe(10200);
  });
});
