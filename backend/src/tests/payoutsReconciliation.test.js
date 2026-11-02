/**
 * Tests de la reconciliación de payouts (W2) y re-abono de saldo en fallo (W3).
 * Valida que el job `conciliarPayouts` consulta Wompi, actualiza el estado
 * y re-abona el saldo disponible cuando el lote falla.
 *
 * Nota: corre contra Postgres REAL (no pg-mem) porque el job usa
 * `runAsSystem` → `SET LOCAL ROLE app_system` que pg-mem no soporta.
 */

const { pool } = require('../config/db');
const wompiPayoutsClient = require('../services/wompiPayoutsClient');
const { _mapearEstadoRetiro: mapearEstadoRetiro } = require('../services/wompiService');
const {
  conciliarPayouts,
  ejecutarRetirosAutomaticos,
  madurarSaldosPendientes,
  inicializarJobs,
  comoSistema
} = require('../jobs/paymentJobs');

// Mock del tenant routing para evitar SET LOCAL ROLE en pg-mem
// y proveer getActiveClient que use el pool de pg-mem
jest.mock('../config/tenantRouting', () => {
  const actualDb = jest.requireActual('../config/db');
  return {
    runAsSystem: ({ pool }, fn) => fn(),
    runAsSystemContext: (fn) => fn(),
    getActiveClient: () => actualDb.pool,
    getContext: () => ({ tenantId: null })
  };
});

jest.mock('../services/wompiPayoutsClient');

