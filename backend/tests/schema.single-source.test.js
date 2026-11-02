/**
 * backend/tests/schema.single-source.test.js
 *
 * Guardián de integridad del esquema (hallazgo P0 · t_fix_tenant_01).
 *
 * Hallazgo reproducido por este test:
 *   `backend/schema.sql` y `backend/init.sql` eran DOS definiciones del mismo
 *   esquema que habían divergido:
 *     - codificación: `schema.sql` en UTF-16-LE (BOM FF FE) vs `init.sql` en UTF-8;
 *     - contenido: tablas/columnas distintas para las mismas tablas base
 *       (p. ej. `bookings`, `usuarios`).
 *   Además `backend/index.js` aplicaba `schema.sql` al arrancar, mientras que la
 *   compuerta de CI (`scripts/prepareRlsDatabase.js`) aplica `init.sql`
 *   ⇒ dos bases de datos distintas según el camino de arranque.
 *
 * Fuente de verdad única (a partir del fix):
 *   `backend/init.sql` (+ `backend/migrations/*.sql`).
 *
 * El test es estático (sólo lee el repo), así que no necesita PostgreSQL.
 */
const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.join(__dirname, '..');
const CANONICO = path.join(BACKEND_DIR, 'init.sql');
const SEGUNDA_DEFINICION = path.join(BACKEND_DIR, 'schema.sql');
const ARRANQUE = path.join(BACKEND_DIR, 'index.js');

const BOM_UTF16_LE = Buffer.from([0xff, 0xfe]);
const BOM_UTF16_BE = Buffer.from([0xfe, 0xff]);

/** Un binario UTF-16 (o leído como si lo fuera) contiene bytes NUL. */
function pareceUtf16(buf) {
  return (
    buf.subarray(0, 2).equals(BOM_UTF16_LE) ||
    buf.subarray(0, 2).equals(BOM_UTF16_BE) ||
    buf.includes(0x00)
  );
}

describe('P0 integridad de datos · una sola fuente de verdad del esquema SQL', () => {
  test('init.sql es el esquema canónico, existe y está en UTF-8 sin BOM', () => {
    expect(fs.existsSync(CANONICO)).toBe(true);
    const bytes = fs.readFileSync(CANONICO);
    expect(pareceUtf16(bytes)).toBe(false);
    // Debe decodificar a texto SQL (no a basura de una mala interpretación).
    expect(bytes.toString('utf8')).toMatch(/CREATE TABLE/i);
  });

  test('ningún archivo de esquema quedó en UTF-16 (ilegible para psql y fs.readFileSync utf8)', () => {
    const archivosDeEsquema = ['init.sql', 'schema.sql']
      .map((nombre) => path.join(BACKEND_DIR, nombre))
      .filter((ruta) => fs.existsSync(ruta));
    const enUtf16 = archivosDeEsquema.filter((ruta) => pareceUtf16(fs.readFileSync(ruta)));
    expect(enUtf16).toEqual([]);
  });

  test('no existe una segunda definición de esquema divergente (backend/schema.sql)', () => {
    // Si existiera como snapshot, tendría que ser idéntico al canónico; hoy diverge.
    expect(fs.existsSync(SEGUNDA_DEFINICION)).toBe(false);
  });

  test('index.js arranca el esquema desde la fuente canónica (init.sql), no desde schema.sql', () => {
    const src = fs.readFileSync(ARRANQUE, 'utf8');
    const referencias = [...src.matchAll(/['"]([A-Za-z0-9_.-]+\.sql)['"]/g)].map((m) => m[1]);
    const referenciasDeEsquema = [...new Set(referencias)].filter(
      (r) => r === 'schema.sql' || r === 'init.sql'
    );
    expect(referenciasDeEsquema).toEqual(['init.sql']);
  });
});
