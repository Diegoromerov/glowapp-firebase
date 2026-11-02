/**
 * FIX-FLUTTER-06 (P1 · API drift) — política de versión mínima publicada en /api/health.
 *
 * Hallazgo: la app no declaraba versión mínima soportada ni existía forma de
 * forzar actualización; /api/health no publicaba ninguna política de versión.
 *
 * Este test fija el contrato del módulo de política y el del endpoint:
 *   1. parseo/comparación semántica sin dependencias externas,
 *   2. `resolveAppVersionPolicy(env)` con default seguro y override por env,
 *   3. `/api/health` publica `minimum_app_version` y `latest_app_version`
 *      (contrato estático sobre el handler real, sin levantar Express ni BD).
 */

const fs = require('fs');
const path = require('path');

const policy = require('../services/appVersionPolicy');

const INDEX_PATH = path.join(__dirname, '..', '..', 'index.js');

describe('appVersionPolicy — parseo semántico', () => {
  test('parsea versiones de 3, 2 y 1 componente y el build number', () => {
    expect(policy.parseVersion('1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(policy.parseVersion('1.2')).toMatchObject({ major: 1, minor: 2, patch: 0 });
    expect(policy.parseVersion('7')).toMatchObject({ major: 7, minor: 0, patch: 0 });
    expect(policy.parseVersion('1.0.0+42')).toMatchObject({ major: 1, build: 42 });
  });

  test('devuelve null ante entradas ilegibles, sin lanzar', () => {
    for (const raw of [null, undefined, '', '   ', 'abc', '1.x.0', '-1.0.0']) {
      expect(policy.parseVersion(raw)).toBeNull();
    }
  });

  test('tolera prefijo v y espacios', () => {
    expect(policy.parseVersion('  v2.0.1 ')).toMatchObject({ major: 2, minor: 0, patch: 1 });
  });
});

describe('appVersionPolicy — comparación', () => {
  test('compara numéricamente y no por texto', () => {
    expect(policy.compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(policy.compareVersions('1.9.9', '1.10.0')).toBe(-1);
    expect(policy.compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(policy.compareVersions('1.0.0+9', '1.0.0')).toBe(0);
  });

  test('isBelowMinimum exige ambas versiones legibles (si no, false = fail-open)', () => {
    expect(policy.isBelowMinimum('1.0.0', '1.2.0')).toBe(true);
    expect(policy.isBelowMinimum('1.2.0', '1.2.0')).toBe(false);
    expect(policy.isBelowMinimum('1.3.0', '1.2.0')).toBe(false);
    expect(policy.isBelowMinimum('basura', '1.2.0')).toBe(false);
    expect(policy.isBelowMinimum('1.0.0', null)).toBe(false);
  });
});

describe('appVersionPolicy — resolveAppVersionPolicy', () => {
  test('sin variables de entorno publica un default explícito y consistente', () => {
    const p = policy.resolveAppVersionPolicy({});
    expect(p.minimum_app_version).toBe(policy.DEFAULT_MINIMUM_APP_VERSION);
    expect(p.latest_app_version).toBe(p.minimum_app_version);
    expect(policy.parseVersion(p.minimum_app_version)).not.toBeNull();
  });

  test('MINIMUM_APP_VERSION / LATEST_APP_VERSION sobrescriben el default', () => {
    const p = policy.resolveAppVersionPolicy({
      MINIMUM_APP_VERSION: '1.4.0',
      LATEST_APP_VERSION: '1.6.2',
    });
    expect(p.minimum_app_version).toBe('1.4.0');
    expect(p.latest_app_version).toBe('1.6.2');
  });

  test('latest nunca queda por debajo de minimum (política incoherente se corrige)', () => {
    const p = policy.resolveAppVersionPolicy({
      MINIMUM_APP_VERSION: '2.0.0',
      LATEST_APP_VERSION: '1.0.0',
    });
    expect(p.latest_app_version).toBe('2.0.0');
  });

  test('una variable ilegible cae al default en vez de publicar basura a los clientes', () => {
    const p = policy.resolveAppVersionPolicy({
      MINIMUM_APP_VERSION: 'no-es-una-version',
      LATEST_APP_VERSION: '7.7.7',
    });
    expect(p.minimum_app_version).toBe(policy.DEFAULT_MINIMUM_APP_VERSION);
    expect(p.latest_app_version).toBe('7.7.7');
  });

  test('no depende de la base de datos ni de red (función pura)', () => {
    expect(policy.resolveAppVersionPolicy.length).toBeLessThanOrEqual(1);
  });
});

describe('/api/health — contrato de respuesta', () => {
  const source = fs.readFileSync(INDEX_PATH, 'utf8');

  test('el handler de /api/health importa y usa resolveAppVersionPolicy', () => {
    expect(source).toMatch(/require\(['"]\.\/src\/services\/appVersionPolicy['"]\)/);
    expect(source).toContain('resolveAppVersionPolicy');
  });

  test('el bloque de /api/health publica minimum_app_version y latest_app_version', () => {
    const start = source.indexOf("app.get('/api/health'");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('});', start);
    const handler = source.slice(start, end);

    expect(handler).toContain('...resolveAppVersionPolicy(');
    expect(handler).not.toMatch(/MINIMUM_APP_VERSION\s*:/); // no hardcodeado en la ruta
  });

  test('la ruta sigue sin escribir en la base de datos (solo lectura de estado)', () => {
    const start = source.indexOf("app.get('/api/health'");
    const end = source.indexOf('});', start);
    const handler = source.slice(start, end);

    expect(handler).not.toMatch(/INSERT|UPDATE |DELETE FROM|setval/i);
  });
});
