/**
 * wompiService.test.js
 *
 * El archivo anterior probaba `disbursePayout` y observaba efectos colaterales de
 * un `setTimeout` simulador (esperaba 1.1-1.6 s para leer las llamadas a
 * pool.query). Ese código ya no existe: ahora `crearPayout` dispersa de verdad
 * contra la API de Pagos a Terceros.
 *
 * Aquí se fijan: la referencia idempotente, el contenido del lote que se envía a
 * Wompi (montos en centavos, legalId/name/email, bankId resuelto), el mapeo de
 * estados y el comportamiento ante error (FALLIDO + ledger + rethrow).
 */

jest.mock('../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('./wompiPayoutsClient', () => ({
  isConfigured: jest.fn(),
  resolveBankId: jest.fn(),
  createPayoutBatch: jest.fn()
}));

const { pool } = require('../config/db');
const wompiPayoutsClient = require('./wompiPayoutsClient');
const wompiService = require('./wompiService');

const WALLET_ROW = {
  titular_nombre: 'Ana Perez',
  titular_documento_tipo: 'CC',
  titular_documento_num: '1098765432',
  tipo_cuenta_bancaria: 'AHORROS',
  numero_cuenta: '1234567890',
  banco: 'Bancolombia',
  usuario_nombre: 'Ana Perez',
  usuario_email: 'ana@example.com'
};

const PARAMS = {
  retiroId: 'retiro-123',
  providerId: 'prov-456',
  amount: 100000,
  numeroCuenta: '1234567890',
  banco: 'Bancolombia',
  automatico: false
};

beforeEach(() => {
  jest.clearAllMocks();
  wompiPayoutsClient.isConfigured.mockReturnValue(true);
  wompiPayoutsClient.resolveBankId.mockResolvedValue('uuid-bancolombia');
  wompiPayoutsClient.createPayoutBatch.mockResolvedValue({ id: 'lote-1', status: 'PENDING', reference: 'ref' });
  pool.query.mockResolvedValue({ rows: [WALLET_ROW] });
});

describe('referencia idempotente', () => {
  test('misma operación -> misma referencia', () => {
    const a = wompiService._generarReferenciaIdempotente('wompi_ret', 'retiro-123', 'prov-456', 100000);
    const b = wompiService._generarReferenciaIdempotente('wompi_ret', 'retiro-123', 'prov-456', 100000);
    expect(a).toBe(b);
    expect(a).toMatch(/^wompi_ret_[0-9A-F]{16}$/);
  });

  test('operaciones distintas -> referencias distintas', () => {
    const a = wompiService._generarReferenciaIdempotente('wompi_ret', 'retiro-1', 'prov-456', 100000);
    const b = wompiService._generarReferenciaIdempotente('wompi_ret', 'retiro-2', 'prov-456', 100000);
    const c = wompiService._generarReferenciaIdempotente('wompi_ret', 'retiro-1', 'prov-456', 75000);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('mapeo de estados de Wompi a `retiros.estado`', () => {
  test.each([
    ['TOTAL_PAYMENT', 'COMPLETADO'],
    ['APPROVED', 'COMPLETADO'],
    ['FAILED', 'FALLIDO'],
    ['REJECTED', 'FALLIDO'],
    ['PENDING', 'PROCESANDO'],
    [null, 'PROCESANDO']
  ])('%s -> %s', (entrada, esperado) => {
    expect(wompiService._mapearEstadoRetiro(entrada)).toBe(esperado);
  });
});

describe('crearPayout', () => {
  test('sin credenciales NO llama a Wompi y no simula nada', async () => {
    wompiPayoutsClient.isConfigured.mockReturnValue(false);
    await expect(wompiService.crearPayout(PARAMS)).rejects.toThrow(/No se simula el pago/);
    expect(wompiPayoutsClient.createPayoutBatch).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('envía el lote con monto en CENTAVOS y los datos del titular', async () => {
    await wompiService.crearPayout(PARAMS);

    expect(wompiPayoutsClient.createPayoutBatch).toHaveBeenCalledTimes(1);
    const lote = wompiPayoutsClient.createPayoutBatch.mock.calls[0][0];

    expect(lote.paymentType).toBe('PROVIDERS');
    expect(lote.reference).toMatch(/^wompi_ret_[0-9A-F]{16}$/);
    // la idempotency-key se deriva de la misma referencia
    expect(lote.idempotencyKey).toBe(lote.reference);

    const t = lote.transactions[0];
    expect(t.amount).toBe(10000000); // 100.000 COP -> 10.000.000 centavos
    expect(t.legalIdType).toBe('CC');
    expect(t.legalId).toBe('1098765432');
    expect(t.name).toBe('Ana Perez');
    expect(t.email).toBe('ana@example.com');
    expect(t.bankId).toBe('uuid-bancolombia');
    expect(t.accountType).toBe('AHORROS');
    expect(t.accountNumber).toBe('1234567890');
    expect(wompiPayoutsClient.resolveBankId).toHaveBeenCalledWith('Bancolombia');
  });

  test('guarda la referencia REAL del lote (no una inventada) y el estado traducido', async () => {
    wompiPayoutsClient.createPayoutBatch.mockResolvedValue({ id: 'lote-xyz', status: 'TOTAL_PAYMENT' });
    await wompiService.crearPayout(PARAMS);

    const update = pool.query.mock.calls.find((c) => String(c[0]).includes('UPDATE retiros'));
    expect(update[1][0]).toBe('retiro-123');
    expect(update[1][1]).toBe('COMPLETADO');
    expect(update[1][2]).toBe('lote-xyz');
  });

  test('con PENDING deja el retiro en PROCESANDO (la confirmación es asíncrona)', async () => {
    await wompiService.crearPayout(PARAMS);
    const update = pool.query.mock.calls.find((c) => String(c[0]).includes('UPDATE retiros'));
    expect(update[1][1]).toBe('PROCESANDO');
  });

  test('si Wompi falla: marca FALLIDO, escribe el ledger y relanza', async () => {
    wompiPayoutsClient.createPayoutBatch.mockRejectedValue(new Error('Wompi Payouts POST /payouts falló (422)'));

    await expect(wompiService.crearPayout(PARAMS)).rejects.toThrow(/422/);

    const update = pool.query.mock.calls.find((c) => String(c[0]).includes("SET estado = 'FALLIDO'"));
    expect(update).toBeDefined();
    expect(update[1][0]).toBe('retiro-123');

    const ledger = pool.query.mock.calls.find((c) => String(c[0]).includes('RETIRO_FALLIDO'));
    expect(ledger).toBeDefined();
  });

  test('si faltan datos del titular, NO llama a Wompi y falla con motivo explícito', async () => {
    pool.query.mockResolvedValue({ rows: [{ ...WALLET_ROW, titular_documento_num: null }] });
    await expect(wompiService.crearPayout(PARAMS)).rejects.toThrow(/titular_documento_num/);
    expect(wompiPayoutsClient.createPayoutBatch).not.toHaveBeenCalled();
  });
});
