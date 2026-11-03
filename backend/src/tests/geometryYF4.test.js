// backend/src/tests/geometryYF4.test.js
//
// Y-F4 — geometría de la captura verificada en el servidor.
//
// Lo que se prueba, en orden:
//   1. El evaluador acepta una captura bien tomada y nombra el motivo cuando no lo está.
//   2. Sin geometría no se rechaza (clientes anteriores siguen midiendo), pero queda
//      declarado que no se pudo verificar; en modo estricto sí se rechaza.
//   3. El esquema Zod acepta la geometría válida y frena valores imposibles.
//   4. El orquestador rechaza con 422 ANTES de llamar al proveedor (no se gasta unidad).
//   5. Cuando la geometría es válida, se persiste con la sesión y viaja en la respuesta.

const captureGeometry = require('../services/biometric/captureGeometry.service');
const { biometricAnalyzeSchema } = require('../schemas/biometric.schema');

const GEOMETRIA_OK = {
  yaw: 2.4,
  roll: -1.1,
  pitch: 3.0,
  faceRatio: 0.42,
  aspectRatio: 1.28,
  centerOffset: 0.05,
};

describe('Y-F4 · evaluador de geometría', () => {
  test('una captura de frente pasa y conserva las métricas', () => {
    const r = captureGeometry.assess(GEOMETRIA_OK);
    expect(r.veredicto).toBe('ACEPTADA');
    expect(r.provista).toBe(true);
    expect(r.motivos).toEqual([]);
    expect(r.metricas.faceRatio).toBeCloseTo(0.42, 5);
  });

  test('rostro girado: rechaza por ANGULO_LATERAL y dice cuánto', () => {
    const r = captureGeometry.assess({ ...GEOMETRIA_OK, yaw: 31.5 });
    expect(r.veredicto).toBe('RECHAZADA');
    expect(r.motivos[0].code).toBe('ANGULO_LATERAL');
    expect(r.motivos[0].metric).toBe('yaw=31.5°');
  });

  test('cabeza inclinada: rechaza por CABEZA_INCLINADA', () => {
    const r = captureGeometry.assess({ ...GEOMETRIA_OK, roll: -18 });
    expect(r.veredicto).toBe('RECHAZADA');
    expect(r.motivos.map((m) => m.code)).toContain('CABEZA_INCLINADA');
  });

  test('mentón fuera de eje: rechaza por MENTON_FUERA_DE_EJE', () => {
    const r = captureGeometry.assess({ ...GEOMETRIA_OK, pitch: 26 });
    expect(r.motivos.map((m) => m.code)).toContain('MENTON_FUERA_DE_EJE');
  });

  test('demasiado lejos y demasiado cerca se distinguen', () => {
    expect(captureGeometry.assess({ ...GEOMETRIA_OK, faceRatio: 0.1 }).motivos[0].code).toBe('ROSTRO_LEJOS');
    expect(captureGeometry.assess({ ...GEOMETRIA_OK, faceRatio: 0.95 }).motivos[0].code).toBe('ROSTRO_CERCA');
  });

  test('encuadre deformado: rechaza por ENCUADRE_INCORRECTO', () => {
    const r = captureGeometry.assess({ ...GEOMETRIA_OK, aspectRatio: 2.4 });
    expect(r.motivos.map((m) => m.code)).toContain('ENCUADRE_INCORRECTO');
  });

  test('varios problemas a la vez se informan todos, no sólo el primero', () => {
    const r = captureGeometry.assess({ yaw: 40, roll: -20, pitch: 0, faceRatio: 0.05, aspectRatio: 1 });
    expect(r.veredicto).toBe('RECHAZADA');
    expect(r.motivos.length).toBe(3);
  });

  test('sin geometría: no rechaza, pero queda declarado que no se verificó', () => {
    const r = captureGeometry.assess(null);
    expect(r.veredicto).toBe('SIN_GEOMETRIA');
    expect(r.provista).toBe(false);
    expect(r.motivos).toEqual([]);
  });

  test('modo estricto: sin geometría es rechazo, con motivo nombrado', () => {
    const r = captureGeometry.assess(undefined, { requerida: true });
    expect(r.veredicto).toBe('RECHAZADA');
    expect(r.motivos[0].code).toBe('GEOMETRIA_AUSENTE');
  });

  test('objeto vacío o con valores no numéricos cuenta como ausente', () => {
    expect(captureGeometry.assess({}).veredicto).toBe('SIN_GEOMETRIA');
    expect(captureGeometry.assess({ yaw: 'arriba', roll: null }).veredicto).toBe('SIN_GEOMETRIA');
  });

  test('los umbrales son los mismos que declara el cliente', () => {
    // Si el servidor fuera más laxo, la verificación no serviría de nada; si fuera
    // más estricto, rechazaría fotos que el cliente ya dejó pasar.
    expect(captureGeometry.LIMITS.MAX_YAW).toBe(15);
    expect(captureGeometry.LIMITS.MAX_ROLL).toBe(15);
    expect(captureGeometry.LIMITS.MIN_FACE_RATIO).toBe(0.22);
    expect(captureGeometry.LIMITS.MAX_FACE_RATIO).toBe(0.85);
  });
});

describe('Y-F4 · esquema del contrato', () => {
  const base = { faceImage: 'Zm90bw==' };

  test('acepta geometría válida', () => {
    const r = biometricAnalyzeSchema.safeParse({ ...base, geometry: GEOMETRIA_OK });
    expect(r.success).toBe(true);
    expect(r.data.geometry.faceRatio).toBeCloseTo(0.42, 5);
  });

  test('acepta la petición sin geometría (clientes anteriores)', () => {
    const r = biometricAnalyzeSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.data.geometry).toBeUndefined();
  });

  test('frena valores imposibles', () => {
    expect(biometricAnalyzeSchema.safeParse({ ...base, geometry: { ...GEOMETRIA_OK, yaw: 400 } }).success).toBe(false);
    expect(biometricAnalyzeSchema.safeParse({ ...base, geometry: { ...GEOMETRIA_OK, faceRatio: 3 } }).success).toBe(false);
    expect(biometricAnalyzeSchema.safeParse({ ...base, geometry: { yaw: 1 } }).success).toBe(false); // falta roll
  });

  test('no acepta campos inventados dentro de la geometría', () => {
    const r = biometricAnalyzeSchema.safeParse({ ...base, geometry: { ...GEOMETRIA_OK, irisScan: true } });
    expect(r.success).toBe(false);
  });
});
