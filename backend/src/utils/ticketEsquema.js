'use strict';

/**
 * backend/src/utils/ticketEsquema.js
 *
 * Los valores válidos de `tickets.estado`, `tickets.prioridad`, `tickets.tipo` y
 * `tickets.categoria` se LEEN de la restricción CHECK real de la base; no se copian en
 * una lista del controlador.
 *
 * POR QUÉ, con el caso que lo originó: el botón "Atender" de SOS no estaba roto — el
 * controlador escribía 'ATENDIDO' y el CHECK de `sos_alerts` solo admitía
 * ('ACTIVO','RESUELTO'), así que Postgres abortaba y al usuario le parecía un botón
 * muerto. Una lista duplicada en el código se desincroniza en cuanto una migración
 * añade un valor: la 045 añadió 'ARCO_SUPRESION' a `tickets.tipo` sin que el código se
 * enterara.
 *
 * SI NO SE PUEDE LEER, DEVUELVE null Y NO VALIDA: decide la base, y su violación se
 * traduce a 400 en el controlador. Fallar hacia "lo decide el esquema" es preferible a
 * fallar hacia una lista inventada.
 */

const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // 'tabla.columna' -> { valores: string[]|null, leidoEn: number }

/**
 * Extrae los literales de cadena de la definición de un CHECK de Postgres.
 *
 * Postgres reescribe `estado IN ('ABIERTO','EN_PROCESO')` como
 * `CHECK (((estado)::text = ANY ((ARRAY['ABIERTO'::character varying, ...])::text[])))`,
 * y la forma exacta del árbol cambia entre versiones. Por eso se leen los LITERALES y
 * no se parsea la estructura: los `::text` / `::character varying` no van entrecomillados,
 * así que no se cuelan.
 */
function valoresDeDefinicion(definicion) {
  if (typeof definicion !== 'string') return [];
  const valores = [];
  const re = /'((?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(definicion)) !== null) {
    const valor = m[1].replace(/''/g, "'");
    if (valor !== '' && !valores.includes(valor)) valores.push(valor);
  }
  return valores;
}

/** ¿Estas definiciones de CHECK hablan de NUESTRA columna? */
function definicionesDeColumna(definiciones, columna) {
  // Preferencia por la forma exacta `(columna)::`, que es la que produce un CHECK de
  // columna. El respaldo por nombre suelto solo se usa si no hay ninguna: algunas
  // restricciones antiguas no llevan el cast.
  const precisas = definiciones.filter((d) => new RegExp(`\\(${columna}\\)::`).test(d));
  if (precisas.length) return precisas;
  return definiciones.filter((d) => new RegExp(`\\b${columna}\\b`).test(d));
}

/**
 * Valores válidos de `tabla.columna`, o null si no se pueden derivar (y entonces la
 * validación es cosa de la base).
 */
async function valoresValidos(tabla, columna) {
  const clave = `${tabla}.${columna}`;
  const cacheado = cache.get(clave);
  if (cacheado && Date.now() - cacheado.leidoEn < CACHE_MS) return cacheado.valores;

  let valores = null;
  try {
    const filas = await sequelize.query(
      `SELECT pg_get_constraintdef(c.oid) AS definicion
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = :tabla AND c.contype = 'c'`,
      { replacements: { tabla }, type: QueryTypes.SELECT }
    );
    const definiciones = (filas || []).map((f) => f.definicion).filter(Boolean);
    const candidatas = definicionesDeColumna(definiciones, columna);
    const unicos = [...new Set(candidatas.flatMap(valoresDeDefinicion))];
    valores = unicos.length ? unicos : null;
    if (!valores) {
      console.warn(`⚠️ Sin CHECK derivable para ${clave}: la base decidirá.`);
    }
  } catch (error) {
    console.error(`⚠️ No pude leer los CHECK de ${clave}: ${error.message}. La base decidirá.`);
    valores = null;
  }

  cache.set(clave, { valores, leidoEn: Date.now() });
  return valores;
}

/**
 * null si el valor es admisible, o el motivo del rechazo en castellano.
 * Si no se pudieron derivar los válidos, devuelve null: decide la base.
 */
async function motivoInvalido(tabla, columna, valor) {
  if (valor === undefined || valor === null) return `Falta ${columna}.`;
  const validos = await valoresValidos(tabla, columna);
  if (validos === null) return null;
  if (validos.includes(valor)) return null;
  return `'${valor}' no es un valor admisible de ${tabla}.${columna} (admite: ${validos.join(', ')})`;
}

/** Solo para pruebas: olvida lo cacheado. */
function limpiarCache() {
  cache.clear();
}

module.exports = {
  valoresValidos,
  motivoInvalido,
  valoresDeDefinicion,
  definicionesDeColumna,
  limpiarCache,
  CACHE_MS,
};
