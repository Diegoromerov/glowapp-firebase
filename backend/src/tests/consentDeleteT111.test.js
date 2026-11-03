// backend/src/tests/consentDeleteT111.test.js
//
// T-111 — Borrar los datos biométricos tiene que borrar los datos biométricos.
//
// El servicio recorría seis tablas y dejaba fuera las dos que el escaneo biométrico
// creó después: `biometric_scan_sessions` (métricas cifradas + huella) y
// `biometric_scan_comparisons`. El endpoint respondía «success» con los escaneos
// todavía en la base.

const mockQueries = [];
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
const mockPool = {
  connect: jest.fn(),
  query: jest.fn(),
};

jest.mock('../config/db', () => ({ pool: mockPool }));
jest.mock('../middleware/rateLimiter', () => ({
  getRedisClient: jest.fn(async () => ({ del: jest.fn(async () => 1) })),
}));

const consentService = require('../services/consentService');

beforeEach(() => {
  mockQueries.length = 0;
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.connect.mockReset();
  mockPool.query.mockReset();

  mockPool.connect.mockResolvedValue(mockClient);
  mockClient.query.mockImplementation(async (sql) => {
    mockQueries.push(sql);
    if (/^DELETE FROM/.test(sql)) return { rowCount: 2 };
    if (/INSERT INTO biometric_access_log/.test(sql)) return { rowCount: 1 };
    return { rowCount: 0 };
  });
});

describe('T-111 — supresión total al cerrar la cuenta', () => {
  test('incluye las sesiones de escaneo y sus comparaciones', async () => {
    const result = await consentService.deleteBiometricData(7);

    expect(result.deleted).toBe(true);

    const borradas = mockQueries.filter((sql) => /^DELETE FROM/.test(sql));
    const tablas = borradas.map((sql) => sql.match(/DELETE FROM (\w+)/)[1]);

    expect(tablas).toContain('biometric_scan_comparisons');
    expect(tablas).toContain('biometric_scan_sessions');
  });

  test('borra las comparaciones antes que las sesiones', async () => {
    await consentService.deleteBiometricData(7);
    const tablas = mockQueries
      .filter((sql) => /^DELETE FROM/.test(sql))
      .map((sql) => sql.match(/DELETE FROM (\w+)/)[1]);

    expect(tablas.indexOf('biometric_scan_comparisons'))
      .toBeLessThan(tablas.indexOf('biometric_scan_sessions'));
  });

  test('un fallo de base no se devuelve como éxito', async () => {
    mockClient.query.mockRejectedValue(new Error('conexión perdida'));

    const result = await consentService.deleteBiometricData(7);

    expect(result.deleted).toBe(false);
    expect(result.recordsAffected).toBe(0);
    expect(result.error).toMatch(/conexión perdida/);
  });
});
