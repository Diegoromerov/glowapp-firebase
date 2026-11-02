// Wompi — `GET /api/payments/wompi/acceptance-token`
//
// El token de aceptación es obligatorio al crear una transacción en Wompi y es la
// evidencia del Habeas Data. La app no puede fabricarlo ni conocer la llave pública,
// así que lo pide a este endpoint.
//
// Contrato que esta prueba fija:
//   1. Exige autenticación (no es un endpoint público).
//   2. Sin credenciales responde 503 —cerrado en falso— y NO llama a Wompi:
//      inventar un token solo movería el fallo al momento del cobro.
//   3. Con credenciales devuelve `acceptance_token`, `personal_data_auth_token`
//      y el `permalink` de términos.
//   4. Si Wompi falla responde 502 sin propagar el detalle interno.
//   5. Nunca devuelve la llave pública del comercio al cliente.
const request = require('supertest');
const express = require('express');

jest.mock('../config/db', () => ({
  pool: { query: jest.fn(), connect: jest.fn() }
}));
jest.mock('../config/redis', () => ({ isReady: false, get: jest.fn(), on: jest.fn() }));

// Se aísla el middleware de identidad: esta prueba es del contrato del endpoint,
// no de la resolución de usuario (que tiene su propia cobertura).
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, res, next) => {
    if (req.headers.authorization === 'Bearer token-valido') {
      req.user = { id: 1, email: 'cliente@test.co', rol: 'CLIENTE' };
      return next();
    }
    return res.status(401).json({ success: false, error: 'NO_TOKEN' });
  }
}));

jest.mock('../services/wompiClient', () => ({
  isConfigured: jest.fn(),
  getAcceptanceTokens: jest.fn()
}));

const paymentRoutes = require('../routes/paymentRoutes');
const wompiClient = require('../services/wompiClient');
const { pool } = require('../config/db');

const app = express();
app.use(express.json());
app.use('/api', paymentRoutes);

const RUTA = '/api/payments/wompi/acceptance-token';
const CON_AUTH = { Authorization: 'Bearer token-valido' };

describe('Wompi — endpoint del token de aceptación', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test('exige autenticación: sin token responde 401 y no consulta a Wompi', async () => {
    const res = await request(app).get(RUTA);

    expect(res.status).toBe(401);
    expect(wompiClient.getAcceptanceTokens).not.toHaveBeenCalled();
  });

  test('sin credenciales responde 503 (cerrado en falso) y NO llama a Wompi', async () => {
    wompiClient.isConfigured.mockReturnValue(false);

    const res = await request(app).get(RUTA).set(CON_AUTH);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('PAYMENT_GATEWAY_NOT_CONFIGURED');
    expect(wompiClient.getAcceptanceTokens).not.toHaveBeenCalled();
  });

  test('con credenciales devuelve los tokens de aceptación y el permalink de términos', async () => {
    wompiClient.isConfigured.mockReturnValue(true);
    wompiClient.getAcceptanceTokens.mockResolvedValue({
      acceptanceToken: 'acc_test_123',
      personalDataAuthToken: 'pda_test_456',
      permalink: 'https://wompi.com/es/colombia/aceptacion'
    });

    const res = await request(app).get(RUTA).set(CON_AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      acceptance_token: 'acc_test_123',
      personal_data_auth_token: 'pda_test_456',
      permalink: 'https://wompi.com/es/colombia/aceptacion'
    });
  });

  test('si Wompi falla responde 502 sin propagar el detalle interno', async () => {
    wompiClient.isConfigured.mockReturnValue(true);
    wompiClient.getAcceptanceTokens.mockRejectedValue(
      new Error('ECONNREFUSED api.wompi.co — prv_test_NO_DEBE_SALIR')
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get(RUTA).set(CON_AUTH);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
    // El mensaje al cliente no puede arrastrar el detalle de red ni el secreto.
    expect(JSON.stringify(res.body)).not.toContain('prv_test_NO_DEBE_SALIR');
    errorSpy.mockRestore();
  });

  test('nunca expone la llave pública del comercio en el cuerpo', async () => {
    wompiClient.isConfigured.mockReturnValue(true);
    wompiClient.getAcceptanceTokens.mockResolvedValue({
      acceptanceToken: 'acc_test_123',
      personalDataAuthToken: 'pda_test_456',
      permalink: 'https://wompi.com/es/colombia/aceptacion'
    });

    const res = await request(app).get(RUTA).set(CON_AUTH);
    const cuerpo = JSON.stringify(res.body);

    expect(cuerpo).not.toMatch(/pub_(test|prod)_/);
    expect(Object.keys(res.body).sort()).toEqual(
      ['acceptance_token', 'personal_data_auth_token', 'permalink', 'success'].sort()
    );
  });
});
