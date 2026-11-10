// Ítem 78 — las migraciones fallidas dejan de ser invisibles.
//
// Antes, un fallo se registraba con `warn` («ya existía o error idempotente») y
// no se contaba: una migración rota se reintentaba en cada arranque sin alarma.
// Aquí se fija el estado que ahora se publica en /api/health y la invariante que
// ya causó un incidente: los `.down.sql` nunca se aplican en un arranque.
const {
  obtenerEstadoMigraciones,
  esMigracionAplicable,
} = require('../config/migrationRunner');

describe('estado de migraciones', () => {
  test('expone los contadores y la marca de tiempo', () => {
    const e = obtenerEstadoMigraciones();
    expect(e).toEqual(
      expect.objectContaining({
        aplicadas: expect.any(Number),
        omitidas: expect.any(Number),
        fallidas: expect.any(Number),
        archivos_fallidos: expect.any(Array),
      }),
    );
    expect(Object.keys(e)).toEqual(
      expect.arrayContaining(['ejecutada_en', 'aplicadas', 'omitidas', 'fallidas', 'archivos_fallidos']),
    );
  });

  test('devuelve una copia: mutar el resultado no altera el estado real', () => {
    const a = obtenerEstadoMigraciones();
    a.archivos_fallidos.push('inventada.sql');
    a.fallidas = 99;
    const b = obtenerEstadoMigraciones();
    expect(b.archivos_fallidos).not.toContain('inventada.sql');
    expect(b.fallidas).not.toBe(99);
  });

  test('los rollbacks .down.sql nunca son aplicables en un arranque', () => {
    expect(esMigracionAplicable('035_algo.sql')).toBe(true);
    expect(esMigracionAplicable('035_algo.down.sql')).toBe(false);
    expect(esMigracionAplicable('notas.txt')).toBe(false);
  });
});
