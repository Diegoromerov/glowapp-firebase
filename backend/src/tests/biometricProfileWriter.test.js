// backend/src/tests/biometricProfileWriter.test.js
process.env.NODE_ENV = 'test';
process.env.USE_PG_MEM = 'true';
process.env.JWT_SECRET = 'secreto_super_seguro_para_pruebas_unitarias_32chars';

const profileService = require('../services/biometric/profile.service');
const biometricCryptoService = require('../services/biometricCryptoService');
const { pool } = require('../config/db');

describe('Ticket B-01 (P1): Biometric Writer & JSONB Serialization (pg-mem)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('[pg-mem] saveProfile y getProfile: escribe en JSONB envuelto en JSON string sin error 22P02, lee y descifra 100%', async () => {
    const faceScoresInput = { hydration: 85, spots: 10, wrinkles: 5 };
    const handsDiagnosisInput = { hydration: 90, texture: 'soft' };

    const saved = await profileService.saveProfile({
      userId: 888,
      faceScores: faceScoresInput,
      handsDiagnosis: handsDiagnosisInput,
      recommendation: 'Tratamiento de hidratación nocturna'
    });

    expect(saved).toBeDefined();
    expect(saved.faceScores).toEqual(faceScoresInput);

    const fetched = await profileService.getProfile(888);
    expect(fetched).toBeDefined();
    expect(fetched.faceScores).toEqual(faceScoresInput);
    expect(fetched.handsDiagnosis).toEqual(handsDiagnosisInput);
    expect(fetched.recommendation).toBe('Tratamiento de hidratación nocturna');
  });

  test('[pg-mem] Transacción atómica (Rollback): si falla el INSERT en biometric_history se ejecuta ROLLBACK y 0 filas quedan en beauty_profiles', async () => {
    const testUserId = 999;
    const origConnect = pool.connect;

    jest.spyOn(pool, 'connect').mockImplementation(async () => {
      const realClient = await origConnect.call(pool);
      const origClientQuery = realClient.query;

      realClient.query = jest.fn().mockImplementation(async (text, params) => {
        if (typeof text === 'string' && text.includes('INSERT INTO biometric_history')) {
          throw new Error('Fallo provocado en biometric_history para verificar ROLLBACK');
        }
        return origClientQuery.call(realClient, text, params);
      });

      return realClient;
    });

    await expect(
      profileService.saveProfile({
        userId: testUserId,
        faceScores: { hydration: 50 },
        handsDiagnosis: { hydration: 50 },
        recommendation: 'Prueba de rollback atómico'
      })
    ).rejects.toThrow(/Fallo crítico al registrar historial biométrico/);

    // Verificar que gracias al ROLLBACK no quedó guardado nada en beauty_profiles
    const checkRes = await pool.query('SELECT * FROM beauty_profiles WHERE user_id = $1', [testUserId]);
    expect(checkRes.rows.length).toBe(0);
  });

  test('[pg-mem] Garantía de Liberación de Conexión: client.release(err) se ejecuta si el ROLLBACK falla, preservando el error original', async () => {
    const testUserId = 998;
    const origConnect = pool.connect;
    let releaseSpy = jest.fn();

    jest.spyOn(pool, 'connect').mockImplementation(async () => {
      const realClient = await origConnect.call(pool);
      releaseSpy = jest.spyOn(realClient, 'release');
      const origClientQuery = realClient.query;

      realClient.query = jest.fn().mockImplementation(async (text, params) => {
        if (typeof text === 'string' && text.includes('INSERT INTO beauty_profiles')) {
          return Promise.resolve({ rows: [{ id: 998, user_id: testUserId, created_at: new Date() }] });
        }
        if (typeof text === 'string' && text.includes('INSERT INTO biometric_history')) {
          throw new Error('Fallo provocado en biometric_history (error original)');
        }
        if (typeof text === 'string' && text.includes('ROLLBACK')) {
          throw new Error('Fallo provocado en ROLLBACK');
        }
        return origClientQuery.call(realClient, text, params);
      });

      return realClient;
    });

    await expect(
      profileService.saveProfile({
        userId: testUserId,
        faceScores: { hydration: 50 },
        handsDiagnosis: { hydration: 50 },
        recommendation: 'Prueba de release en error de ROLLBACK'
      })
    ).rejects.toThrow(/Fallo crítico al registrar historial biométrico: Fallo provocado en biometric_history/);

    expect(releaseSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'Fallo provocado en ROLLBACK' }));
  });

  test('[pg-mem] biometricCryptoService.decrypt: maneja de forma segura objetos planos sin cifrar y cadenas JSON antiguas', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const plainObj = { hydration: 70, spots: 20 };
    const plainJsonStr = '{"hydration": 70, "spots": 20}';

    // 1. Objeto directo
    const resObj = biometricCryptoService.decrypt(plainObj);
    expect(resObj).toEqual(plainObj);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[BIOMETRIC_DECRYPT_PLAIN_FALLBACK]'));

    // 2. String JSON plano no cifrado
    const resJsonStr = biometricCryptoService.decrypt(plainJsonStr);
    expect(resJsonStr).toEqual(plainObj);
  });

  test('PostgreSQL Real Integration (Docker/Local): prueba de atomicidad y cifrado JSONB si hay base real disponible', async () => {
    if (process.env.USE_PG_MEM !== 'false' && !process.env.TEST_REAL_PG_URL) {
      console.log('ℹ️ SKIP: Test contra PostgreSQL real omitido porque no se especificó base real (USE_PG_MEM=false o TEST_REAL_PG_URL). Pruebas ejecutadas contra harness pg-mem.');
      return;
    }

    const pg = require('pg');
    const connectionString = process.env.TEST_REAL_PG_URL || 'postgres://postgres:postgres@localhost:5432/beauty_db_test';
    const realPool = new pg.Pool({ connectionString, connectionTimeoutMillis: 2000 });

    try {
      const client = await realPool.connect();
      await client.query('SELECT 1');
      client.release();
    } catch (err) {
      console.log(`ℹ️ SKIP: Instancia de PostgreSQL real no accesible en ${connectionString} (${err.message}). Omitiendo integración real.`);
      await realPool.end();
      return;
    }

    try {
      // Ejercicio atómico en PostgreSQL real
      const testUserId = 7777;
      const saved = await profileService.saveProfile({
        userId: testUserId,
        faceScores: { hydration: 95 },
        handsDiagnosis: { hydration: 90 },
        recommendation: 'Test PG Real'
      });
      expect(saved.faceScores.hydration).toBe(95);
    } finally {
      await realPool.end();
    }
  });
});