describe('conciliarPayouts — reconciliación W2 / re-abono W3', () => {
  let mockClient;
  const providerId = 999;

  beforeEach(async () => {
    // Limpiar tablas antes de cada test
    await pool.query(`DELETE FROM wallet_ledger_events`);
    await pool.query(`DELETE FROM wallet_transactions`);
    await pool.query(`DELETE FROM retiros`);
    await pool.query(`DELETE FROM provider_wallet`);
    
    jest.clearAllMocks();
    wompiPayoutsClient.getPayout.mockReset();
    wompiPayoutsClient.isConfigured.mockReturnValue(true);

    // Configuración mínima para que el job funcione
    process.env.WOMPI_PAYOUTS_API_KEY = 'test_key';
    process.env.WOMPI_PAYOUTS_USER_PRINCIPAL_ID = 'test_principal';
    process.env.WOMPI_PAYOUTS_ACCOUNT_ID = 'test_account';
    process.env.WOMPI_PAYOUTS_BASE_URL = 'https://api.sandbox.payouts.wompi.co/v1';
  });

  afterEach(() => {
    delete process.env.WOMPI_PAYOUTS_API_KEY;
    delete process.env.WOMPI_PAYOUTS_USER_PRINCIPAL_ID;
    delete process.env.WOMPI_PAYOUTS_ACCOUNT_ID;
    delete process.env.WOMPI_PAYOUTS_BASE_URL;
  });

  test('W2: consulta Wompi y marca COMPLETADO cuando el lote está TOTAL_PAYMENT', async () => {
    // Preparar: wallet + retiro en PROCESANDO con referencia_wompi
    await pool.query(`
      INSERT INTO provider_wallet (provider_id, saldo_disponible, saldo_pendiente, cuenta_verificada)
      VALUES ($1, 100000, 0, true)
      ON CONFLICT (provider_id) DO UPDATE SET saldo_disponible = 100000
    `, [providerId]);

    const { rows: walletRows } = await pool.query(`SELECT id FROM provider_wallet WHERE provider_id = $1`, [providerId]);
    const walletId = walletRows[0].id;

    const { rows: retiroRows } = await pool.query(`
      INSERT INTO retiros (provider_id, wallet_id, monto, estado, referencia_wompi, numero_cuenta, banco)
      VALUES ($1, $2, 50000, 'PROCESANDO', 'lote-wompi-123', '123456789', 'Bancolombia')
      RETURNING id
    `, [providerId, walletId]);
    const retiroId = retiroRows[0].id;

    // Crear la transacción de ledger que el job espera (DEBITO_RETIRO con retiro_id en metadata)
    await pool.query(`
      INSERT INTO wallet_transactions (provider_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
      VALUES ($1, 'DEBITO_RETIRO', 50000, 0, 'PENDIENTE', $2, $3)
    `, [providerId, `Retiro automático QUINCENA`, JSON.stringify({ retiro_id: retiroId, automatico: true })]);

    // Wompi responde TOTAL_PAYMENT
    wompiPayoutsClient.getPayout.mockResolvedValue({
      id: 'lote-wompi-123',
      status: 'TOTAL_PAYMENT',
      reference: 'pay-ref-1'
    });

    // Debug: verificar que la transacción existe
    const { rows: checkTx } = await pool.query(`
      SELECT id, provider_id, tipo, metadata FROM wallet_transactions 
      WHERE provider_id = $1 AND tipo = 'DEBITO_RETIRO' AND (metadata->>'retiro_id')::uuid = $2
    `, [providerId, retiroId]);
    console.log('DEBUG: wallet_transactions antes del job:', checkTx);

    // Ejecutar job
    await comoSistema(conciliarPayouts)();

    // Verificar: retiro COMPLETADO
    const { rows: retiros } = await pool.query(`SELECT estado FROM retiros WHERE id = $1`, [retiroId]);
    expect(retiros[0].estado).toBe('COMPLETADO');

    // Verificar: ledger tiene RETIRO_COMPLETADO
    const { rows: ledger } = await pool.query(`
      SELECT evento FROM wallet_ledger_events e
      JOIN wallet_transactions wt ON wt.id = e.tx_id
      WHERE wt.tipo = 'DEBITO_RETIRO' AND (wt.metadata->>'retiro_id')::uuid = $1
        AND e.evento = 'RETIRO_COMPLETADO'
    `, [retiroId]);
    expect(ledger.length).toBe(1);

    // Saldo NO debe cambiar (ya se debitó al crear el retiro)
    const { rows: wallet } = await pool.query(`SELECT saldo_disponible FROM provider_wallet WHERE provider_id = $1`, [providerId]);
    expect(parseFloat(wallet[0].saldo_disponible)).toBe(100000); // sin cambios
  });

  test('W3: re-abona saldo_disponible cuando Wompi reporta FAILED', async () => {
    await pool.query(`
      INSERT INTO provider_wallet (provider_id, saldo_disponible, saldo_pendiente, cuenta_verificada)
      VALUES ($1, 50000, 0, true)
      ON CONFLICT (provider_id) DO UPDATE SET saldo_disponible = 50000
    `, [providerId]);

    const { rows: walletRows } = await pool.query(`SELECT id FROM provider_wallet WHERE provider_id = $1`, [providerId]);
    const walletId = walletRows[0].id;

    const { rows: retiroRows } = await pool.query(`
      INSERT INTO retiros (provider_id, wallet_id, monto, estado, referencia_wompi, numero_cuenta, banco)
      VALUES ($1, $2, 30000, 'PROCESANDO', 'lote-fail-456', '987654321', 'Nequi')
      RETURNING id
    `, [providerId, walletId]);
    const retiroId = retiroRows[0].id;

    // Crear la transacción de ledger que el job espera
    await pool.query(`
      INSERT INTO wallet_transactions (provider_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
      VALUES ($1, 'DEBITO_RETIRO', 30000, 0, 'PENDIENTE', $2, $3)
    `, [providerId, `Retiro automático QUINCENA`, JSON.stringify({ retiro_id: retiroId, automatico: true })]);

    // Wompi responde FAILED
    wompiPayoutsClient.getPayout.mockResolvedValue({
      id: 'lote-fail-456',
      status: 'FAILED',
      reference: 'pay-ref-fail'
    });

    await comoSistema(conciliarPayouts)();

    // Verificar: retiro FALLIDO
    const { rows: retiros } = await pool.query(`SELECT estado, error_wompi FROM retiros WHERE id = $1`, [retiroId]);
    expect(retiros[0].estado).toBe('FALLIDO');
    expect(retiros[0].error_wompi).toMatch(/Wompi: FAILED/);

    // W3: saldo RE-ABONADO (50000 + 30000 = 80000)
    const { rows: wallet } = await pool.query(`SELECT saldo_disponible FROM provider_wallet WHERE provider_id = $1`, [providerId]);
    expect(parseFloat(wallet[0].saldo_disponible)).toBe(80000);

    // Verificar: ledger tiene RETIRO_FALLIDO con reabonado: true
    const { rows: ledger } = await pool.query(`
      SELECT detalle FROM wallet_ledger_events e
      JOIN wallet_transactions wt ON wt.id = e.tx_id
      WHERE wt.tipo = 'DEBITO_RETIRO' AND (wt.metadata->>'retiro_id')::uuid = $1
        AND e.evento = 'RETIRO_FALLIDO'
    `, [retiroId]);
    expect(ledger.length).toBe(1);
    expect(ledger[0].detalle.reabonado).toBe(true);
  });

  test('W3: re-abona también con PARTIAL_PAYMENT (se trata como fallo)', async () => {
    await pool.query(`
      INSERT INTO provider_wallet (provider_id, saldo_disponible, saldo_pendiente, cuenta_verificada)
      VALUES ($1, 20000, 0, true)
      ON CONFLICT (provider_id) DO UPDATE SET saldo_disponible = 20000
    `, [providerId]);

    const { rows: walletRows } = await pool.query(`SELECT id FROM provider_wallet WHERE provider_id = $1`, [providerId]);
    const walletId = walletRows[0].id;

    const { rows: retiroRows } = await pool.query(`
      INSERT INTO retiros (provider_id, wallet_id, monto, estado, referencia_wompi, numero_cuenta, banco)
      VALUES ($1, $2, 10000, 'PROCESANDO', 'lote-partial-789', '111222333', 'Daviplata')
      RETURNING id
    `, [providerId, walletId]);
    const retiroId = retiroRows[0].id;

    // Crear la transacción de ledger que el job espera
    await pool.query(`
      INSERT INTO wallet_transactions (provider_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
      VALUES ($1, 'DEBITO_RETIRO', 10000, 0, 'PENDIENTE', $2, $3)
    `, [providerId, `Retiro automático QUINCENA`, JSON.stringify({ retiro_id: retiroId, automatico: true })]);

    wompiPayoutsClient.getPayout.mockResolvedValue({
      id: 'lote-partial-789',
      status: 'PARTIAL_PAYMENT',
      reference: 'pay-ref-partial'
    });

    await comoSistema(conciliarPayouts)();

    const { rows: retiros } = await pool.query(`SELECT estado FROM retiros WHERE id = $1`, [retiroId]);
    expect(retiros[0].estado).toBe('FALLIDO');

    const { rows: wallet } = await pool.query(`SELECT saldo_disponible FROM provider_wallet WHERE provider_id = $1`, [providerId]);
    expect(parseFloat(wallet[0].saldo_disponible)).toBe(30000); // 20000 + 10000
  });

  test('no hace nada si el lote sigue PENDING en Wompi', async () => {
    await pool.query(`
      INSERT INTO provider_wallet (provider_id, saldo_disponible, saldo_pendiente, cuenta_verificada)
      VALUES ($1, 10000, 0, true)
      ON CONFLICT (provider_id) DO UPDATE SET saldo_disponible = 10000
    `, [providerId]);

    const { rows: walletRows } = await pool.query(`SELECT id FROM provider_wallet WHERE provider_id = $1`, [providerId]);
    const walletId = walletRows[0].id;

    const { rows: retiroRows } = await pool.query(`
      INSERT INTO retiros (provider_id, wallet_id, monto, estado, referencia_wompi, numero_cuenta, banco)
      VALUES ($1, $2, 5000, 'PROCESANDO', 'lote-pending-999', '444555666', 'Banco de Bogotá')
      RETURNING id
    `, [providerId, walletId]);
    const retiroId = retiroRows[0].id;

    // Crear la transacción de ledger que el job espera
    await pool.query(`
      INSERT INTO wallet_transactions (provider_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
      VALUES ($1, 'DEBITO_RETIRO', 5000, 0, 'PENDIENTE', $2, $3)
    `, [providerId, `Retiro automático QUINCENA`, JSON.stringify({ retiro_id: retiroId, automatico: true })]);

    wompiPayoutsClient.getPayout.mockResolvedValue({
      id: 'lote-pending-999',
      status: 'PENDING',
      reference: 'pay-ref-pending'
    });

    await comoSistema(conciliarPayouts)();

    // Estado NO cambia
    const { rows: retiros } = await pool.query(`SELECT estado FROM retiros WHERE id = $1`, [retiroId]);
    expect(retiros[0].estado).toBe('PROCESANDO');

    // Saldo NO cambia
    const { rows: wallet } = await pool.query(`SELECT saldo_disponible FROM provider_wallet WHERE provider_id = $1`, [providerId]);
    expect(parseFloat(wallet[0].saldo_disponible)).toBe(10000);
  });

  test('ignora retiros sin referencia_wompi (no enviados aún)', async () => {
    // Reset mock específicamente para este test
    wompiPayoutsClient.getPayout.mockReset();
    
    await pool.query(`
      INSERT INTO provider_wallet (provider_id, saldo_disponible, saldo_pendiente, cuenta_verificada)
      VALUES ($1, 10000, 0, true)
      ON CONFLICT (provider_id) DO UPDATE SET saldo_disponible = 10000
    `, [providerId]);

    const { rows: walletRows } = await pool.query(`SELECT id FROM provider_wallet WHERE provider_id = $1`, [providerId]);
    const walletId = walletRows[0].id;

    await pool.query(`
      INSERT INTO retiros (provider_id, wallet_id, monto, estado, referencia_wompi, numero_cuenta, banco)
      VALUES ($1, $2, 5000, 'PROCESANDO', NULL, '777888999', 'Bancolombia')
    `, [providerId, walletId]);

    // NO crear transacción de ledger para este retiro (no tiene referencia_wompi)

    await comoSistema(conciliarPayouts)();

    // getPayout NO se llama
    expect(wompiPayoutsClient.getPayout).not.toHaveBeenCalled();
  });

  test('continúa con los siguientes si uno falla al consultar Wompi', async () => {
    await pool.query(`
      INSERT INTO provider_wallet (provider_id, saldo_disponible, saldo_pendiente, cuenta_verificada)
      VALUES ($1, 50000, 0, true)
      ON CONFLICT (provider_id) DO UPDATE SET saldo_disponible = 50000
    `, [providerId]);

    const { rows: walletRows } = await pool.query(`SELECT id FROM provider_wallet WHERE provider_id = $1`, [providerId]);
    const walletId = walletRows[0].id;

    // Retiro 1: Wompi lanza error
    const { rows: r1 } = await pool.query(`
      INSERT INTO retiros (provider_id, wallet_id, monto, estado, referencia_wompi, numero_cuenta, banco)
      VALUES ($1, $2, 10000, 'PROCESANDO', 'lote-error-1', '111', 'Bancolombia')
      RETURNING id
    `, [providerId, walletId]);
    const retiro1Id = r1[0].id;

    // Crear transacción de ledger para retiro 1
    await pool.query(`
      INSERT INTO wallet_transactions (provider_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
      VALUES ($1, 'DEBITO_RETIRO', 10000, 0, 'PENDIENTE', $2, $3)
    `, [providerId, `Retiro automático QUINCENA`, JSON.stringify({ retiro_id: retiro1Id, automatico: true })]);

    // Retiro 2: OK
    const { rows: r2 } = await pool.query(`
      INSERT INTO retiros (provider_id, wallet_id, monto, estado, referencia_wompi, numero_cuenta, banco)
      VALUES ($1, $2, 20000, 'PROCESANDO', 'lote-ok-2', '222', 'Nequi')
      RETURNING id
    `, [providerId, walletId]);
    const retiro2Id = r2[0].id;

    // Crear transacción de ledger para retiro 2
    await pool.query(`
      INSERT INTO wallet_transactions (provider_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
      VALUES ($1, 'DEBITO_RETIRO', 20000, 0, 'PENDIENTE', $2, $3)
    `, [providerId, `Retiro automático QUINCENA`, JSON.stringify({ retiro_id: retiro2Id, automatico: true })]);

    wompiPayoutsClient.getPayout
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ id: 'lote-ok-2', status: 'TOTAL_PAYMENT' });

    await comoSistema(conciliarPayouts)();

    // Retiro 1: queda PROCESANDO (error no frena el ciclo)
    const { rows: r1After } = await pool.query(`SELECT estado FROM retiros WHERE id = $1`, [retiro1Id]);
    expect(r1After[0].estado).toBe('PROCESANDO');

    // Retiro 2: se procesa COMPLETADO
    const { rows: r2After } = await pool.query(`SELECT estado FROM retiros WHERE id = $1`, [retiro2Id]);
    expect(r2After[0].estado).toBe('COMPLETADO');
  });
});

