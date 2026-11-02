// backend/src/tests/historyYF6.test.js
//
// Y-F6 — la serie del usuario.
//
// Lo que se prueba aquí es que el historial **lee** y no recalcula:
//   * lista vacía = 200 con `[]` (no un 404: no tener escaneos no es un error),
//   * orden del más reciente al más viejo y límite acotado a 50,
//   * el GlowScore sale de lo guardado; si un escaneo viejo no lo tiene, va null,
//   * el veredicto y los contadores se leen en claro; el ΔGlowScore se descifra,
//   * un detalle corrupto deja el delta en null sin tumbar la lista,
//   * sólo aparecen los escaneos del usuario que consulta.

const mockPool = { query: jest.fn() };
jest.mock('../config/db', () => ({ pool: mockPool }));

const biometricCryptoService = require('../services/biometricCryptoService');
const historyService = require('../services/biometric/history.service');

const USER = 42;

/** Detalle de comparación cifrado tal como lo guarda Y-F3. */
function detalleCifrado({ delta = 6, verdict = 'MEJORO' } = {}) {
  return biometricCryptoService.encrypt({
    version: 1,
    threshold: 2,
    verdict,
    glowScore: { before: 62, after: 68, delta },
    comparisons: { hidratacion: { delta: 20, cambio: 'mejora' } },
    byFamily: {},
    byZone: {},
    onlyInBaseline: [],
    onlyInCurrent: [],
    notes: [],
  });
}

function fila({
  id = 501,
  capturedAt = '2026-10-19T15:00:00.000Z',
  glowScore = '68',
  comparisonId = 900,
  verdict = 'MEJORO',
  compared = 5,
  significant = 3,
  metricsEncrypted = null,
} = {}) {
  return {
    id,
    captured_at: capturedAt,
    metrics_count: 29,
    consent_version: '2.0',
    glow_score: glowScore,
    comparison_id: comparisonId,
    baseline_scan_id: comparisonId ? 500 : null,
    verdict: comparisonId ? verdict : null,
    compared_count: comparisonId ? compared : null,
    significant_count: comparisonId ? significant : null,
    metrics_encrypted: metricsEncrypted,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPool.query.mockResolvedValue({ rows: [] });
});

describe('Y-F6 — historial leído, no recalculado', () => {
  test('usuario sin escaneos: lista vacía, no 404', async () => {
    const r = await historyService.list(USER);
    expect(r.scans).toEqual([]);
    expect(r.limit).toBe(20);
  });

  test('la consulta filtra por usuario y devuelve lo más reciente primero', async () => {
    mockPool.query.mockResolvedValue({
      rows: [fila({ id: 3, capturedAt: '2026-10-19T15:00:00Z' }), fila({ id: 2, capturedAt: '2026-10-12T15:00:00Z' })],
    });

    const r = await historyService.list(USER);

    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE s\.user_id = \$1/);
    expect(sql).toMatch(/ORDER BY s\.captured_at DESC/);
    expect(params[0]).toBe(USER);
    expect(r.scans.map((s) => s.scanId)).toEqual([3, 2]);
  });

  test('el GlowScore sale de lo guardado y llega como número', async () => {
    mockPool.query.mockResolvedValue({ rows: [fila({ glowScore: '68' })] });
    const r = await historyService.list(USER);
    expect(r.scans[0].glowScore).toBe(68);
  });

  test('un escaneo viejo sin puntaje guardado devuelve null, no un invento', async () => {
    mockPool.query.mockResolvedValue({ rows: [fila({ glowScore: null })] });
    const r = await historyService.list(USER);
    expect(r.scans[0].glowScore).toBeNull();
  });

  test('el veredicto y los contadores se leen sin descifrar nada', async () => {
    mockPool.query.mockResolvedValue({
      rows: [fila({ verdict: 'MIXTO', compared: 7, significant: 2, metricsEncrypted: detalleCifrado({ verdict: 'MIXTO' }) })],
    });
    const r = await historyService.list(USER);
    expect(r.scans[0].comparison).toMatchObject({
      verdict: 'MIXTO',
      compared: 7,
      significant: 2,
      baselineScanId: 500,
    });
  });

  test('el ΔGlowScore se descifra del detalle persistido', async () => {
    mockPool.query.mockResolvedValue({ rows: [fila({ metricsEncrypted: detalleCifrado({ delta: 6 }) })] });
    const r = await historyService.list(USER);
    expect(r.scans[0].comparison.deltaGlowScore).toBe(6);
  });

  test('primer escaneo sin comparación: comparison null y sin descifrar', async () => {
    mockPool.query.mockResolvedValue({
      rows: [fila({ comparisonId: null, metricsEncrypted: null })],
    });
    const r = await historyService.list(USER);
    expect(r.scans[0].comparison).toBeNull();
  });

  test('detalle corrupto: la fila se devuelve con delta null y la lista no se cae', async () => {
    mockPool.query.mockResolvedValue({
      rows: [fila({ metricsEncrypted: 'no-es-un-ciphertext-valido' }), fila({ id: 499 })],
    });
    const r = await historyService.list(USER);
    expect(r.scans).toHaveLength(2);
    expect(r.scans[0].comparison.deltaGlowScore).toBeNull();
    expect(r.scans[0].comparison.verdict).toBe('MEJORO'); // el veredicto está en claro y se conserva
  });

  test('el límite se acota: 0, negativo, texto o 999 no rompen la consulta', async () => {
    await historyService.list(USER, { limit: 0 });
    expect(mockPool.query.mock.calls[0][1][1]).toBe(20);

    await historyService.list(USER, { limit: -5 });
    expect(mockPool.query.mock.calls[1][1][1]).toBe(20);

    await historyService.list(USER, { limit: 'abc' });
    expect(mockPool.query.mock.calls[2][1][1]).toBe(20);

    await historyService.list(USER, { limit: 999 });
    expect(mockPool.query.mock.calls[3][1][1]).toBe(50);

    await historyService.list(USER, { limit: 5 });
    expect(mockPool.query.mock.calls[4][1][1]).toBe(5);
  });

  test('usuario inválido es 400, no una consulta a ciegas', async () => {
    await expect(historyService.list('sin-numero')).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
