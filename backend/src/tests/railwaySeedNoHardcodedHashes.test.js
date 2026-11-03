/**
 * t_fix_tenant_02 — Integridad de datos: el seed de Railway no debe versionar hashes bcrypt reales.
 *
 * HALLAZGO P0
 *   backend/railway_seed.sql (y su copia idéntica en la raíz, railway_seed.sql) incluían
 *   hashes bcrypt LITERALES en la columna `password_hash`. Peor aún: las cuentas 101
 *   (PRESTADOR), 1 (CLIENTE) y 200 (SALON) compartían el MISMO hash, de modo que una sola
 *   contraseña filtrada abría varias cuentas —incluida la de dueño de salón.
 *
 * CONVENCIÓN DEL PROYECTO (ya vigente en backend/seed.sql)
 *   Las contraseñas de la siembra se generan EN RUNTIME a partir de la variable de entorno
 *   SEED_PASSWORD (ver backend/src/utils/seedRunner.js). El SQL versionado sólo puede llevar
 *   el marcador de reemplazo; nunca el hash.
 *
 * Estas pruebas fallan (ROJO) mientras exista un hash bcrypt literal en cualquiera de los
 * seed de Railway, y pasan (VERDE) cuando sólo queda el marcador de runtime.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Hash bcrypt en formato estándar: $2a/$2b/$2y + coste (2 dígitos) + 22/31+ chars base64.
const BCRYPT_RE = /\$2[aby]\$\d{2}\$[A-Za-z0-9./]{10,}/g;

// Marcador canónico de hash-en-runtime (mismo que backend/seed.sql + seedRunner.js).
const PLACEHOLDER = '__' + 'SEED_PASSWORD_HASH' + '__';

// Fila de INSERT de usuarios: (id, 'email@...', 'hash', ... 'LOCAL' ...
const USER_ROW_RE = /^\(\d+,\s*'[^']*@[^']*'[\s\S]*'LOCAL'/;

const SEED_FILES = [
  { etiqueta: 'backend/railway_seed.sql', ruta: path.resolve(__dirname, '../../railway_seed.sql') },
  { etiqueta: 'railway_seed.sql (raíz)', ruta: path.resolve(__dirname, '../../../railway_seed.sql') },
];

// Contraseñas que un atacante probaría de inmediato contra un hash filtrado.
const CANDIDATOS_DICCIONARIO = [
  'password', 'password123', '123456', 'admin', 'admin123',
  'demo', 'test1234', '12345678', 'secret', 'qwerty',
];

describe('railway_seed.sql — sin hashes bcrypt reales versionados (t_fix_tenant_02)', () => {
  test.each(SEED_FILES)('$etiqueta existe y es legible', ({ ruta }) => {
    expect(fs.existsSync(ruta)).toBe(true);
    expect(fs.readFileSync(ruta, 'utf8').length).toBeGreaterThan(0);
  });

  test.each(SEED_FILES)('$etiqueta no contiene ningún hash bcrypt literal', ({ ruta }) => {
    const sql = fs.readFileSync(ruta, 'utf8');
    const hashes = sql.match(BCRYPT_RE) || [];
    // ROJO si hay hashes reales versionados; VERDE cuando la lista queda vacía.
    expect(hashes).toEqual([]);
  });

  test.each(SEED_FILES)('$etiqueta usa el marcador de hash en runtime en cada fila de usuarios', ({ ruta }) => {
    const sql = fs.readFileSync(ruta, 'utf8');
    const filasUsuarios = sql
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter((linea) => USER_ROW_RE.test(linea));

    expect(filasUsuarios.length).toBeGreaterThan(0);
    for (const fila of filasUsuarios) {
      expect(fila).toContain(PLACEHOLDER);
    }
  });

  test('ningún hash del seed autentica con contraseñas de diccionario', () => {
    for (const { etiqueta, ruta } of SEED_FILES) {
      const sql = fs.readFileSync(ruta, 'utf8');
      const hashes = sql.match(BCRYPT_RE) || [];
      for (const hash of hashes) {
        for (const password of CANDIDATOS_DICCIONARIO) {
          let coincide = false;
          try {
            coincide = bcrypt.compareSync(password, hash);
          } catch (_) {
            coincide = false;
          }
          expect({ etiqueta, password, coincide }).toEqual({ etiqueta, password, coincide: false });
        }
      }
    }
  });
});
