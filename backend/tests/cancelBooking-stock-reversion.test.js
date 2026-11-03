/**
 * TEST ROJO — P0 DINERO #2: cancelBooking NO revierte el stock de productos adicionales.
 *
 * Contexto del hallazgo:
 *   payBooking() / el webhook de Wompi decrementan el stock de los productos adicionales
 *   cuando la reserva se paga (bookingController.js ~510-543 y ~654-689).
 *   cancelBooking() (~398-435) sólo cambiaba estado a 'CANCELADA': las unidades
 *   descontadas por un pedido que ya no existe quedaban como stock "fantasma"
 *   (inventario real < stock en base), mientras el pago sí se reversa.
 *
 * Arnés: pg-mem en memoria (src/config/pgMemory.js). El esquema del arnés no declara
 * payment_status ni pin_verificacion en bookings aunque el modelo Booking SÍ las define
 * (por eso aquí se añaden con ALTER TABLE: sin ellas cualquier Booking.findOne revienta
 * con 'column "payment_status" does not exist'). Tampoco existe gen_random_uuid(),
 * así que los UUID se generan en JS.
 */

const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const { sequelize } = require('../src/config/database');
const bookingController = require('../src/controllers/bookingController');

const CLIENT_ID = 1;
const PROVIDER_ID = 2;

const app = express();
app.use(bodyParser.json());

// Auth simulado: cancelBooking sólo usa req.user.id
app.patch(
  '/api/bookings/:id/cancel',
  (req, res, next) => { req.user = { id: CLIENT_ID, role: 'CLIENTE' }; next(); },
  bookingController.cancelBooking
);

const INITIAL_STOCK = 10;

const insertBooking = async ({ estado, paymentStatus, products, clientId = CLIENT_ID }) => {
  const id = crypto.randomUUID();
  await sequelize.query(
    `INSERT INTO bookings
       (id, client_id, provider_id, service_id, scheduled_at, valor_bruto, estado, payment_status, productos_adicionales)
     VALUES
       (:id, :clientId, :providerId, :serviceId, now(), 60000, :estado, :paymentStatus, :productos)`,
    {
      replacements: {
        id,
        clientId,
        providerId: PROVIDER_ID,
        serviceId: crypto.randomUUID(),
        estado,
        paymentStatus: paymentStatus === undefined ? null : paymentStatus,
        // Formato real que persiste createBooking: { products: [...] }
        productos: products && products.length > 0 ? JSON.stringify({ products }) : null
      }
    }
  );
  return id;
};

const getStock = async (productId) => {
  const rows = await sequelize.query(
    'SELECT stock FROM productos WHERE id = :id',
    { replacements: { id: productId }, type: sequelize.QueryTypes.SELECT }
  );
  return rows[0].stock;
};

const setStock = (productId, value) => sequelize.query(
  'UPDATE productos SET stock = :value WHERE id = :id',
  { replacements: { value, id: productId }, type: sequelize.QueryTypes.UPDATE }
);

const getEstado = async (bookingId) => {
  const rows = await sequelize.query(
    'SELECT estado FROM bookings WHERE id = :id',
    { replacements: { id: bookingId }, type: sequelize.QueryTypes.SELECT }
  );
  return rows[0] && rows[0].estado;
};

describe('cancelBooking - reversión de stock (P0 DINERO #2)', () => {
  let productId;

  beforeAll(async () => {
    // El arnés en memoria no declara estas columnas que el modelo sí usa.
    await sequelize.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20)');
    await sequelize.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pin_verificacion VARCHAR(10)');

    const rows = await sequelize.query(
      `INSERT INTO productos (nombre, costo, stock, sku)
       VALUES ('Producto de prueba', 10000, :stock, 'TEST-CANCEL-STOCK')
       RETURNING id`,
      { replacements: { stock: INITIAL_STOCK }, type: sequelize.QueryTypes.SELECT }
    );
    productId = rows[0].id;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await sequelize.query('DELETE FROM bookings');
    await setStock(productId, INITIAL_STOCK);
  });

  test('revierte el stock de los productos cuando se cancela una reserva pagada', async () => {
    const products = [{ id: productId, cantidad: 2, precio: 10000, nombre: 'Producto de prueba' }];
    const bookingId = await insertBooking({ estado: 'CONFIRMADA', paymentStatus: 'paid', products });

    // payBooking ya descontó el stock al cobrar
    await setStock(productId, INITIAL_STOCK - 2);
    expect(await getStock(productId)).toBe(INITIAL_STOCK - 2);

    const res = await request(app).patch(`/api/bookings/${bookingId}/cancel`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.booking.status).toBe('CANCELADA');
    expect(await getEstado(bookingId)).toBe('CANCELADA');

    // ← assert del hallazgo: sin el fix queda en INITIAL_STOCK - 2 (stock fantasma)
    expect(await getStock(productId)).toBe(INITIAL_STOCK);
  });

  test('no toca el stock si la reserva nunca se pagó (PENDIENTE_PAGO)', async () => {
    const products = [{ id: productId, cantidad: 3, precio: 10000, nombre: 'Producto de prueba' }];
    const bookingId = await insertBooking({ estado: 'PENDIENTE_PAGO', paymentStatus: null, products });

    const res = await request(app).patch(`/api/bookings/${bookingId}/cancel`).expect(200);

    expect(res.body.success).toBe(true);
    expect(await getStock(productId)).toBe(INITIAL_STOCK);
  });

  test('no falla al cancelar una reserva pagada sin productos adicionales', async () => {
    const bookingId = await insertBooking({ estado: 'CONFIRMADA', paymentStatus: 'paid', products: [] });

    const res = await request(app).patch(`/api/bookings/${bookingId}/cancel`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.booking.status).toBe('CANCELADA');
    expect(await getStock(productId)).toBe(INITIAL_STOCK);
  });

  test('no revierte el stock dos veces si la reserva ya estaba cancelada', async () => {
    const products = [{ id: productId, cantidad: 2, precio: 10000, nombre: 'Producto de prueba' }];
    const bookingId = await insertBooking({ estado: 'CONFIRMADA', paymentStatus: 'paid', products });
    await setStock(productId, INITIAL_STOCK - 2);

    await request(app).patch(`/api/bookings/${bookingId}/cancel`).expect(200);
    expect(await getStock(productId)).toBe(INITIAL_STOCK);

    // Segundo intento: rechazado y sin devolver stock otra vez
    const res2 = await request(app).patch(`/api/bookings/${bookingId}/cancel`).expect(400);
    expect(res2.body.error).toBeDefined();
    expect(await getStock(productId)).toBe(INITIAL_STOCK);
  });

  test('no cancela reservas de otro cliente ni toca su stock', async () => {
    const products = [{ id: productId, cantidad: 2, precio: 10000, nombre: 'Producto de prueba' }];
    const bookingId = await insertBooking({
      estado: 'CONFIRMADA', paymentStatus: 'paid', products, clientId: 999
    });
    await setStock(productId, INITIAL_STOCK - 2);

    await request(app).patch(`/api/bookings/${bookingId}/cancel`).expect(404);

    expect(await getEstado(bookingId)).toBe('CONFIRMADA');
    expect(await getStock(productId)).toBe(INITIAL_STOCK - 2);
  });

  test('no cancela una reserva ya completada', async () => {
    const bookingId = await insertBooking({ estado: 'COMPLETADA', paymentStatus: 'paid', products: [] });

    await request(app).patch(`/api/bookings/${bookingId}/cancel`).expect(400);

    expect(await getEstado(bookingId)).toBe('COMPLETADA');
  });
});