describe('mapearEstadoRetiro', () => {
  test('mapea estados de éxito a COMPLETADO', () => {
    expect(mapearEstadoRetiro('TOTAL_PAYMENT')).toBe('COMPLETADO');
    expect(mapearEstadoRetiro('APPROVED')).toBe('COMPLETADO');
    expect(mapearEstadoRetiro('COMPLETED')).toBe('COMPLETADO');
    expect(mapearEstadoRetiro('PAID')).toBe('COMPLETADO');
    expect(mapearEstadoRetiro('SUCCESS')).toBe('COMPLETADO');
  });

  test('mapea estados de fallo a FALLIDO', () => {
    expect(mapearEstadoRetiro('FAILED')).toBe('FALLIDO');
    expect(mapearEstadoRetiro('REJECTED')).toBe('FALLIDO');
    expect(mapearEstadoRetiro('ERROR')).toBe('FALLIDO');
    expect(mapearEstadoRetiro('PARTIAL_PAYMENT')).toBe('FALLIDO');
  });

  test('desconocido → PROCESANDO', () => {
    expect(mapearEstadoRetiro('PENDING')).toBe('PROCESANDO');
    expect(mapearEstadoRetiro('UNKNOWN')).toBe('PROCESANDO');
    expect(mapearEstadoRetiro('')).toBe('PROCESANDO');
    expect(mapearEstadoRetiro(null)).toBe('PROCESANDO');
  });
});