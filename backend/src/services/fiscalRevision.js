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
// La app del prestador guarda los documentos como data URI (no hay bucket
// propio para adjuntos de perfil), así que el soporte puede llegar en línea.
const DATA_URI = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

/** Códigos del RUT que deciden la responsabilidad de IVA. */
const CODIGO_RESPONSABLE_IVA = 48;
const CODIGO_NO_RESPONSABLE_IVA = 49;

/**
 * Clasifica el soporte sin validarlo: `DATA_URI` cuando viene embebido,
 * `HTTPS` cuando es una URL, `INVALIDO` en cualquier otro caso.
 */
function analizarSoporte(url) {
  if (typeof url !== 'string' || url.trim() === '') {
    return { tipo: 'INVALIDO' };
  }
  const valor = url.trim();
  const data = valor.match(DATA_URI);
  if (data) {
    const base64 = data[2].replace(/\s/g, '');
    return {
      tipo: 'DATA_URI',
      mime: data[1].toLowerCase(),
      base64,
      // 4 caracteres base64 = 3 bytes; se redondea hacia abajo por el padding.
      bytes: Math.floor((base64.length * 3) / 4),
    };
  }
  if (/^https:\/\//i.test(valor)) return { tipo: 'HTTPS' };
  return { tipo: 'INVALIDO' };
}

/**
 * Valida el soporte documental antes de aceptarlo.
 *
 * Con data URI el servidor calcula el hash él mismo (ver `hashSoporte`): un hash
 * que manda el cliente no prueba nada. Con una URL https sí se exige el hash,
 * porque el archivo vive fuera y hay que poder demostrar cuál se revisó.
 */
function validarSoporte({ url, hash, mime, bytes } = {}) {
  const analisis = analizarSoporte(url);

  if (analisis.tipo === 'INVALIDO') {
    return { valido: false, motivo: 'El soporte debe ser una URL https o un archivo embebido.' };
  }

  if (analisis.tipo === 'DATA_URI') {
    if (!MIMES_PERMITIDOS.includes(analisis.mime)) {
      return { valido: false, motivo: 'El RUT debe ser PDF, JPG o PNG.' };
    }
    if (analisis.bytes <= 0 || analisis.bytes > MAX_BYTES) {
      return { valido: false, motivo: 'El RUT debe pesar entre 1 byte y 10 MB.' };
    }
    return { valido: true, tipo: 'DATA_URI' };
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
  return { valido: true, tipo: 'HTTPS' };
}

/**
 * Datos normalizados del soporte para guardar: URL (o data URI), hash, mime y
 * tamaño. El hash de un data URI se calcula aquí, nunca se toma del cliente.
 */
function normalizarSoporte({ url, hash, mime, bytes } = {}) {
  const analisis = analizarSoporte(url);
  if (analisis.tipo === 'DATA_URI') {
    return {
      url: String(url).trim(),
      hash: hashSoporte(analisis.base64),
      mime: analisis.mime,
      bytes: analisis.bytes,
    };
  }
  return {
    url: String(url || '').trim(),
    hash: String(hash || '').trim().toLowerCase(),
    mime: String(mime || '').toLowerCase(),
    bytes: Number(bytes),
  };
}

/** SHA-256 del contenido del archivo embebido. */
function hashSoporte(base64) {
  // eslint-disable-next-line global-require
  const crypto = require('crypto');
  const limpio = String(base64 || '').replace(/\s/g, '');
  return crypto.createHash('sha256').update(Buffer.from(limpio, 'base64')).digest('hex');
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
  analizarSoporte,
  normalizarSoporte,
  hashSoporte,
  evaluarPublicacion,
  transicionar,
  responsabilidadDesdeCodigo,
};
