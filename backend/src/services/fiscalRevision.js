'use strict';

/**
 * Revisión del RUT del prestador (D-GL-030, fase 1).
 *
 * El IVA del servicio no lo elige el prestador: se deriva de su RUT (código 48 =
 * responsable, 49 = no responsable; art. 437 par. 3 y 4 del E.T.). Como la DIAN
 * no ofrece una consulta automatizable (MUISCA exige captcha), la verificación es
 * humana: el prestador sube el documento y el equipo lo aprueba o rechaza.
 *
 * Este módulo es lógica pura: no toca la base ni HTTP. Las transiciones y la
 * regla de publicación se prueban sin infraestructura, y las rutas sólo aplican
 * lo que aquí se decide.
 */

const ESTADOS = Object.freeze({
  SIN_ENVIAR: 'SIN_ENVIAR',
  PENDIENTE: 'PENDIENTE',
  APROBADA: 'APROBADA',
  RECHAZADA: 'RECHAZADA',
});

const ACCIONES = Object.freeze({
  ENVIAR: 'ENVIAR',
  APROBAR: 'APROBAR',
  RECHAZAR: 'RECHAZAR',
});

const MIMES_PERMITIDOS = Object.freeze(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB: un RUT escaneado no pasa de ahí.
const HASH_SHA256 = /^[a-f0-9]{64}$/;

/** Códigos del RUT que deciden la responsabilidad de IVA. */
const CODIGO_RESPONSABLE_IVA = 48;
const CODIGO_NO_RESPONSABLE_IVA = 49;

/**
 * Valida el soporte documental antes de aceptarlo.
 * Un RUT sin hash no sirve como prueba: no se podría demostrar que el archivo
 * revisado es el que quedó guardado.
 */
function validarSoporte({ url, hash, mime, bytes } = {}) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url.trim())) {
    return { valido: false, motivo: 'La URL del RUT debe ser https.' };
  }
  if (typeof hash !== 'string' || !HASH_SHA256.test(hash.trim().toLowerCase())) {
    return { valido: false, motivo: 'Falta el hash SHA-256 del RUT (64 caracteres hexadecimales).' };
  }
  if (!MIMES_PERMITIDOS.includes(String(mime || '').toLowerCase())) {
    return { valido: false, motivo: 'El RUT debe ser PDF, JPG o PNG.' };
  }
  const tamano = Number(bytes);
  if (!Number.isInteger(tamano) || tamano <= 0 || tamano > MAX_BYTES) {
    return { valido: false, motivo: 'El RUT debe pesar entre 1 byte y 10 MB.' };
  }
  return { valido: true };
}

/**
 * ¿Puede el prestador publicar servicios?
 *
 * Sin RUT aprobado no se publica: publicar con IVA "por si acaso" encarece 19% a
 * quien no es responsable, y publicar sin IVA deja al prestador debiendo el
 * impuesto. El bloqueo es la única salida que no inventa un hecho fiscal.
 */
function evaluarPublicacion({ rutNumero, revisionEstado } = {}) {
  const numero = rutNumero === null || rutNumero === undefined ? '' : String(rutNumero).trim();
  if (numero === '') {
    return {
      puedePublicar: false,
      motivo: 'SIN_RUT',
      detalle: 'Carga tu RUT para publicar servicios.',
    };
  }

  switch (revisionEstado) {
    case ESTADOS.APROBADA:
      return { puedePublicar: true, motivo: 'APROBADA', detalle: 'RUT verificado.' };
    case ESTADOS.PENDIENTE:
      return {
        puedePublicar: false,
        motivo: 'EN_REVISION',
        detalle: 'Tu RUT está en revisión. Te avisamos cuando quede aprobado.',
      };
    case ESTADOS.RECHAZADA:
      return {
        puedePublicar: false,
        motivo: 'RECHAZADA',
        detalle: 'El RUT fue rechazado. Corrige el documento y vuelve a enviarlo.',
      };
    default:
      return {
        puedePublicar: false,
        motivo: 'SIN_ENVIAR',
        detalle: 'Aún no has enviado tu RUT.',
      };
  }
}

/**
 * Transiciones válidas del documento.
 *
 * APROBAR/RECHAZAR sólo salen de PENDIENTE: revisar algo que no está en la cola
 * significaría aprobar un archivo que nadie subió. ENVIAR se admite desde
 * SIN_ENVIAR y desde RECHAZADA (reenvío tras corregir).
 */
function transicionar({ actual, accion, nota } = {}) {
  const desde = ESTADOS[actual] ? actual : ESTADOS.SIN_ENVIAR;
  const hasta = ACCIONES[accion] ? accion : null;

  if (hasta === null) {
    return { valido: false, motivo: 'Accion desconocida.' };
  }

  if (hasta === ACCIONES.ENVIAR) {
    if (desde === ESTADOS.SIN_ENVIAR || desde === ESTADOS.RECHAZADA) {
      return { valido: true, estado: ESTADOS.PENDIENTE, limpiarNota: true };
    }
    return { valido: false, motivo: `No se puede enviar desde ${desde}.` };
  }

  if (desde !== ESTADOS.PENDIENTE) {
    return { valido: false, motivo: `No hay nada que revisar en estado ${desde}.` };
  }

  if (hasta === ACCIONES.APROBAR) {
    return { valido: true, estado: ESTADOS.APROBADA };
  }

  // Rechazar sin motivo deja al prestador sin saber qué corregir.
  const limpia = typeof nota === 'string' ? nota.trim() : '';
  if (limpia === '') {
    return { valido: false, motivo: 'El rechazo exige un motivo para el prestador.' };
  }
  return { valido: true, estado: ESTADOS.RECHAZADA, nota: limpia };
}

/**
 * Responsabilidad de IVA que se aplica al aprobar el documento.
 * 48 → responsable; 49 → no responsable; cualquier otro código → null (no se
 * inventa un valor: la migración 087 sólo admite 48 y 49).
 */
function responsabilidadDesdeCodigo(codigo) {
  const numero = Number(codigo);
  if (numero === CODIGO_RESPONSABLE_IVA) return true;
  if (numero === CODIGO_NO_RESPONSABLE_IVA) return false;
  return null;
}

module.exports = {
  ESTADOS,
  ACCIONES,
  MIMES_PERMITIDOS,
  MAX_BYTES,
  CODIGO_RESPONSABLE_IVA,
  CODIGO_NO_RESPONSABLE_IVA,
  validarSoporte,
  evaluarPublicacion,
  transicionar,
  responsabilidadDesdeCodigo,
};
