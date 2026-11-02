// backend/src/tests/scanSession.service.test.js
//
// Y-F1 — Persistencia de la sesión de escaneo:
//   * las métricas se guardan cifradas (ADR-001) y se pueden descifrar de vuelta,
//   * metrics_count coincide con el número real de métricas,
//   * las acciones pedidas/ausentes quedan en claro para auditar la llamada,
//   * un fallo de escritura no rompe la respuesta (tolerante) salvo que se pida lo contrario.
//
// Y-F1b — además registra con qué versión del consentimiento se autorizó:
//   * 2.0 vigente => consent_outdated = false,
//   * 1.0 anterior => consent_outdated = true,
//   * sin consentimiento legible => versión null y marcado como desactualizado.

process.env.BIOMETRIC_ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const mockPool = { query: jest.fn() };

jest.mock('../config/db', () => ({ pool: mockPool }));

const biometricCryptoService = require('../services/biometricCryptoService');
const { BIOMETRIC_CONSENT_VERSION } = require('../config/consentConfig');
const scanSessionService = require('../services/biometric/scanSession.service');
const pool = mockPool;

const FACE_SCORES = {
  hydration: 70,
  wrinkles: 81,
  spots: 77,
  pores: 69,
  subtono: 'Oily',
  bioAge: 31.4,
  providerTaskId: 'task-777',
  requestedActions: ['hd_moisture', 'hd_wrinkle', 'hd_pore', 'hd_age_spot', 'hd_texture'],
  missing: ['hd_tear_trough'],
  metrics: {
    hd_moisture: { key: 'hd_moisture', kind: 'score', raw_score: 48.694559931755066, ui_score: 70, label: null, mask_name: 'hd_moisture_output.png', mask_url: null },
    'hd_pore.forehead': { key: 'hd_pore.forehead', kind: 'score', raw_score: 79.59770965576172, ui_score: 80, label: null, mask_name: 'hd_pore_output_forehead.png', mask_url: null },
    'hd_pore.nose': { key: 'hd_pore.nose', kind: 'score', raw_score: 29.139814376831055, ui_score: 58, label: null, mask_name: 'hd_pore_output_nose.png', mask_url: null },
    'hd_pore.cheek': { key: 'hd_pore.cheek', kind: 'score', raw_score: 44.11081314086914, ui_score: 65, label: null, mask_name: 'hd_pore_output_cheek.png', mask_url: null },
    'hd_pore.whole': { key: 'hd_pore.whole', kind: 'score', raw_score: 55, ui_score: 69, label: null, mask_name: 'hd_pore_output_whole.png', mask_url: null },
    'hd_wrinkle.whole': { key: 'hd_wrinkle.whole', kind: 'score', raw_score: 84, ui_score: 81, label: null, mask_name: 'hd_wrinkle_output_whole.png', mask_url: null },
    'hd_texture.whole': { key: 'hd_texture.whole', kind: 'score', raw_score: 66.39, ui_score: 75, label: null, mask_name: 'hd_texture_output.png', mask_url: null },
    'hd_acne.whole': { key: 'hd_acne.whole', kind: 'score', raw_score: 59.92, ui_score: 76, label: null, mask_name: 'hd_acne_output.png', mask_url: null },
    hd_age_spot: { key: 'hd_age_spot', kind: 'score', raw_score: 83.23, ui_score: 77, label: null, mask_name: 'hd_age_spot_output.png', mask_url: null },
    'hd_skin_type.whole': { key: 'hd_skin_type.whole', kind: 'label', raw_score: null, ui_score: null, label: 'Oily', mask_name: null, mask_url: null },
    skin_age: { key: 'skin_age', kind: 'age', raw_score: 31.4, ui_score: null, label: null, mask_name: null, mask_url: null },
  },
  skinType: { whole: 'Oily', tZone: 'Oily', uZone: 'Normal', raw: null },
  skinAge: { raw: 31.4, ui: null },
  overall: { raw: 74, ui: null },
  masks: [{ key: 'hd_moisture', url: null, name: 'hd_moisture_output.png' }],
};

/**
 * saveScan hace dos consultas: (1) versión del consentimiento, (2) INSERT.
 * Se encolan en ese orden para que cada test controle ambas.
 */
function mockQueries({
  consentVersion = BIOMETRIC_CONSENT_VERSION,
  consentError = null,
  insertRow = { id: 42, captured_at: '2026-10-19T12:00:00.000Z' },
  insertError = null,
} = {}) {
  pool.query.mockImplementationOnce(async () => {
    if (consentError) throw consentError;
    return { rows: consentVersion === null ? [] : [{ version_terms: consentVersion }] };
  });
  pool.query.mockImplementationOnce(async () => {
    if (insertError) throw insertError;
    return { rows: [insertRow] };
  });
}

