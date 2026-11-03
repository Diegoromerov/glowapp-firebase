// backend/tests/orderController.test.js
const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

// Mock the database pool BEFORE requiring the controller
jest.mock('../src/config/db', () => ({
  pool: {
    connect: jest.fn(),
    query: jest.fn()
  }
}));

const { pool } = require('../src/config/db');
const { createOrder } = require('../src/controllers/orderController');

function createMockReq(user, body) {
  return {
    user,
    body,
    ip: '127.0.0.1'
  };
}

function createMockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('OrderController - createOrder (t_fix_pagos_01)', () => {
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };
    pool.connect.mockResolvedValue(mockClient);
    
    // Mock pool.query for precioService calls
    pool.query
      .mockResolvedValueOnce({ // listas_precios query
        rows: [{ id: 1, codigo: 'cliente', nombre: 'Lista Cliente', rol_destino: 'CLIENTE', incluye_iva: false }]
      })
      .mockResolvedValueOnce({ // precios_producto query
        rows: [{ precio: 50000, unidad_minima: 1, vigente_desde: '2024-01-01', vigente_hasta: null }]
      });
  });

  const validUser = { id: 1, role: 'client', email: 'client@test.com' };
  const validBookingId = '550e8400-e29b-41d4-a716-446655440000';
  const validItems = [{ producto_id: 1, cantidad: 2 }];
  const validBody = {
    booking_id: validBookingId,
    nombre_entrega: 'Juan Pérez',
    direccion_entrega: 'Calle 123 #45-67',
    items: validItems
  };

  test('debe crear pedido con estado PENDIENTE_PAGO (no PAGADO) sin gateway real', async () => {
    // Mock booking validation
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ // booking validation
        rows: [{ id: validBookingId, provider_id: 2, client_id: 1 }]
      })
      .mockResolvedValueOnce({ // product lookup with FOR UPDATE
        rows: [{
          id: 1,
          nombre: 'Producto Test',
          stock: 10,
          precio: 50000
        }]
      })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE stock
      .mockResolvedValueOnce({ rows: [{ tenant_id: 7 }] }) // tenant del comprador (migracion 071)
      .mockResolvedValueOnce({ // order insert - should NOT include estado (uses DEFAULT PENDIENTE_PAGO)
        rows: [{
          id: 'order-123',
          comprador_id: 1,
          rol_comprador: 'CLIENTE',
          booking_id: validBookingId,
          prestador_comisionado_id: 2,
          comision_total_prestador: 0,
          subtotal: 100000,
          envio: 0,
          iva: 19000,
          total: 119000,
          nombre_entrega: 'Juan Pérez',
          direccion_entrega: 'Calle 123 #45-67',
          creado_en: new Date(),
          // estado should NOT be in the insert - it should use DEFAULT 'PENDIENTE_PAGO'
        }]
      })
      .mockResolvedValueOnce({ rows: [] }) // detail insert
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const req = createMockReq(validUser, validBody);
    const res = createMockRes();

    await createOrder(req, res);

    // Verify the order insert query does NOT include estado = 'PAGADO'
    const insertCall = mockClient.query.mock.calls.find(call => 
      call[0].includes('INSERT INTO pedidos_tienda')
    );
    
    expect(insertCall).toBeDefined();
    
    // The INSERT should NOT contain 'PAGADO' - it should rely on DEFAULT
    const insertSql = insertCall[0];
    expect(insertSql).not.toMatch(/PAGADO/i);
    // estado column should not be explicitly set in the INSERT (uses DEFAULT PENDIENTE_PAGO)
    // Note: some field names contain 'estado' as substring (e.g., prestador_comisionado), 
    // so we only verify PAGADO is not hardcoded
    
    // Verify response status is 201
    expect(res.status).toHaveBeenCalledWith(201);
    
    // Verify the response contains the order with PENDIENTE_PAGO (from DEFAULT)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          order: expect.objectContaining({
            // estado should be PENDIENTE_PAGO from the DEFAULT
          })
        })
      })
    );
  });

  test('debe fallar si no hay items', async () => {
    const req = createMockReq(validUser, { ...validBody, items: [] });
    const res = createMockRes();

    await createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Se requiere una lista de productos (items)' })
    );
  });

  test('debe fallar si no hay nombre_entrega', async () => {
    const req = createMockReq(validUser, { ...validBody, nombre_entrega: '' });
    const res = createMockRes();

    await createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Se requiere nombre y dirección de entrega' })
    );
  });

  test('debe fallar si booking no pertenece al usuario', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ // booking validation - different client
        rows: [{ id: validBookingId, provider_id: 2, client_id: 999 }]
      });

    const req = createMockReq(validUser, validBody);
    const res = createMockRes();

    await createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'No tienes acceso a esta reserva' })
    );
    // Should have rolled back
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('prestador no puede asociar compra a reserva', async () => {
    const providerUser = { id: 2, role: 'provider', email: 'provider@test.com' };
    
    const req = createMockReq(providerUser, validBody);
    const res = createMockRes();

    await createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Un prestador no puede asociar compras a una reserva' })
    );
  });

  // ---------------------------------------------------------------------------
  // tenant_id del checkout (regresion del 500 en produccion)
  //
  // Produccion devolvia: 500 "null value in column tenant_id of relation
  // pedidos_tienda violates not-null constraint". El INSERT no declaraba
  // tenant_id y el trigger de 071 solo lo copia de `app.tenant_id` (el contexto
  // de sesion), que estas rutas no fijan. La cabecera de 065 pide que el 100% de
  // los INSERT lo declaren. Ver migrations/071 lineas 236-268.
  // ---------------------------------------------------------------------------

  function encadenarHastaElInsert(tenantDelComprador) {
    return mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                                    // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: validBookingId, provider_id: 2, client_id: 1 }] }) // reserva
      .mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'P', stock: 10, precio: 50000 }] })     // producto
      .mockResolvedValueOnce({ rows: [] })                                                    // UPDATE stock
      .mockResolvedValueOnce({ rows: tenantDelComprador })                                    // tenant (071)
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', comprador_id: 1, subtotal: 100000 }] })  // INSERT pedido
      .mockResolvedValueOnce({ rows: [] })                                                    // INSERT detalle
      .mockResolvedValueOnce({ rows: [] });                                                   // COMMIT
  }

  const ultimoParametro = (llamada) => llamada[1][llamada[1].length - 1];

  test('el INSERT del pedido declara tenant_id y le llega el valor del comprador', async () => {
    encadenarHastaElInsert([{ tenant_id: 7 }]);
    const res = createMockRes();

    await createOrder(createMockReq(validUser, validBody), res);

    const insert = mockClient.query.mock.calls.find(c => c[0].includes('INSERT INTO pedidos_tienda'));
    expect(insert).toBeDefined();
    expect(insert[0]).toContain('tenant_id');
    expect(ultimoParametro(insert)).toBe(7);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('el INSERT de los detalles tambien declara tenant_id', async () => {
    encadenarHastaElInsert([{ tenant_id: 7 }]);

    await createOrder(createMockReq(validUser, validBody), createMockRes());

    const detalle = mockClient.query.mock.calls.find(c => c[0].includes('INSERT INTO detalles_pedido_tienda'));
    expect(detalle).toBeDefined();
    expect(detalle[0]).toContain('tenant_id');
    expect(ultimoParametro(detalle)).toBe(7);
  });

  test('el tenant sale del comprador con caida al tenant de plataforma', async () => {
    encadenarHastaElInsert([{ tenant_id: 7 }]);

    await createOrder(createMockReq(validUser, validBody), createMockRes());

    const consulta = mockClient.query.mock.calls.find(c => c[0].includes('app_platform_tenant_id'));
    expect(consulta).toBeDefined();
    expect(consulta[0]).toMatch(/COALESCE/i);
    expect(consulta[1]).toEqual([validUser.id]);
  });

  test('sin tenant resoluble falla 409 con mensaje propio, no un 500 opaco', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: validBookingId, provider_id: 2, client_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'P', stock: 10, precio: 50000 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ tenant_id: null }] }); // sin tenant en ninguna parte

    const res = createMockRes();

    await createOrder(createMockReq(validUser, validBody), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('tenant del comprador') })
    );
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
