'use strict';

/**
 * Responsabilidad de IVA del prestador, derivada de su RUT.
 *
 * Base legal: el artículo 476 num. 1 lit. a) del Estatuto Tributario dice que los
 * tratamientos de belleza están GRAVADOS, pero eso no decide quién cobra el
 * impuesto. Quién es responsable lo determina el artículo 437, parágrafo 3, del
 * E.T. (por ingresos), y consta en el RUT del prestador.
 *
 * Decisiones de producto (Diego, 2026-10-10):
 *   D1 — el valor se DERIVA del código del RUT; un override manual manda y queda
 *        auditado.
 *   D2 — el número de RUT es obligatorio para declarar.
 *   D3 — sin declaración no se presume responsable.
 *
 * Extensión (2026-10-13): validación automática contra DIAN (MUISCA).
 *   La declaración del prestador se verifica contra el RUT real en la DIAN.
 *   Si hay discrepancia, gana la DIAN y se registra en auditoría.
 */

const dianClient = require('./dianClient');

const CODIGO_RESPONSABLE_IVA = 48;
const CODIGO_NO_RESPONSABLE_IVA = 49;
const CODIGOS_VALIDOS = [CODIGO_RESPONSABLE_IVA, CODIGO_NO_RESPONSABLE_IVA];

const FUENTE_RUT = 'RUT';
const FUENTE_MANUAL = 'MANUAL';
const FUENTE_DIAN = 'DIAN';

/**
 * Quita puntos y espacios del RUT. `null` si no hay nada que normalizar.
 */
function normalizarRut(numero) {
  if (numero === null || numero === undefined) return null;
  const limpio = String(numero).trim().replace(/[.\s]/g, '');
  return limpio === '' ? null : limpio;
}

/**
 * D2: el número de RUT es obligatorio.
 *
 * Formato admitido: cédula (8-10 dígitos) o NIT (9 dígitos más el dígito de
 * verificación, que se admite tras un guion). No se valida el dígito de
 * verificación: eso requiere consultar el RUT, que es otro paso.
 */
function validarRut(numero) {
  const rut = normalizarRut(numero);

  if (rut === null) {
    return {
      valido: false,
      motivo: 'El número de RUT es obligatorio para declarar la responsabilidad de IVA.',
    };
  }

  if (!/^\d{8,12}(-\d)?$/.test(rut)) {
    return {
      valido: false,
      motivo:
        'El número de RUT debe tener entre 8 y 12 dígitos (se admite el guion antes del dígito de verificación).',
    };
  }

  return { valido: true, rut };
}

/**
 * Valida la casilla de responsabilidades del RUT.
 */
function validarCodigoResponsabilidad(codigo) {
  const numero = Number(codigo);

  if (!Number.isInteger(numero) || !CODIGOS_VALIDOS.includes(numero)) {
    return {
      valido: false,
      motivo: `El código de responsabilidad debe ser ${CODIGO_RESPONSABLE_IVA} (responsable de IVA) o ${CODIGO_NO_RESPONSABLE_IVA} (no responsable).`,
    };
  }

  return { valido: true, codigo: numero };
}

/**
 * D1: el valor vigente se DERIVA del código del RUT; el override manda sobre él.
 *
 * @returns {{responsableIva: boolean|null, fuente: string|null}}
 *   `responsableIva: null` con `fuente: null` significa **sin declarar**, y es la
 *   entrada que activa D3 (no se presume responsable).
 */
function resolverResponsabilidadIva({ codigo, override } = {}) {
  if (override === true || override === false) {
    return { responsableIva: override, fuente: FUENTE_MANUAL };
  }

  if (Number(codigo) === CODIGO_RESPONSABLE_IVA) {
    return { responsableIva: true, fuente: FUENTE_RUT };
  }

  if (Number(codigo) === CODIGO_NO_RESPONSABLE_IVA) {
    return { responsableIva: false, fuente: FUENTE_RUT };
  }

  return { responsableIva: null, fuente: null };
}

