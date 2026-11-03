// backend/src/tests/youcamFullMetrics.test.js
//
// Y-F1 — Verifica que la llamada a YouCam se explota completa:
//   1. se piden las 16 acciones HD en una sola tarea,
//   2. el parser entiende la respuesta anidada por subregión (la forma real de las
//      acciones HD), no solo el array plano,
//   3. se conserva raw_score (float) y las máscaras,
//   4. las claves heredadas siguen existiendo para no romper al orquestador,
//   5. una acción opcional ausente se declara en `missing` y no rompe el análisis;
//      una métrica obligatoria ausente sí falla (fail-closed).

const youcamClient = require('../services/biometric/youcam.client');
const { breakers } = require('../services/circuitBreakerService');

jest.mock('axios');

/** Respuesta HD tal como la documenta Perfect Corp: plana + anidada por subregión. */
const HD_RESULTS = {
  hd_redness: { raw_score: 72.011962890625, ui_score: 77, output_mask_name: 'hd_redness_output.png' },
  hd_oiliness: { raw_score: 60.74365234375, ui_score: 72, output_mask_name: 'hd_oiliness_output.png' },
  hd_age_spot: { raw_score: 83.23274230957031, ui_score: 77, output_mask_name: 'hd_age_spot_output.png' },
  hd_radiance: { raw_score: 76.57244205474854, ui_score: 79, output_mask_name: 'hd_radiance_output.png' },
  hd_moisture: { raw_score: 48.694559931755066, ui_score: 70, output_mask_name: 'hd_moisture_output.png' },
  hd_dark_circle: { raw_score: 80.1993191242218, ui_score: 76, output_mask_name: 'hd_dark_circle_output.png' },
  hd_eye_bag: { raw_score: 76.67280435562134, ui_score: 79, output_mask_name: 'hd_eye_bag_output.png' },
  hd_droopy_upper_eyelid: { raw_score: 79.05348539352417, ui_score: 80, output_mask_name: 'hd_droopy_upper_eyelid_output.png' },
  hd_droopy_lower_eyelid: { raw_score: 79.97175455093384, ui_score: 81, output_mask_name: 'hd_droopy_lower_eyelid_output.png' },
  hd_firmness: { raw_score: 89.66898322105408, ui_score: 85, output_mask_name: 'hd_firmness_output.png' },
  hd_tear_trough: { raw_score: 71.5, ui_score: 74, output_mask_name: 'hd_tear_trough_output.png' },
  hd_texture: {
    whole: { raw_score: 66.3921568627451, ui_score: 75, output_mask_name: 'hd_texture_output.png' },
  },
  hd_acne: {
    whole: { raw_score: 59.92677688598633, ui_score: 76, output_mask_name: 'hd_acne_output.png' },
  },
  hd_pore: {
    forehead: { raw_score: 79.59770965576172, ui_score: 80, output_mask_name: 'hd_pore_output_forehead.png' },
    nose: { raw_score: 29.139814376831055, ui_score: 58, output_mask_name: 'hd_pore_output_nose.png' },
    cheek: { raw_score: 44.11081314086914, ui_score: 65, output_mask_name: 'hd_pore_output_cheek.png' },
    whole: { raw_score: 55.0, ui_score: 69, output_mask_name: 'hd_pore_output_whole.png' },
  },
  hd_wrinkle: {
    forehead: { raw_score: 81.1, ui_score: 78, output_mask_name: 'hd_wrinkle_output_forehead.png' },
    glabellar: { raw_score: 82.2, ui_score: 79, output_mask_name: 'hd_wrinkle_output_glabellar.png' },
    crowfeet: { raw_score: 83.3, ui_score: 80, output_mask_name: 'hd_wrinkle_output_crowfeet.png' },
    periocular: { raw_score: 84.4, ui_score: 81, output_mask_name: 'hd_wrinkle_output_periocular.png' },
    nasolabial: { raw_score: 85.5, ui_score: 82, output_mask_name: 'hd_wrinkle_output_nasolabial.png' },
    marionette: { raw_score: 86.6, ui_score: 83, output_mask_name: 'hd_wrinkle_output_marionette.png' },
    whole: { raw_score: 84.0, ui_score: 81, output_mask_name: 'hd_wrinkle_output_whole.png' },
  },
  hd_skin_type: { whole: 'Oily', t_zone: 'Oily', u_zone: 'Normal' },
  skin_age: { score: 31.4 },
  all: { score: 74 },
};

