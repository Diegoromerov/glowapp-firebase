// backend/src/tests/retentionJobT111.test.js
//
// T-111 — La purga que cumple el plazo del aviso.
//
// Lo que estas pruebas protegen: que el job borre lo que caducó y nada más, que borre
// las comparaciones antes de las sesiones, que deje constancia sin guardar a quién
// borró, y que un fallo no deje medio borrado sin decirlo.

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

const {
  purgarEscaneosExpirados, contarExpirados, RETENTION_ACTOR,
} = require('../jobs/biometricRetention');
const {
  retentionCutoff, getRetentionMonths, describeRetention, DEFAULT_RETENTION_MONTHS,
} = require('../config/biometricRetention');

const ultimaConsulta = () => mockQueries[mockQueries.length - 1];

beforeEach(() => {
  mockQueries.length = 0;
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.connect.mockReset();
  mockPool.query.mockReset();

  mockPool.connect.mockResolvedValue(mockClient);
  mockClient.query.mockImplementation(async (sql) => {
    mockQueries.push(sql);
    if (/DELETE FROM biometric_scan_comparisons/.test(sql)) return { rowCount: 3 };
    if (/DELETE FROM biometric_scan_sessions/.test(sql)) return { rowCount: 2 };
    return { rowCount: 1 };
  });
});

describe('T-111 — el plazo se calcula, no se escribe a mano', () => {
  test('por defecto son 24 meses desde el último escaneo', () => {
    delete process.env.BIOMETRIC_RETENTION_MONTHS;
    expect(getRetentionMonths()).toBe(DEFAULT_RETENTION_MONTHS);
    expect(describeRetention().retentionMonths).toBe(24);
    expect(describeRetention().from).toBe('el último escaneo');
  });

  test('el entorno manda cuando es un entero positivo', () => {
    process.env.BIOMETRIC_RETENTION_MONTHS = '12';
    expect(getRetentionMonths()).toBe(12);
    delete process.env.BIOMETRIC_RETENTION_MONTHS;
  });

  test('un valor basura no acorta el plazo por accidente', () => {
    process.env.BIOMETRIC_RETENTION_MONTHS = 'muchos';
    expect(getRetentionMonths()).toBe(24);
    process.env.BIOMETRIC_RETENTION_MONTHS = '-5';
    expect(getRetentionMonths()).toBe(24);
    delete process.env.BIOMETRIC_RETENTION_MONTHS;
  });

  test('el corte cruza el año correctamente', () => {
    const cutoff = retentionCutoff(new Date('2026-10-20T00:00:00.000Z'), 24);
    expect(cutoff.getUTCFullYear()).toBe(2024);
    expect(cutoff.getUTCMonth()).toBe(9); // octubre (base 0)
  });
});

describe('T-111 — ensayo en seco', () => {
  test('cuenta sin borrar: ninguna sentencia DELETE', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ n: 7 }] })
      .mockResolvedValueOnce({ rows: [{ n: 4 }] });

    const result = await purgarEscaneosExpirados({ dryRun: true });

    expect(result).toMatchObject({ dryRun: true, sessionsDeleted: 7, comparisonsDeleted: 4 });
    const sentencias = mockPool.query.mock.calls.map(([sql]) => sql).join(' ');
    expect(sentencias).not.toMatch(/DELETE/);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  test('contarExpirados devuelve ceros si la base no responde filas', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await expect(contarExpirados(new Date())).resolves.toEqual({ sessions: 0, comparisons: 0 });
  });
});

describe('T-111 — la purga real', () => {
  test('borra comparaciones antes que sesiones y deja constancia sin identificadores', async () => {
    const result = await purgarEscaneosExpirados({ now: new Date('2026-10-20T00:00:00.000Z') });

    expect(result).toMatchObject({ dryRun: false, sessionsDeleted: 2, comparisonsDeleted: 3 });

    const tipo = mockQueries.map((sql) => {
      if (/DELETE FROM biometric_scan_comparisons/.test(sql)) return 'comparaciones';
      if (/DELETE FROM biometric_scan_sessions/.test(sql)) return 'sesiones';
      if (/INSERT INTO biometric_access_log/.test(sql)) return 'auditoria';
      if (/^BEGIN/.test(sql)) return 'begin';
      if (/^COMMIT/.test(sql)) return 'commit';
      return 'otra';
    });

    // El orden importa: las comparaciones cuelgan de las sesiones.
    expect(tipo.indexOf('comparaciones')).toBeLessThan(tipo.indexOf('sesiones'));
    expect(tipo).toContain('auditoria');

    const auditoria = mockClient.query.mock.calls.find(([sql]) => /INSERT INTO biometric_access_log/.test(sql));
    expect(auditoria).toBeDefined();
    const [sql, params] = auditoria;
    // user_id NULL: la purga no vuelve a guardar a quién acaba de borrar.
    expect(sql).toMatch(/VALUES \(NULL/);
    expect(params[0]).toBe(RETENTION_ACTOR);
    const detalle = JSON.parse(params[1]);
    expect(detalle).toMatchObject({ sessionsDeleted: 2, comparisonsDeleted: 3, retentionMonths: 24 });
    expect(JSON.stringify(detalle)).not.toMatch(/user|userId/i);
  });

  test('un fallo a mitad revierte y no se declara éxito', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      mockQueries.push(sql);
      if (/DELETE FROM biometric_scan_sessions/.test(sql)) throw new Error('FK rota');
      return { rowCount: 1 };
    });

    await expect(purgarEscaneosExpirados()).rejects.toThrow('FK rota');
    expect(mockQueries).toContain('ROLLBACK');
    expect(mockQueries).not.toContain('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });
});