describe('ScanSessionService — persistencia cifrada (Y-F1)', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  test('inserta metrics_count real y cifra el bloque de métricas', async () => {
    mockQueries();

    const result = await scanSessionService.saveScan({ userId: 7, faceScores: FACE_SCORES });

    expect(result.persisted).toBe(true);
    expect(result.id).toBe(42);
    expect(result.metricsCount).toBe(Object.keys(FACE_SCORES.metrics).length);

    const [, params] = pool.query.mock.calls[1];
    const [userId, taskId, encrypted, metricsCount, requestedActions, missing, , , consentVersion, consentOutdated] = params;

    expect(userId).toBe(7);
    expect(taskId).toBe('task-777');
    expect(metricsCount).toBe(Object.keys(FACE_SCORES.metrics).length);
    // Ciphertext con formato iv:tag:hex, nunca JSON en claro
    expect(typeof encrypted).toBe('string');
    expect(encrypted.split(':')).toHaveLength(3);
    expect(encrypted.includes('hd_moisture')).toBe(false);

    // El sobre descifrado devuelve exactamente lo que se midió
    const decrypted = biometricCryptoService.decrypt(encrypted);
    expect(Object.keys(decrypted.metrics)).toHaveLength(Object.keys(FACE_SCORES.metrics).length);
    expect(decrypted.metrics.hd_moisture.raw_score).toBeCloseTo(48.694559931755066, 10);
    expect(decrypted.legacy.hydration).toBe(70);
    expect(decrypted.providerTaskId).toBe('task-777');

    // Metadatos de auditoría en claro
    expect(JSON.parse(requestedActions)).toHaveLength(5);
    expect(JSON.parse(missing)).toEqual(['hd_tear_trough']);

    // Y-F1b: versión del consentimiento registrada en el escaneo
    expect(consentVersion).toBe(BIOMETRIC_CONSENT_VERSION);
    expect(consentOutdated).toBe(false);
  });

  test('un fallo de escritura no rompe la respuesta (tolerante por defecto)', async () => {
    mockQueries({ insertError: new Error('connection reset') });

    const result = await scanSessionService.saveScan({ userId: 7, faceScores: FACE_SCORES });

    expect(result.persisted).toBe(false);
    expect(result.reason).toMatch(/connection reset/);
  });

  test('con tolerante:false propaga el error', async () => {
    mockQueries({ insertError: new Error('permission denied') });

    await expect(
      scanSessionService.saveScan({ userId: 7, faceScores: FACE_SCORES, tolerante: false })
    ).rejects.toThrow(/permission denied/);
  });

  test('sin métricas no intenta escribir', async () => {
    const result = await scanSessionService.saveScan({ userId: 7, faceScores: { metrics: {} } });

    expect(result.persisted).toBe(false);
    expect(result.reason).toMatch(/sin métricas/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('getScan descifra el sobre guardado', async () => {
    const encrypted = biometricCryptoService.encrypt({
      version: 1,
      providerTaskId: 'task-777',
      metrics: FACE_SCORES.metrics,
      legacy: { hydration: 70 },
    });

    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 42,
        user_id: 7,
        provider: 'youcam',
        provider_task_id: 'task-777',
        metrics_encrypted: encrypted,
        metrics_count: Object.keys(FACE_SCORES.metrics).length,
        requested_actions: ['hd_moisture'],
        missing_metrics: [],
        geometry: null,
        quality: null,
        consent_version: '2.0',
        consent_outdated: false,
        captured_at: '2026-10-19T12:00:00.000Z',
      }],
    });

    const scan = await scanSessionService.getScan(42);

    expect(scan.payload.metrics.hd_moisture.ui_score).toBe(70);
    expect(scan.metricsCount).toBe(Object.keys(FACE_SCORES.metrics).length);
    expect(scan.consentVersion).toBe('2.0');
    expect(scan.consentOutdated).toBe(false);
  });
});

describe('ScanSessionService — versión del consentimiento (Y-F1b)', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  const findInsertParams = () => {
    const call = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO biometric_scan_sessions'));
    return call ? call[1] : null;
  };

  test('consentimiento 2.0 (anterior) se guarda marcado para re-consentir', async () => {
    mockQueries({ consentVersion: '2.0' });

    const result = await scanSessionService.saveScan({ userId: 7, faceScores: FACE_SCORES });

    // El permiso es válido (el usuario autorizó), pero el texto que leyó ya no es el
    // vigente: 2.1 es la actual desde Y-F1d.
    expect(result.consentVersion).toBe('2.0');
    expect(result.consentOutdated).toBe(true);

    const params = findInsertParams();
    expect(params[8]).toBe('2.0');
    expect(params[9]).toBe(true);
  });

  test('consentimiento con la versión vigente no se marca', async () => {
    mockQueries({ consentVersion: BIOMETRIC_CONSENT_VERSION });

    const result = await scanSessionService.saveScan({ userId: 7, faceScores: FACE_SCORES });

    expect(result.consentVersion).toBe(BIOMETRIC_CONSENT_VERSION);
    expect(result.consentOutdated).toBe(false);

    const params = findInsertParams();
    expect(params[8]).toBe(BIOMETRIC_CONSENT_VERSION);
    expect(params[9]).toBe(false);
  });

  test('consentimiento 1.0 (anterior) queda marcado como desactualizado', async () => {
    mockQueries({ consentVersion: '1.0' });

    const result = await scanSessionService.saveScan({ userId: 7, faceScores: FACE_SCORES });

    expect(result.consentVersion).toBe('1.0');
    expect(result.consentOutdated).toBe(true);

    const params = findInsertParams();
    expect(params[8]).toBe('1.0');
    expect(params[9]).toBe(true);
  });

  test('sin consentimiento legible no inventa versión y marca el escaneo', async () => {
    mockQueries({ consentVersion: null });

    const result = await scanSessionService.saveScan({ userId: 7, faceScores: FACE_SCORES });

    expect(result.consentVersion).toBeNull();
    expect(result.consentOutdated).toBe(true);

    const params = findInsertParams();
    expect(params[8]).toBeNull();
    expect(params[9]).toBe(true);
  });

  test('si la consulta del consentimiento falla, el escaneo se guarda igual', async () => {
    mockQueries({ consentError: new Error('relation does not exist') });

    const result = await scanSessionService.saveScan({ userId: 7, faceScores: FACE_SCORES });

    expect(result.persisted).toBe(true);
    expect(result.consentVersion).toBeNull();
    expect(result.consentOutdated).toBe(true);
  });
});
