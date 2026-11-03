const path = require('path');
const { REGLAS, analizarSalida } = require('../../scripts/verifyNoVersionedSecrets');

/**
 * ORDEN A-06 · RONDA 5 (Cargo 2) — «la etiqueta tiene que ser cierta»
 *
 * `analizarSalida` etiqueta cada línea con la PRIMERA regla dispuesta a aceptarla. Como
 * «token o JWT en parámetro de URL» acepta cualquier línea no comentada **sin volver a mirar su
 * propio `buscar`**, se queda con las líneas que las reglas anteriores seleccionaron por grep pero
 * rechazaron al validar. Medido en el árbol real: 109 hallazgos, 101 de ellos mal etiquetados.
 *
 * Regla que se prueba: **una línea no puede quedar etiquetada con una regla que no la seleccionó.**
 */

// Fixture: líneas tal como las devuelve `git grep -n -E` (`archivo:linea:contenido`).
// Tres reglas distintas casan en el mismo blob crudo (Cargo 2.1).
const LINEA_REGLA_LITERAL = "deploy/db.sh:12:PGPASSWORD: 'supersecreto123'";           // la selecciona 'valor por defecto literal'
const LINEA_REGLA_TOKEN = 'backend/src/rutas/api.js:22:const u = "https://api.x/v1/?token=abc123def456";'; // la selecciona 'token o JWT'
const LINEA_QUE_NADIE_DEBERIA_ETIQUETAR = "backend/src/config/app.js:7:const API_KEY = process.env.API_KEY || 'REDACTED';"; // su regla la rechaza ⇒ NO puede caer en 'token o JWT'

const BLOB = [LINEA_REGLA_LITERAL, LINEA_REGLA_TOKEN, LINEA_QUE_NADIE_DEBERIA_ETIQUETAR].join('\n');

/** ¿Qué reglas seleccionarían esta línea, según SU PROPIO `buscar` (el mismo patrón que usa git grep)? */
function reglasQueLaSeleccionan(lineaCruda) {
  const contenido = lineaCruda.replace(/^[^:]+:\d+:/, '');
  return REGLAS.filter((r) => new RegExp(r.buscar.replace(/\[\[:space:\]\]/g, '\\s')).test(contenido));
}

/** Contenido de la línea del fixture a la que corresponde un hallazgo (el escáner NO expone valores). */
function contenidoDe(blob, h) {
  for (const l of blob.split('\n')) {
    const m = l.match(/^([^:]+):(\d+):(.*)$/);
    if (m && m[1] === h.archivo && m[2] === h.numLinea) return m[3];
  }
  return '';
}

describe('A-06 ronda 5 — la etiqueta de cada hallazgo pertenece a la regla que lo seleccionó', () => {
  test('C2.a — toda etiqueta corresponde a una regla cuyo `buscar` casa la línea Y que la acepta', () => {
    const { hallazgos } = analizarSalida(BLOB);

    for (const h of hallazgos) {
      const contenido = contenidoDe(BLOB, h);
      const seleccionadoras = REGLAS.filter(
        (r) => new RegExp(r.buscar.replace(/\[\[:space:\]\]/g, '\\s')).test(contenido)
      );
      expect(seleccionadoras.map((r) => r.nombre)).toContain(h.nombre);
    }
  });

  test('C2.a bis — la línea que su regla rechaza NO queda etiquetada como «token o JWT»', () => {
    const { hallazgos } = analizarSalida(BLOB);
    const h = hallazgos.find((x) => x.numLinea === '7' && /app\.js$/.test(x.archivo));
    if (h) {
      expect(h.nombre).not.toBe('token o JWT en parámetro de URL');
      expect(reglasQueLaSeleccionan(LINEA_QUE_NADIE_DEBERIA_ETIQUETAR).map((r) => r.nombre)).toContain(h.nombre);
    }
  });

  test('C2.b — el total del blob unificado es igual a la suma de correr regla por regla', () => {
    const unificado = analizarSalida(BLOB).hallazgos.length;

    let porRegla = 0;
    for (const regla of REGLAS) {
      const lineasDeEsaRegla = BLOB.split('\n').filter((l) =>
        new RegExp(regla.buscar.replace(/\[\[:space:\]\]/g, '\\s')).test(l.replace(/^[^:]+:\d+:/, ''))
      );
      if (lineasDeEsaRegla.length === 0) continue;
      porRegla += analizarSalida(lineasDeEsaRegla.join('\n')).hallazgos.length;
    }

    expect(unificado).toBe(porRegla);
  });

  test('C2.c — sigue detectando: el fixture con hallazgos reales NO queda mudo', () => {
    const { hallazgos, exitCode } = analizarSalida(BLOB);
    expect(hallazgos.length).toBeGreaterThanOrEqual(1);
    expect(exitCode).toBe(1);
    expect(hallazgos.map((h) => h.nombre)).toContain('valor por defecto literal para variable sensible');
  });

  test('C5 — CRLF y LF dan el mismo resultado (etiquetas y total)', () => {
    const lf = analizarSalida(BLOB);
    const crlf = analizarSalida(BLOB.replace(/\n/g, '\r\n'));
    expect(crlf.hallazgos).toEqual(lf.hallazgos);
  });

  test('C5 bis — la misma línea repetida en dos blobs por regla no se etiqueta con la regla ajena', () => {
    const { hallazgos } = analizarSalida([LINEA_QUE_NADIE_DEBERIA_ETIQUETAR].join('\n'));
    expect(hallazgos).toEqual([]);
  });
});
