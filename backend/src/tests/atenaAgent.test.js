// backend/src/tests/atenaAgent.test.js
process.env.NODE_ENV = 'test';
process.env.USE_PG_MEM = 'true';
process.env.JWT_SECRET = 'secreto_super_seguro_para_pruebas_unitarias_32chars';

const atenaAgent = require('../services/agents/atenaAgent');
const biometricCryptoService = require('../services/biometricCryptoService');
const { pool } = require('../config/db');
const redisClient = require('../config/redis');

describe('AtenaAgent (Ticket B-01 Decryption & Cache Coverage)', () => {
  const userId = 777;

  afterEach(async () => {
    jest.restoreAllMocks();
    try {
      if (redisClient && redisClient.isOpen) {
        await redisClient.del(`beauty:profile:${userId}`);
      }
    } catch (_) {}
  });

  test('Caché fría + Fila cifrada en BD: descifra correctamente y enriquece el diagnóstico', async () => {
    const faceScores = { hydration: 80, subtono: 'calido', wrinkles: 10 };
    const handsDiagnosis = { hydration: 85, texture: 'soft' };

    const encFace = biometricCryptoService.encrypt(faceScores);
    const encHands = biometricCryptoService.encrypt(handsDiagnosis);

    const jsonFace = JSON.stringify(encFace);
    const jsonHands = JSON.stringify(encHands);

    // Insertar fila cifrada en pgMemory / PostgreSQL
    await pool.query(
      `INSERT INTO beauty_profiles (user_id, face_scores, hands_diagnosis, recommendation)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET face_scores = EXCLUDED.face_scores, hands_diagnosis = EXCLUDED.hands_diagnosis;`,
      [userId, jsonFace, jsonHands, 'Recomendación hidratante cálida']
    );

    const result = await atenaAgent.getBiometricDiagnosis(userId);
    expect(result).toBeDefined();
    expect(result.status).toBe('success');
    expect(result.skinSubtone).toBe('calido');
    expect(result.faceScores).toEqual(faceScores);
    expect(result.handsDiagnosis).toEqual(handsDiagnosis);
    expect(result.recommendedColorPalette).toContain('Dorado');
  });

  test('Caché fría + Fila en claro (legada) en BD: maneja el fallback sin crash y enriquece correctamente', async () => {
    const plainUserId = 778;
    const plainFaceScores = JSON.stringify({ hydration: 50, subtono: 'frio', wrinkles: 35 });
    const plainHandsDiagnosis = JSON.stringify({ hydration: 40 });

    await pool.query(
      `INSERT INTO beauty_profiles (user_id, face_scores, hands_diagnosis, recommendation)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET face_scores = EXCLUDED.face_scores;`,
      [plainUserId, plainFaceScores, plainHandsDiagnosis, 'Perfil legado en claro']
    );

    const result = await atenaAgent.getBiometricDiagnosis(plainUserId);
    expect(result).toBeDefined();
    expect(result.status).toBe('success');
    expect(result.skinSubtone).toBe('frio');
    expect(result.recommendedColorPalette).toContain('Plateado');
    expect(result.recommendedIngredients).toContain('Ácido Hialurónico');
    expect(result.recommendedIngredients).toContain('Retinol');
  });

  test('Caché caliente: retorna directamente los datos des-cifrados desde Redis sin consultar la BD', async () => {
    const cachedDiagnosis = {
      status: 'success',
      profileId: 1,
      userId: userId,
      faceScores: { hydration: 95, subtono: 'neutro' },
      skinSubtone: 'neutro',
      recommendedColorPalette: ['Nude Clásico', 'Rosa Palo', 'Vino Tinto'],
      recommendationText: 'Caché caliente'
    };

    redisClient.isOpen = true;
    jest.spyOn(redisClient, 'get').mockResolvedValue(JSON.stringify(cachedDiagnosis));

    try {
      const result = await atenaAgent.getBiometricDiagnosis(userId);
      expect(result).toEqual(cachedDiagnosis);
    } finally {
      redisClient.isOpen = false;
    }
  });
});