/**
 * Valida la responsabilidad de IVA contra la DIAN (MUISCA).
 * Esta función debe llamarse cuando el prestador declara su RUT y código,
 * o en un job periódico de reconciliación.
 *
 * @param {string} rutNumero - Número de RUT normalizado
 * @returns {Promise<{valido: boolean, responsableIva: boolean|null, codigoDian: number|null, fuente: string, discrepancia: boolean, detalles: object}>}
 */
async function validarContraDian(rutNumero) {
  if (!rutNumero) {
    return {
      valido: false,
      responsableIva: null,
      codigoDian: null,
      fuente: null,
      discrepancia: false,
      detalles: { motivo: 'RUT no proporcionado' }
    };
  }

  try {
    const resultado = await dianClient.verificarResponsabilidadIva(rutNumero);

    return {
      valido: true,
      responsableIva: resultado.tieneResponsabilidadIva,
      codigoDian: resultado.codigoEncontrado,
      fuente: FUENTE_DIAN,
      discrepancia: false, // se evalúa en el llamador comparando con lo declarado
      detalles: resultado.detalles
    };
  } catch (error) {
    // Si falla la DIAN (timeout, error 5xx, CAPTCHA), no bloqueamos:
    // se registra el error y se deja la responsabilidad como declarada
    console.warn(`⚠️ [IVA DIAN] No se pudo validar RUT ${rutNumero} contra DIAN: ${error.message}`);
    return {
      valido: false,
      responsableIva: null,
      codigoDian: null,
      fuente: null,
      discrepancia: false,
      detalles: { error: error.message, rut: rutNumero }
    };
  }
}

/**
 * Reconcilia la responsabilidad declarada con la DIAN.
 * Se usa en el endpoint PATCH /api/provider/fiscal (cuando el prestador declara)
 * y en jobs de conciliación.
 *
 * @param {object} params
 * @param {string} params.rutNumero - RUT normalizado
 * @param {number|null} params.codigoDeclarado - Código declarado por el prestador (48/49)
 * @param {boolean|null} params.override - Override manual de admin
 * @returns {Promise<{responsableIva: boolean, fuente: string, codigoOficial: number|null, auditoria: object}>}
 */
async function reconciliarConDian({ rutNumero, codigoDeclarado, override }) {
  // Si hay override manual, manda (D1) — pero registramos la discrepancia con DIAN
  if (override === true || override === false) {
    const dian = await validarContraDian(rutNumero);
    return {
      responsableIva: override,
      fuente: FUENTE_MANUAL,
      codigoOficial: dian.codigoDian,
      auditoria: {
        override: true,
        dianValido: dian.valido,
        dianResponsableIva: dian.responsableIva,
        dianCodigo: dian.codigoDian,
        discrepancia: dian.valido && dian.responsableIva !== override
      }
    };
  }

  // Sin override: validar contra DIAN
  const dian = await validarContraDian(rutNumero);

  if (!dian.valido) {
    // DIAN no disponible: caer a lo declarado (comportamiento actual)
    const derivado = resolverResponsabilidadIva({ codigo: codigoDeclarado });
    return {
      responsableIva: derivado.responsableIva,
      fuente: FUENTE_RUT,
      codigoOficial: codigoDeclarado,
      auditoria: {
        dianDisponible: false,
        codigoDeclarado,
        motivoFalloDian: dian.detalles?.error
      }
    };
  }

  // DIAN respondió: gana la DIAN
  return {
    responsableIva: dian.responsableIva,
    fuente: FUENTE_DIAN,
    codigoOficial: dian.codigoDian,
    auditoria: {
      dianValido: true,
      codigoDeclarado,
      dianResponsableIva: dian.responsableIva,
      dianCodigo: dian.codigoDian,
      discrepancia: codigoDeclarado !== null && dian.codigoDian !== codigoDeclarado
    }
  };
}

module.exports = {
  CODIGO_RESPONSABLE_IVA,
  CODIGO_NO_RESPONSABLE_IVA,
  CODIGOS_VALIDOS,
  FUENTE_RUT,
  FUENTE_MANUAL,
  FUENTE_DIAN,
  normalizarRut,
  validarRut,
  validarCodigoResponsabilidad,
  resolverResponsabilidadIva,
  validarContraDian,
  reconciliarConDian
};
