/**
 * backend/src/tests/wompiPayoutsClient.test.js
 *
 * Contrato del cliente de dispersiones (Pagos a Terceros). Fija los formatos
 * documentados en docs.wompi.co: headers de autenticación propios, montos en
 * centavos, `bankId` resuelto contra /banks (nunca inventado) e idempotency-key
 * con el alfabeto permitido (letras, números y guiones).
 */

jest.mock('axios');
const axios = require('axios');

const payouts = require('../services/wompiPayoutsClient');

beforeEach(() => {
  jest.clearAllMocks();
  payouts._banksCache = null;
  process.env.WOMPI_PAYOUTS_API_KEY = 'payouts_api_key_1';
  process.env.WOMPI_PAYOUTS_USER_PRINCIPAL_ID = '11111111-2222-3333-4444-555555555555';
  process.env.WOMPI_PAYOUTS_ACCOUNT_ID = 'acct-origin-1';
  process.env.WOMPI_PAYOUTS_BASE_URL = 'https://api.sandbox.payouts.wompi.co/v1';
});

afterEach(() => {
  delete process.env.WOMPI_PAYOUTS_API_KEY;
  delete process.env.WOMPI_PAYOUTS_USER_PRINCIPAL_ID;
  delete process.env.WOMPI_PAYOUTS_ACCOUNT_ID;
  delete process.env.WOMPI_PAYOUTS_BASE_URL;
});

describe('aIdempotencyKey', () => {
  test('convierte referencias con guion bajo (alfabeto inválido) a guiones', () => {
    expect(payouts.aIdempotencyKey('wompi_ret_AB12CD34')).toBe('wompi-ret-AB12CD34');
  });

  test('recorta a 64 caracteres (límite de Wompi)', () => {
    expect(payouts.aIdempotencyKey('x'.repeat(200)).length).toBe(64);
  });
});

describe('createPayoutBatch', () => {
  test('envía los headers de autenticación de la API de pagos a terceros', async () => {
    axios.mockResolvedValue({ data: { data: { id: 'lote-1', status: 'PENDING', reference: 'pay-ref-1' } } });

    await payouts.createPayoutBatch({
      reference: 'pay-ref-1',
      idempotencyKey: 'wompi_ret_AB12',
      transactions: [
        { legalIdType: 'CC', legalId: '123', bankId: 'uuid-banco', accountType: 'AHORROS', accountNumber: '999', name: 'Ana', email: 'ana@x.co', amount: 150000, reference: 't1' }
      ]
    });

    const [config] = axios.mock.calls[0];
    expect(config.method).toBe('POST');
    expect(config.url).toBe('https://api.sandbox.payouts.wompi.co/v1/payouts');
    expect(config.headers['x-api-key']).toBe('payouts_api_key_1');
    expect(config.headers['user-principal-id']).toBe('11111111-2222-3333-4444-555555555555');
    // el guion bajo NO es válido en idempotency-key; debe enviarse con guiones
    expect(config.headers['idempotency-key']).toBe('wompi-ret-AB12');
    expect(config.data.accountId).toBe('acct-origin-1');
    expect(config.data.paymentType).toBe('PROVIDERS');
    expect(config.data.transactions[0].amount).toBe(150000);
  });

  test('rechaza un lote vacío sin llamar a la API', async () => {
    await expect(payouts.createPayoutBatch({ reference: 'r', transactions: [] })).rejects.toThrow(/al menos una transacción/i);
    expect(axios).not.toHaveBeenCalled();
  });

  test('sin credenciales lanza y no llama a la API', async () => {
    delete process.env.WOMPI_PAYOUTS_API_KEY;
    await expect(
      payouts.createPayoutBatch({ reference: 'r', transactions: [{ amount: 1 }] })
    ).rejects.toThrow(/WOMPI_PAYOUTS_API_KEY/);
    expect(axios).not.toHaveBeenCalled();
  });
});

describe('resolveBankId', () => {
  test('cruza el nombre del banco de la app contra el catálogo (con acentos y prefijo BANCO)', async () => {
    axios.mockResolvedValue({
      data: [
        { id: 'uuid-bogota', name: 'Banco de Bogotá' },
        { id: 'uuid-nequi', name: 'NEQUI' }
      ]
    });

    await expect(payouts.resolveBankId('Bogota')).resolves.toBe('uuid-bogota');
    await expect(payouts.resolveBankId('BANCO DE BOGOTA')).resolves.toBe('uuid-bogota');
    // cachea el catálogo: una sola llamada de red
    await expect(payouts.resolveBankId('Nequi')).resolves.toBe('uuid-nequi');
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test('NUNCA inventa un bankId: lanza si el banco no existe en el catálogo', async () => {
    axios.mockResolvedValue({ data: [{ id: 'uuid-bogota', name: 'Banco de Bogotá' }] });
    await expect(payouts.resolveBankId('Banco Inexistente XYZ')).rejects.toThrow(/No se pudo mapear el banco/i);
  });
});

describe('getPayout', () => {
  test('consulta el estado del lote para reconciliación', async () => {
    axios.mockResolvedValue({ data: { data: { id: 'lote-1', status: 'TOTAL_PAYMENT', reference: 'pay-ref-1' } } });
    const res = await payouts.getPayout('lote-1');
    expect(res.status).toBe('TOTAL_PAYMENT');
    expect(axios.mock.calls[0][0].url).toBe('https://api.sandbox.payouts.wompi.co/v1/payouts/lote-1');
  });
});