describe('YouCam — explotación completa de la llamada (Y-F1)', () => {
  beforeEach(() => {
    youcamClient.apiKey = 'test-key';
    breakers.youcam.reset();
    breakers.youcam.failureThreshold = 10;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('pide las 16 acciones HD en una sola tarea', async () => {
    const axiosMock = require('axios');
    axiosMock.post.mockResolvedValueOnce({ data: { data: { task_id: 'task-123' } } });

    const taskId = await youcamClient._createAnalysisTask('file-abc', 'trace-1');

    expect(taskId).toBe('task-123');
    const [, body] = axiosMock.post.mock.calls[0];
    expect(Array.isArray(body.dst_actions)).toBe(true);
    expect(body.dst_actions).toHaveLength(16);
    expect(body.dst_actions).toEqual(expect.arrayContaining([
      'hd_texture', 'hd_acne', 'hd_pore', 'hd_wrinkle', 'hd_skin_type', 'hd_tear_trough',
    ]));
    // HD y SD no se mezclan: ninguna acción enviada puede ser SD.
    expect(body.dst_actions.every((action) => action.startsWith('hd_'))).toBe(true);
  });

  test('parsea la respuesta anidada y devuelve al menos 29 métricas', () => {
    const parsed = youcamClient._parseResults(HD_RESULTS);

    const count = Object.keys(parsed.metrics).length;
    expect(count).toBeGreaterThanOrEqual(29);
    expect(parsed.missing).toEqual([]);

    // Subregiones que el mapeador plano descartaba
    expect(parsed.metrics['hd_texture.whole']).toBeDefined();
    expect(parsed.metrics['hd_acne.whole']).toBeDefined();
    expect(parsed.metrics['hd_pore.forehead']).toBeDefined();
    expect(parsed.metrics['hd_pore.nose']).toBeDefined();
    expect(parsed.metrics['hd_wrinkle.nasolabial']).toBeDefined();
    expect(parsed.metrics['hd_skin_type.t_zone'].label).toBe('Oily');
  });

  test('conserva raw_score con precisión y las máscaras', () => {
    const parsed = youcamClient._parseResults(HD_RESULTS);

    expect(parsed.metrics.hd_moisture.raw_score).toBeCloseTo(48.694559931755066, 10);
    expect(parsed.metrics.hd_moisture.ui_score).toBe(70);
    expect(parsed.metrics['hd_pore.nose'].mask_name).toBe('hd_pore_output_nose.png');
    expect(parsed.masks.length).toBeGreaterThanOrEqual(20);
    expect(parsed.masks.every((mask) => typeof mask.key === 'string')).toBe(true);
  });

  test('mantiene las claves heredadas que consume el orquestador', () => {
    const parsed = youcamClient._parseResults(HD_RESULTS);

    expect(parsed.hydration).toBe(70);
    expect(parsed.wrinkles).toBe(81);
    expect(parsed.spots).toBe(77);
    expect(parsed.pores).toBe(69);
    // Y-F2: hd_skin_type es el tipo de piel, no el subtono. El subtono lo mide
    // undertone.service; el parser lo deja en null.
    expect(parsed.pielTipo).toBe('Oily');
    expect(parsed.subtono).toBeNull();
    expect(parsed.bioAge).toBeCloseTo(31.4, 6);
    expect(parsed.skinAge.raw).toBeCloseTo(31.4, 6);
    expect(parsed.overall.raw).toBe(74);
  });

  test('una acción opcional ausente se declara en missing y no rompe el análisis', () => {
    const partial = { ...HD_RESULTS };
    delete partial.hd_tear_trough;

    const parsed = youcamClient._parseResults(partial);

    expect(parsed.missing).toContain('hd_tear_trough');
    expect(parsed.hydration).toBe(70);
  });

  test('una métrica obligatoria ausente falla en cerrado', () => {
    const broken = { ...HD_RESULTS };
    delete broken.hd_moisture;

    expect(() => youcamClient._parseResults(broken)).toThrow(/métricas obligatorias: hydration/);
  });

  test('acepta la forma SD (array output) y normaliza a claves HD', () => {
    const sd = {
      output: [
        { type: 'moisture', ui_score: 64, raw_score: 63.2 },
        { type: 'wrinkle', ui_score: 71, raw_score: 70.1 },
        { type: 'age_spot', ui_score: 66, raw_score: 65.4 },
        { type: 'pore', ui_score: 58, raw_score: 57.7 },
        { type: 'texture', ui_score: 60, raw_score: 59.9 },
        { type: 'skin_age', score: 29.5 },
      ],
    };

    const parsed = youcamClient._parseResults(sd);

    expect(parsed.hydration).toBe(64);
    expect(parsed.metrics.hd_texture).toBeDefined();
    expect(parsed.bioAge).toBeCloseTo(29.5, 6);
  });

  test('analyzeFace recorre los 4 pasos y devuelve providerTaskId + métricas ricas', async () => {
    const axiosMock = require('axios');

    // Paso 1: slot de archivo (respuesta anidada bajo data, como documenta la API)
    axiosMock.post.mockResolvedValueOnce({
      data: {
        data: {
          files: [{
            file_id: 'file-xyz',
            requests: [{ method: 'PUT', url: 'https://s3.example.com/upload', headers: { 'Content-Type': 'image/jpeg' } }],
          }],
        },
      },
    });
    // Paso 2: subida
    axiosMock.put.mockResolvedValueOnce({ status: 200 });
    // Paso 3: creación de tarea
    axiosMock.post.mockResolvedValueOnce({ data: { data: { task_id: 'task-777' } } });
    // Paso 4: resultado
    axiosMock.get.mockResolvedValueOnce({ data: { data: { task_status: 'success', results: HD_RESULTS } } });

    const result = await youcamClient.analyzeFace(Buffer.from('fake-image-bytes'), 'trace-2');

    expect(result.providerTaskId).toBe('task-777');
    expect(Object.keys(result.metrics).length).toBeGreaterThanOrEqual(29);
    expect(result.hydration).toBe(70);
    // Regresión: la URL de subida ya no es undefined
    expect(axiosMock.put.mock.calls[0][0]).toBe('https://s3.example.com/upload');
  });
});
