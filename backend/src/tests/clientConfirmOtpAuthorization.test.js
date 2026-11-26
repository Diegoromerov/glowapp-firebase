jest.mock('../config/db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const paymentRoutes = require('../routes/paymentRoutes');

const BOOKING_ID = '00000000-0000-4000-8000-000000000042';
const CLIENT_ID = 42;

function crearApp(userId = CLIENT_ID) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, role: 'client', rol: 'CLIENTE' };
    next();
  });
  app.use('/api/payments', paymentRoutes);
  return app;
}

function conectarConOtp({ clientId, hash }) {
  const client = {
    query: jest.fn(async (sql) => {
      if (sql.includes('SELECT ov.*')) {
        return {
          rows: [{
            client_id: clientId,
            codigo_hash: hash,
            expira_at: new Date(Date.now() + 60_000),
            intentos_fallidos: 0,
            valor_bruto: 12_500,
            comision_plataforma: 2_500,
            pago_neto_prestador: 10_000,
          }],
        };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return client;
}

beforeEach(() => {
  pool.query.mockReset().mockResolvedValue({ rows: [] });
  pool.connect.mockReset();
});

describe('confirmación OTP de servicio por el cliente', () => {
  test('el cliente llega a la validación de propiedad y no cae en la capacidad del prestador', async () => {
    const client = conectarConOtp({ clientId: CLIENT_ID + 1, hash: 'unused' });

    const response = await request(crearApp())
      .post(`/api/payments/bookings/${BOOKING_ID}/confirm-otp`)
      .send({ codigo: '123456' });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/Solo el cliente de la reserva/);
    expect(pool.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('el cliente propietario alcanza la comprobación del código OTP', async () => {
    const hash = await bcrypt.hash('654321', 4);
    conectarConOtp({ clientId: CLIENT_ID, hash });

    const response = await request(crearApp())
      .post(`/api/payments/bookings/${BOOKING_ID}/confirm-otp`)
      .send({ codigo: '123456' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Código incorrecto/);
  });
});
