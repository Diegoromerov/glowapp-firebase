/**
 * backend/src/tests/payBooking.test.js
 *
 * Antes este endpoint era un simulador que marcaba la cita como CONFIRMADA y
 * payment_status='paid' con una referencia inventada. Ahora crea una transacción
 * real en Wompi y NO toca el estado de la cita: eso solo lo hace el webhook.
 *
 * Estas pruebas fijan ese contrato extremo a extremo del controlador (con la API
 * de Wompi simulada, para no depender de credenciales):
 *   - compuertas (sin credenciales / sin instrumento / método inválido),
 *   - el monto y la referencia que se firman,
 *   - que la cita NO se marca pagada aquí,
 *   - que un reintento reapunta la transacción local a la transacción viva.
 */

jest.mock('../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../config/tenantRouting', () => ({ runAsSystemContext: (fn) => fn() }));
jest.mock('../config/database', () => ({ sequelize: { transaction: jest.fn(), query: jest.fn(), QueryTypes: {} } }));
jest.mock('../models', () => ({
  Booking: { findOne: jest.fn(), findByPk: jest.fn(), update: jest.fn() },
  Transaction: { count: jest.fn(), findOrCreate: jest.fn(), findOne: jest.fn(), update: jest.fn() },
  Service: {},
  User: {}
}));
jest.mock('../services/wompiClient', () => ({
  isConfigured: jest.fn(),
  createTransaction: jest.fn(),
  verifyEventChecksum: jest.fn()
}));

const bookingController = require('../controllers/bookingController');
const wompiClient = require('../services/wompiClient');
const { Booking, Transaction } = require('../models');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

const BOOKING = {
  id: 'booking-1',
  estado: 'PENDIENTE_PAGO',
  valor_bruto: '150000.00',
  productos_adicionales: null
};

// Nequi se envía con `phone_number`, NO con `token` (contrato de Wompi).
// 3991111111 es el número que el sandbox de Wompi resuelve como APPROVED.
const BODY = {
  payment_method: 'NEQUI',
  phone_number: '3991111111',
  acceptance_token: 'acc_token_abc'
};

function req(over = {}) {
  return { params: { id: 'booking-1' }, user: { id: 'client-1', email: 'ana@example.com' }, body: { ...BODY }, ip: '127.0.0.1', ...over };
}

beforeEach(() => {
  jest.clearAllMocks();
  wompiClient.isConfigured.mockReturnValue(true);
  wompiClient.createTransaction.mockResolvedValue({ id: 'wompi-tx-1', status: 'PENDING', reference: 'booking-1' });
  Booking.findOne.mockResolvedValue({ ...BOOKING });
  Booking.update.mockResolvedValue([1]);
  Transaction.count.mockResolvedValue(0);
  Transaction.findOrCreate.mockResolvedValue([{ external_id: 'wompi-tx-1', update: jest.fn() }, true]);
});

