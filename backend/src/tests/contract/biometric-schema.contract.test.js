// backend/src/tests/contract/biometric-schema.contract.test.js
/**
 * CONTRACT TEST — Contrato de entrada de la API biométrica (Zod).
 *
 * Hallazgo QA #3 (FASE C · AUD-QA): «Contratos API sin contract tests»
 * (docs/audit/GLOWAPP_TECHNICAL_MAP.md §15 — "Missing contract testing: no
 * automated API contract verification between frontend and backend").
 *
 * backend/src/schemas/biometric.schema.js es la fuente de verdad que los
 * endpoints mutantes aplican (ADR-001 Checklist Item 3) tanto en la ruta
 * canónica POST /api/biometric/analyze como en la versionada
 * POST /v1/beauty/analyze. Este test congela ese contrato: si alguien cambia
 * el schema (un campo que pasa a opcional, un enum que se amplía, un límite
 * que se relaja), el contrato con el cliente se rompe y esta suite lo detecta
 * ANTES de llegar a producción.
 */
const {
  biometricAnalyzeSchema,
  biometricProfileParamSchema,
} = require('../../schemas/biometric.schema');

describe('CONTRATO · biometricAnalyzeSchema — POST /api/biometric/analyze', () => {
  test('C1: faceImage es obligatorio y no vacío', () => {
    expect(biometricAnalyzeSchema.safeParse({}).success).toBe(false);
    expect(biometricAnalyzeSchema.safeParse({ faceImage: '' }).success).toBe(false);
    expect(biometricAnalyzeSchema.safeParse({ faceImage: 'ZmFrZS1iYXNlNjQ=' }).success).toBe(true);
  });

  test('C2: entryPoint acepta sólo el enum canónico', () => {
    ['ideas', 'vto', 'scanner', 'other'].forEach((entryPoint) => {
      const r = biometricAnalyzeSchema.safeParse({ faceImage: 'x', entryPoint });
      expect(r.success).toBe(true);
      expect(r.data.entryPoint).toBe(entryPoint);
    });

    expect(biometricAnalyzeSchema.safeParse({ faceImage: 'x', entryPoint: 'instagram' }).success).toBe(false);
    expect(biometricAnalyzeSchema.safeParse({ faceImage: 'x', entryPoint: '' }).success).toBe(false);
  });

  test('C3: entryPoint tiene default "ideas" cuando el cliente lo omite', () => {
    const r = biometricAnalyzeSchema.safeParse({ faceImage: 'x' });
    expect(r.success).toBe(true);
    expect(r.data.entryPoint).toBe('ideas');
  });

  test('C4: lat/lng son geográficamente válidos (lat ∈ [-90,90], lng ∈ [-180,180])', () => {
    expect(biometricAnalyzeSchema.safeParse({ faceImage: 'x', lat: 4.711, lng: -74.0721 }).success).toBe(true);
    expect(biometricAnalyzeSchema.safeParse({ faceImage: 'x', lat: 90, lng: 180 }).success).toBe(true);
    expect(biometricAnalyzeSchema.safeParse({ faceImage: 'x', lat: -90, lng: -180 }).success).toBe(true);

    expect(biometricAnalyzeSchema.safeParse({ faceImage: 'x', lat: 91 }).success).toBe(false);
    expect(biometricAnalyzeSchema.safeParse({ faceImage: 'x', lat: -91 }).success).toBe(false);
    expect(biometricAnalyzeSchema.safeParse({ faceImage: 'x', lng: 181 }).success).toBe(false);
    expect(biometricAnalyzeSchema.safeParse({ faceImage: 'x', lng: -181 }).success).toBe(false);
  });

  test('C5: handsImage/lat/lng/consentToken son opcionales y admiten null', () => {
    const r = biometricAnalyzeSchema.safeParse({
      faceImage: 'x',
      handsImage: null,
      lat: null,
      lng: null,
      consentToken: null,
    });
    expect(r.success).toBe(true);
    expect(r.data.handsImage).toBeNull();
    expect(r.data.consentToken).toBeNull();
  });

  test('C6: un payload completo válido se acepta sin pérdida de campos', () => {
    const r = biometricAnalyzeSchema.safeParse({
      faceImage: 'ZmFrZS1iYXNlNjQ=',
      handsImage: 'bWFub3M=',
      entryPoint: 'scanner',
      lat: 4.711,
      lng: -74.0721,
      consentToken: 'consent-uuid-123',
    });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      faceImage: 'ZmFrZS1iYXNlNjQ=',
      handsImage: 'bWFub3M=',
      entryPoint: 'scanner',
      lat: 4.711,
      lng: -74.0721,
      consentToken: 'consent-uuid-123',
    });
  });
});

describe('CONTRATO · biometricProfileParamSchema — GET|DELETE /api/biometric/profile/:userId', () => {
  test('C7: userId string se mantiene como string', () => {
    const r = biometricProfileParamSchema.safeParse({ userId: '42' });
    expect(r.success).toBe(true);
    expect(r.data.userId).toBe('42');
    expect(typeof r.data.userId).toBe('string');
  });

  test('C8: userId numérico se normaliza a string (req.params siempre es string)', () => {
    const r = biometricProfileParamSchema.safeParse({ userId: 42 });
    expect(r.success).toBe(true);
    expect(r.data.userId).toBe('42');
    expect(typeof r.data.userId).toBe('string');
  });

  test('C9: falta userId → payload rechazado', () => {
    expect(biometricProfileParamSchema.safeParse({}).success).toBe(false);
  });
});
