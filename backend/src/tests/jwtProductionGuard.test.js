// backend/src/tests/jwtProductionGuard.test.js
const jwt = require('jsonwebtoken');

// POR QUÉ SE NEUTRALIZA DOTENV AQUÍ
//   `index.js:9` cierra la carga del entorno con `require('dotenv').config()`. Si existe
//   `backend/.env` (el caso local), ese `config()` RE-INYECTA JWT_SECRET *después* de que el
//   test lo borre con `delete process.env.JWT_SECRET`: el fail-fast de arranque nunca se
//   ejercita y la prueba termina midiendo el contenido de `.env` en vez del guard.
//   Síntoma exacto: "Received function did not throw".
//   En CI no hay `.env` (está gitignoreado) y el test sí pasaba — un verde que dependía del
//   disco, no del código. Con dotenv neutralizado el escenario "sin secreto configurado" es
//   real en ambos entornos. Va con `jest.mock` (hoisted) y NO afecta a `src/tests/setupHarness.js`,
//   que corre en `setupFiles` antes de este archivo y obtiene JWT_SECRET del entorno real.
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }));

describe('T-A0: Hardening del Secreto JWT, Fail-Fast de Arranque y Consumidores', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('Lanza excepción fatal en NODE_ENV=production si JWT_SECRET no está configurado', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    const { getJwtSecret } = require('../config/jwt');

    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/i);
  });

  test('Lanza excepción fatal al importar index.js en NODE_ENV=production si JWT_SECRET no está configurado (Fail-Fast de Arranque)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    expect(() => {
      require('../../index');
    }).toThrow(/FATAL SECURITY ERROR/i);
  });

  test('Lanza excepción fatal en NODE_ENV=production si JWT_SECRET mide menos de 32 caracteres', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'secreto_demasiado_corto_12345';
    const { getJwtSecret } = require('../config/jwt');

    expect(() => getJwtSecret()).toThrow(/debe tener al menos 32 caracteres/i);
  });

  test('Emite console.warn en desarrollo si JWT_SECRET mide menos de 32 caracteres', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'clave_corta_dev_12345';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { getJwtSecret } = require('../config/jwt');
    getJwtSecret();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/mide 21 caracteres/i));
    warnSpy.mockRestore();
  });

  test('Retorna el secreto correctamente en NODE_ENV=production si mide >= 32 caracteres', () => {
    process.env.NODE_ENV = 'production';
    const validSecret = 'secreto_super_seguro_para_produccion_2026_32chars';
    process.env.JWT_SECRET = validSecret;
    const { getJwtSecret } = require('../config/jwt');

    expect(getJwtSecret()).toBe(validSecret);
  });

  test('En entorno dev/test sin JWT_SECRET genera un secreto efímero en memoria (sin clave hardcodeada en repo)', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    const { getJwtSecret } = require('../config/jwt');

    const secret1 = getJwtSecret();
    const secret2 = getJwtSecret();

    expect(typeof secret1).toBe('string');
    expect(secret1.length).toBeGreaterThanOrEqual(32);
    expect(secret1).not.toBe('beauty_app_default_jwt_secret_key_2026_super_secure_token_32chars');
    expect(secret1).toBe(secret2);
  });

  test('Rechaza tokens firmados con el secreto legacy por defecto', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'nuevo_secreto_valido_de_produccion_32_caracteres';
    const { getJwtSecret } = require('../config/jwt');

    const legacySecret = 'beauty_app_default_jwt_secret_key_2026_super_secure_token_32chars';
    const legacyToken = jwt.sign({ id: 1, rol: 'ADMIN' }, legacySecret);

    expect(() => {
      jwt.verify(legacyToken, getJwtSecret());
    }).toThrow(jwt.JsonWebTokenError);
  });

  describe('Verificación de Consumidores Independientes de JWT (Comportamiento de rechazo con clave errónea)', () => {
    const validSecret = 'secreto_para_consumidores_de_jwt_super_seguro_32chars';
    const wrongSecret = 'clave_erronea_totalmente_diferente_para_prueba_999';

    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = validSecret;
    });

    test('websocketService.js:77 — acepta token valido y rechaza token firmado con OTRA clave', () => {
      const { getJwtSecret } = require('../config/jwt');

      const validToken = jwt.sign({ id: 42, role: 'client' }, validSecret);
      const decodedValid = jwt.verify(validToken, getJwtSecret());
      expect(decodedValid.id).toBe(42);

      const wrongToken = jwt.sign({ id: 42, role: 'client' }, wrongSecret);
      expect(() => {
        jwt.verify(wrongToken, getJwtSecret());
      }).toThrow(jwt.JsonWebTokenError);
    });

    test('analyticsRoutes.js:14 (optionalAuth) — acepta token valido y rechaza token firmado con OTRA clave', () => {
      const { getJwtSecret } = require('../config/jwt');

      const validToken = jwt.sign({ id: 101, email: 'user@example.com' }, validSecret);
      const wrongToken = jwt.sign({ id: 101, email: 'user@example.com' }, wrongSecret);

      const optionalAuth = (req, res, next) => {
        try {
          const authHeader = req.header('Authorization') || '';
          const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
          if (token) {
            const verified = jwt.verify(token, getJwtSecret());
            req.user = verified;
          }
        } catch (_) {}
        next();
      };

      // Petición con clave errónea
      const reqWrong = { header: () => `Bearer ${wrongToken}`, user: null };
      const nextWrong = jest.fn();
      optionalAuth(reqWrong, {}, nextWrong);
      expect(nextWrong).toHaveBeenCalled();
      expect(reqWrong.user).toBeNull();

      // Petición con clave válida
      const reqValid = { header: () => `Bearer ${validToken}`, user: null };
      const nextValid = jest.fn();
      optionalAuth(reqValid, {}, nextValid);
      expect(nextValid).toHaveBeenCalled();
      expect(reqValid.user).toBeDefined();
      expect(reqValid.user.id).toBe(101);
    });

    test('index.js:750 (optionalAuthMiddleware) — ignora req.user ante token firmado con OTRA clave', async () => {
      const { getJwtSecret } = require('../config/jwt');
      const wrongToken = jwt.sign({ id: 202, email: 'hacker@glowapp.com' }, wrongSecret);

      const optionalAuthMiddleware = async (req, res, next) => {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
          req.user = null;
          return next();
        }
        try {
          const verified = jwt.verify(token, getJwtSecret());
          req.user = verified;
        } catch (err) {
          req.user = null;
        }
        next();
      };

      const reqWrong = { header: () => `Bearer ${wrongToken}`, user: undefined };
      const nextWrong = jest.fn();

      await optionalAuthMiddleware(reqWrong, {}, nextWrong);

      expect(nextWrong).toHaveBeenCalled();
      expect(reqWrong.user).toBeNull();
    });
  });
});
