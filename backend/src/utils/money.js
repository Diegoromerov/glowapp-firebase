'use strict';
// backend/src/utils/money.js
// FASE C · t_fix_backend_04 — Aritmética monetaria en CENTAVOS ENTEROS.
//
// Regla dura: el dinero NUNCA se suma, resta ni acumula en float.
// Se convierte a centavos (enteros), se opera en enteros y se redondea UNA sola vez
// al centavo. Sin esto, `100.10 - (4.00 + 0.41 + 0.90)` da 94.78999999999999.
//
// La moneda del negocio es COP con 2 decimales → 1 unidad = 100 centavos.
// Los montos que llegan de PostgreSQL (`numeric`) se reciben como string y se
// convierten por parseo decimal exacto (no `Number(x) * 100`), evitando la deriva binaria.

const CENTAVOS_POR_UNIDAD = 100;

function esEntero(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

function assertEntero(valor, etiqueta) {
  if (!esEntero(valor)) {
    throw new TypeError(`${etiqueta} debe ser un entero de centavos; recibido: ${JSON.stringify(valor)}`);
  }
}

/**
 * Convierte un monto en unidades (pesos) a centavos enteros, con redondeo half-up
 * al tercer decimal. Acepta string (formato de columna `numeric` en pg) o number.
 */
function toCents(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;

  if (typeof valor === 'number' && !Number.isFinite(valor)) {
    throw new TypeError(`Monto no finito: ${valor}`);
  }

  const texto = typeof valor === 'string' ? valor.trim() : String(valor);

  // Parseo decimal exacto: evita heredar el error binario del float.
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(texto);
  if (m) {
    const signo = m[1] === '-' ? -1 : 1;
    const entero = parseInt(m[2], 10);
    const decimales = (m[3] || '').padEnd(3, '0');
    const centavos = Number(decimales.slice(0, 2)) + (Number(decimales[2]) >= 5 ? 1 : 0);
    return signo * (entero * CENTAVOS_POR_UNIDAD + centavos);
  }

  // Notación exponencial u otros formatos numéricos: conversión controlada.
  const numero = Number(texto);
  if (!Number.isFinite(numero)) {
    throw new TypeError(`Monto no numérico: ${JSON.stringify(valor)}`);
  }
  return Math.round(numero * CENTAVOS_POR_UNIDAD);
}

/**
 * Inverso de toCents: centavos enteros → unidades (pesos).
 * El valor devuelto es apto para columnas `numeric` (2 decimales).
 */
function fromCents(centavos) {
  assertEntero(centavos, 'fromCents(centavos)');
  return centavos / CENTAVOS_POR_UNIDAD;
}

/**
 * Suma una lista de montos YA expresados en centavos enteros.
 */
function sumarCents(...listaCentavos) {
  let total = 0;
  for (const c of listaCentavos) {
    assertEntero(c, 'sumarCents(…centavos)');
    total += c;
  }
  return total;
}

/**
 * Porcentaje de un monto en centavos → centavos enteros (redondeo half-up).
 * `porcentaje` es un punto porcentual tal como se guarda en platform_config
 * (p. ej. 4.0, 0.414, 15.0).
 */
function pctOf(centavos, porcentaje) {
  assertEntero(centavos, 'pctOf(centavos, …)');
  const pct = Number(porcentaje);
  if (!Number.isFinite(pct)) {
    throw new TypeError(`Porcentaje no numérico: ${JSON.stringify(porcentaje)}`);
  }
  return Math.round((centavos * pct) / 100);
}

/**
 * Liquidación de un servicio: retenciones colombianas y neto del prestador,
 * TODO en centavos enteros. La suma del total no puede derivar.
 *
 * @param {object} p
 * @param {number} p.basePagoNetoCents         pago_neto_prestador en centavos
 * @param {number} p.comisionPlataformaCents   comision_plataforma en centavos
 * @param {number|string} p.retefuentePct      %
 * @param {number|string} p.reteicaPct         %
 * @param {number|string} p.reteivaPct         %
 */
function calcularRetenciones({
  basePagoNetoCents,
  comisionPlataformaCents,
  retefuentePct,
  reteicaPct,
  reteivaPct
}) {
  assertEntero(basePagoNetoCents, 'basePagoNetoCents');
  assertEntero(comisionPlataformaCents, 'comisionPlataformaCents');

  const retencionFuenteCents = pctOf(basePagoNetoCents, retefuentePct);
  const retencionIcaCents = pctOf(basePagoNetoCents, reteicaPct);
  const retencionIvaCents = pctOf(comisionPlataformaCents, reteivaPct);

  const totalRetencionesCents = sumarCents(
    retencionFuenteCents,
    retencionIcaCents,
    retencionIvaCents
  );
  const montoNetoCents = basePagoNetoCents - totalRetencionesCents;

  return {
    retencionFuenteCents,
    retencionIcaCents,
    retencionIvaCents,
    totalRetencionesCents,
    montoNetoCents
  };
}

// ---------------------------------------------------------------------------
// N-16 — UNIÓN DE DOS money.js INDEPENDIENTES (resuelto en la integración Fase D).
//
// t_fix_backend_04 y t_fix_pagos_06 corrigieron el MISMO P0 (montos en float) creando
// cada uno su propio `src/utils/money.js` con nombres distintos. Son semánticamente
// equivalentes (misma fórmula, mismo redondeo half-up). Se conserva la implementación de
// backend_04 como canónica (parseo decimal exacto para columnas `numeric` de pg) y se
// exponen los nombres de pagos_06 como envoltorios, preservando su contrato LAXO
// (coerciona y devuelve 0 ante valor no finito, en vez de lanzar TypeError).
// Así ambos sitios de llamada y ambas suites de test siguen funcionando sin tocarlos.
// ---------------------------------------------------------------------------

/** Alias laxo de `toCents`: nunca lanza, devuelve 0 si el valor no es convertible. */
function aCentavos(valor) {
  try {
    return toCents(valor);
  } catch (_) {
    return 0;
  }
}

/** Alias laxo de `fromCents`: nunca lanza. */
function aDecimal(centavos) {
  const c = Number(centavos);
  return Number.isFinite(c) ? Math.round(c) / CENTAVOS_POR_UNIDAD : 0;
}

/** Alias laxo de `pctOf`, con el nombre de pagos_06. */
function porcentajeCentavos(centavos, pct) {
  const c = Math.round(Number(centavos) || 0);
  const p = Number(pct);
  if (!Number.isFinite(p)) return 0;
  return Math.round((c * p) / 100);
}

/**
 * Adaptador de `calcularRetenciones` a la firma y los nombres de retorno de pagos_06.
 * fuente/ica se aplican sobre el pago neto base; iva sobre la comisión de plataforma.
 */
function aplicarRetencionesCentavos({ baseCentavos, comisionCentavos, pctFuente, pctIca, pctIva }) {
  const r = calcularRetenciones({
    basePagoNetoCents: Math.round(Number(baseCentavos) || 0),
    comisionPlataformaCents: Math.round(Number(comisionCentavos) || 0),
    retefuentePct: pctFuente,
    reteicaPct: pctIca,
    reteivaPct: pctIva
  });
  return {
    fuenteCentavos: r.retencionFuenteCents,
    icaCentavos: r.retencionIcaCents,
    ivaCentavos: r.retencionIvaCents,
    totalCentavos: r.totalRetencionesCents,
    netoCentavos: r.montoNetoCents
  };
}

/** Suma montos decimales sin deriva de float (vía centavos enteros). */
function sumarMontos(...montos) {
  return aDecimal(montos.reduce((acc, x) => acc + aCentavos(x), 0));
}

module.exports = {
  CENTAVOS_POR_UNIDAD,
  toCents,
  fromCents,
  sumarCents,
  pctOf,
  calcularRetenciones,
  // Nombres de pagos_06 (alias)
  aCentavos,
  aDecimal,
  porcentajeCentavos,
  aplicarRetencionesCentavos,
  sumarMontos
};