describe('POST /api/bookings/:id/pay — cobro real con Wompi', () => {
  test('sin credenciales responde 503 y NO intenta cobrar', async () => {
    wompiClient.isConfigured.mockReturnValue(false);
    const res = mockRes();
    await bookingController.payBooking(req(), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.body.error).toBe('PAYMENT_GATEWAY_NOT_CONFIGURED');
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('rechaza un método que no sea válido', async () => {
    const res = mockRes();
    await bookingController.payBooking(req({ body: { ...BODY, payment_method: 'INVALID_METHOD' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('exige acceptance_token (el usuario debe aceptar los términos de Wompi)', async () => {
    const body = { ...BODY };
    delete body.acceptance_token;
    const res = mockRes();
    await bookingController.payBooking(req({ body }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error).toBe('MISSING_ACCEPTANCE_TOKEN');
  });

  test('exige un instrumento real: ni PAN ni CVV llegan nunca al backend', async () => {
    const body = { ...BODY };
    delete body.phone_number;
    const res = mockRes();
    await bookingController.payBooking(req({ body }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error).toBe('MISSING_PAYMENT_INSTRUMENT');
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('404 si la cita no es del cliente', async () => {
    Booking.findOne.mockResolvedValue(null);
    const res = mockRes();
    await bookingController.payBooking(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('no permite cobrar una cita que no está PENDIENTE_PAGO', async () => {
    Booking.findOne.mockResolvedValue({ ...BOOKING, estado: 'CONFIRMADA' });
    const res = mockRes();
    await bookingController.payBooking(req(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('camino feliz: firma monto en centavos y referencia, y responde 202', async () => {
    const res = mockRes();
    await bookingController.payBooking(req(), res);

    expect(wompiClient.createTransaction).toHaveBeenCalledTimes(1);
    const args = wompiClient.createTransaction.mock.calls[0][0];
    expect(args.amountInCents).toBe(15000000); // 150.000 COP
    expect(args.currency).toBe('COP');
    expect(args.reference).toBe('booking-1'); // primer intento = id de la cita
    expect(args.acceptanceToken).toBe('acc_token_abc');
    expect(args.customerEmail).toBe('ana@example.com');
    // Wompi exige `phone_number` en payment_method NEQUI; `token` NO es válido aquí.
    expect(args.paymentMethod).toEqual({ type: 'NEQUI', phone_number: '3991111111' });

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.body.wompi_transaction_id).toBe('wompi-tx-1');
  });

  test('W4: un monto enviado por el cliente se IGNORA — se cobra el valor_bruto de la BD', async () => {
    // Invariante de dinero: el cliente no puede dictar el monto. Si alguien
    // "optimizara" esto leyendo req.body.amount, un cliente cobraría $1 por una
    // cita de $150.000. El monto sale SIEMPRE de la fila de la reserva.
    const res = mockRes();
    await bookingController.payBooking(
      req({
        body: {
          ...BODY,
          amount: 1,
          amount_in_cents: 1,
          total: 1,
          valor_bruto: 1
        }
      }),
      res
    );

    expect(wompiClient.createTransaction).toHaveBeenCalledTimes(1);
    const args = wompiClient.createTransaction.mock.calls[0][0];
    expect(args.amountInCents).toBe(15000000); // 150.000 COP de la BD, no 1
  });

  test('la cita NO se marca pagada en el cobro: eso es del webhook', async () => {
    const res = mockRes();
    await bookingController.payBooking(req(), res);

    expect(Booking.update).not.toHaveBeenCalled();
    const defaults = Transaction.findOrCreate.mock.calls[0][0].defaults;
    expect(defaults.status).toBe('pending');
    expect(defaults.status).not.toBe('paid');
  });

  test('una fuente de pago guardada se envía como paymentSourceId', async () => {
    const res = mockRes();
    await bookingController.payBooking(
      req({ body: { payment_method: 'CARD', payment_source_id: 'src-99', acceptance_token: 'acc' } }),
      res
    );
    const args = wompiClient.createTransaction.mock.calls[0][0];
    expect(args.paymentSourceId).toBe('src-99');
    expect(args.paymentMethod).toBeUndefined();
  });

  test('tarjeta con token envía installments (1 por defecto)', async () => {
    const res = mockRes();
    await bookingController.payBooking(
      req({ body: { payment_method: 'CARD', payment_method_token: 'tok_card', acceptance_token: 'acc', installments: 3 } }),
      res
    );
    expect(wompiClient.createTransaction.mock.calls[0][0].paymentMethod).toEqual({
      type: 'CARD',
      token: 'tok_card',
      installments: 3
    });
  });

  test('RECHAZA un token en NEQUI: Wompi no lo admite y el error explica la vía correcta', async () => {
    const res = mockRes();
    await bookingController.payBooking(
      req({ body: { payment_method: 'NEQUI', payment_method_token: 'tok_nequi_123', acceptance_token: 'acc' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error).toBe('MISSING_PAYMENT_INSTRUMENT');
    expect(res.body.message).toMatch(/no acepta un `token`/);
    expect(res.body.message).toMatch(/tokens\/nequi/);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('Nequi tokenizado (fuente de pago) se cobra con payment_source_id', async () => {
    const res = mockRes();
    await bookingController.payBooking(
      req({ body: { payment_method: 'NEQUI', payment_source_id: '12345', acceptance_token: 'acc' } }),
      res
    );

    const args = wompiClient.createTransaction.mock.calls[0][0];
    expect(args.paymentSourceId).toBe('12345');
    expect(args.paymentMethod).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test('un reintento usa una referencia nueva (<id>-r2) y reapunta la fila local', async () => {
    Transaction.count.mockResolvedValue(1); // ya hubo un intento
    const previa = { external_id: 'wompi-tx-vieja', update: jest.fn().mockResolvedValue(true) };
    Transaction.findOrCreate.mockResolvedValue([previa, false]);

    const res = mockRes();
    await bookingController.payBooking(req(), res);

    expect(wompiClient.createTransaction.mock.calls[0][0].reference).toBe('booking-1-r2');
    // La fila local debe apuntar a la transacción VIVA, no a la del intento muerto.
    expect(previa.update).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: 'wompi-tx-1', status: 'pending' })
    );
  });

  test('si Wompi rechaza la creación, responde 402 y no registra transacción local', async () => {
    const err = new Error('Wompi rechazó');
    err.status = 422;
    err.body = { error: { messages: { amount_in_cents: ['monto inválido'] } } };
    wompiClient.createTransaction.mockRejectedValue(err);

    const res = mockRes();
    await bookingController.payBooking(req(), res);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.body.error).toBe('WOMPI_TRANSACTION_FAILED');
    expect(Transaction.findOrCreate).not.toHaveBeenCalled();
    expect(Booking.update).not.toHaveBeenCalled();
  });

  test('un fallo de red contra Wompi responde 502 (no se disfraza de rechazo de negocio)', async () => {
    wompiClient.createTransaction.mockRejectedValue(new Error('ECONNRESET'));
    const res = mockRes();
    await bookingController.payBooking(req(), res);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  // ─── W10: métodos de redirección (PSE, Bancolombia, Daviplata) ───────────────
  // Wompi no cobra al crear la transacción: devuelve una URL que el usuario debe
  // abrir para autorizar. Si el backend no la reenvía, el cobro queda PENDING sin
  // forma de completarse desde la app.

  const BODY_PSE = {
    payment_method: 'PSE',
    acceptance_token: 'acc_token_abc',
    redirect_url: 'https://glowapp.co/pago/resultado',
    customer_data: {
      email: 'ana@example.com',
      full_name: 'Ana Pérez',
      phone_number: '3001234567',
      financial_institution_code: '1007'
    }
  };

  test('PSE devuelve async_payment_url: es la única forma de completar el cobro', async () => {
    wompiClient.createTransaction.mockResolvedValue({
      id: 'wompi-tx-pse',
      status: 'PENDING',
      reference: 'booking-1',
      asyncPaymentUrl: 'https://sandbox.wompi.co/redirect/abc123'
    });

    const res = mockRes();
    await bookingController.payBooking(req({ body: { ...BODY_PSE } }), res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.body.async_payment_url).toBe('https://sandbox.wompi.co/redirect/abc123');
    // La transacción se persiste localmente igual: el webhook la confirmará.
    expect(Transaction.findOrCreate).toHaveBeenCalled();
  });

  test('NEQUI no inventa async_payment_url cuando Wompi no la manda', async () => {
    const res = mockRes();
    await bookingController.payBooking(req(), res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.body.async_payment_url).toBeNull();
  });

  test('PSE sin redirect_url se rechaza antes de llamar a Wompi', async () => {
    const res = mockRes();
    await bookingController.payBooking(
      req({ body: { ...BODY_PSE, redirect_url: '' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });

  test('PSE sin customer_data completo se rechaza antes de llamar a Wompi', async () => {
    const res = mockRes();
    await bookingController.payBooking(
      req({ body: { ...BODY_PSE, customer_data: { email: 'ana@example.com' } } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(wompiClient.createTransaction).not.toHaveBeenCalled();
  });
});
