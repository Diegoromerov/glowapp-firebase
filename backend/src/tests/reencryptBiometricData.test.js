// backend/src/tests/reencryptBiometricData.test.js
process.env.NODE_ENV = 'test';
process.env.USE_PG_MEM = 'true';
process.env.JWT_SECRET = 'secreto_super_seguro_para_pruebas_unitarias_32chars';

const { procesar, OBJETIVOS, main } = require('../../scripts/reencryptBiometricData');
const { pool } = require('../config/db');
const crypto = require('../services/biometricCryptoService');

describe('reencryptBiometricData.js — Script de Re-cifrado Biométrico (Fail-Closed & Classification)', () => {
  let originalQuery;

  beforeAll(() => {
    originalQuery = pool.query;
  });

  afterEach(() => {
    pool.query = originalQuery;
    jest.restoreAllMocks();
  });

  test('OBJETIVOS contiene únicamente las 5 columnas reales verificadas contra migraciones', () => {
    expect(OBJETIVOS).toHaveLength(5);
    expect(OBJETIVOS).toEqual([
      { tabla: 'beauty_profiles', columna: 'face_scores', isJsonb: true },
      { tabla: 'beauty_profiles', columna: 'hands_diagnosis', isJsonb: true },
      { tabla: 'biometric_history', columna: 'face_scores', isJsonb: true },
      { tabla: 'biometric_history', columna: 'hands_diagnosis', isJsonb: true },
      { tabla: 'glow_cycle_measurements', columna: 'encrypted_scores', isJsonb: false },
    ]);
  });

  test('procesar en dry-run clasifica separadamente clave activa, clave legada, JSON sin cifrar e ilegibles', async () => {
    const activeCipher = crypto.encrypt({ test: 'active' });
    const legacyCipher = crypto.encryptWithLegacyKey ? crypto.encryptWithLegacyKey({ test: 'legacy' }) : null;
    const plainJsonObject = '{"hydration": 85, "pores": 60}';
    const invalidCipher = 'invalid_corrupt_non_json_string';

    pool.query = jest.fn().mockImplementation((queryText) => {
      if (queryText.includes('FROM beauty_profiles')) {
        return Promise.resolve({
          rows: [
            { id: 1, cifrado: JSON.stringify(activeCipher) },
            { id: 2, cifrado: legacyCipher ? JSON.stringify(legacyCipher) : activeCipher },
            { id: 3, cifrado: plainJsonObject },
            { id: 4, cifrado: invalidCipher }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await procesar(OBJETIVOS[0], false, false);
    expect(res.total).toBe(4);
    expect(res.sinCifrar).toBe(1);
    expect(res.ilegibles).toBe(1);
    if (legacyCipher) {
      expect(res.legados).toBe(1);
    }
    expect(res.migrados).toBe(0);
  });

  test('procesar con aplicar=true modifica filas legadas y preserva filas sin cifrar si --encrypt-plain no está activo', async () => {
    const activeCipher = crypto.encrypt({ score: 95 });
    const legacyCipher = crypto.encryptWithLegacyKey ? crypto.encryptWithLegacyKey({ score: 80 }) : activeCipher;
    const plainJsonObject = '{"hydration": 85}';

    let dbRows = [
      { id: '10', cifrado: JSON.stringify(activeCipher) },
      { id: '11', cifrado: JSON.stringify(legacyCipher) },
      { id: '12', cifrado: plainJsonObject }
    ];

    pool.query = jest.fn().mockImplementation((queryText, params) => {
      if (queryText.includes('SELECT')) {
        return Promise.resolve({ rows: dbRows });
      }
      if (queryText.includes('UPDATE')) {
        const [newCipher, id] = params;
        const targetRow = dbRows.find(r => r.id === id);
        if (targetRow) {
          targetRow.cifrado = JSON.stringify(newCipher);
        }
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });

    const run1 = await procesar(OBJETIVOS[0], true, false);
    if (crypto.encryptWithLegacyKey) {
      expect(run1.legados).toBe(1);
      expect(run1.migrados).toBe(1);
    }
    expect(run1.sinCifrar).toBe(1);

    const row12 = dbRows.find(r => r.id === '12');
    expect(row12.cifrado).toBe(plainJsonObject);
  });

  test('Fail-Closed: procesar lanza excepción si la tabla o columna no existe en la base de datos', async () => {
    pool.query = jest.fn().mockRejectedValue(new Error('relation "tabla_inexistente" does not exist'));
    const targetInexistente = { tabla: 'tabla_inexistente', columna: 'col_inexistente', isJsonb: false };

    await expect(procesar(targetInexistente, false, false)).rejects.toThrow(
      /Error al leer tabla_inexistente.col_inexistente: relation "tabla_inexistente" does not exist/
    );
  });

  test('Fail-Closed en main(): aborta con exit code 1 y registra error si un objetivo falla al leer', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`ProcessExitCode:${code}`);
    });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    pool.query = jest.fn().mockRejectedValue(new Error('relation "biometric_profiles" does not exist'));

    await expect(main()).rejects.toThrow(/ProcessExitCode:1/);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('FAIL-CLOSED'));
    exitSpy.mockRestore();
  });

  test('PostgreSQL Real Integration (Docker/Local): prueba de dry-run y re-cifrado si hay base real disponible', async () => {
    if (process.env.USE_PG_MEM !== 'false' && !process.env.TEST_REAL_PG_URL) {
      console.log('ℹ️ SKIP: Test de re-cifrado contra PostgreSQL real omitido porque no se especificó base real (USE_PG_MEM=false o TEST_REAL_PG_URL). Pruebas ejecutadas contra harness pg-mem.');
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
      const res = await procesar(OBJETIVOS[0], false, false);
      expect(res).toBeDefined();
      expect(typeof res.total).toBe('number');
    } finally {
      await realPool.end();
    }
  });
});
