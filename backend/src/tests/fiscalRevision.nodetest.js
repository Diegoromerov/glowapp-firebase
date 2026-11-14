'use strict';

/**
 * Reglas de revisión del RUT del prestador (D-GL-030, fase 1).
 *
 * Se prueban las funciones puras de `fiscalRevision`: si la regla de publicación
 * o las transiciones se equivocan, el prestador publica sin soporte (o queda
 * bloqueado para siempre), y eso no se puede descubrir en producción.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  ESTADOS,
  ACCIONES,
  validarSoporte,
  evaluarPublicacion,
  transicionar,
  responsabilidadDesdeCodigo,
} = require(path.join(__dirname, '..', 'services', 'fiscalRevision'));

const SOPORTE_VALIDO = {
  url: 'https://storage.example.com/rut/123.pdf',
  hash: 'a'.repeat(64),
  mime: 'application/pdf',
  bytes: 245760,
};

test('un soporte PDF con hash válido se acepta', () => {
  assert.deepEqual(validarSoporte(SOPORTE_VALIDO), { valido: true });
});

test('una imagen del RUT también se acepta', () => {
  assert.equal(validarSoporte({ ...SOPORTE_VALIDO, mime: 'image/jpeg' }).valido, true);
});

test('el hash en mayúsculas se acepta', () => {
  assert.equal(validarSoporte({ ...SOPORTE_VALIDO, hash: 'A'.repeat(64) }).valido, true);
});

test('un http sin TLS se rechaza', () => {
  const r = validarSoporte({ ...SOPORTE_VALIDO, url: 'http://storage.example.com/rut/123.pdf' });
  assert.equal(r.valido, false);
});

test('sin hash no hay prueba del documento', () => {
  assert.equal(validarSoporte({ ...SOPORTE_VALIDO, hash: '' }).valido, false);
  assert.equal(validarSoporte({ ...SOPORTE_VALIDO, hash: 'abc' }).valido, false);
});

test('un formato que no es RUT legible se rechaza', () => {
  assert.equal(validarSoporte({ ...SOPORTE_VALIDO, mime: 'application/zip' }).valido, false);
});

test('el tamaño debe estar entre 1 byte y 10 MB', () => {
  assert.equal(validarSoporte({ ...SOPORTE_VALIDO, bytes: 0 }).valido, false);
  assert.equal(validarSoporte({ ...SOPORTE_VALIDO, bytes: 10 * 1024 * 1024 + 1 }).valido, false);
  assert.equal(validarSoporte({ ...SOPORTE_VALIDO, bytes: 10 * 1024 * 1024 }).valido, true);
});

test('sin RUT cargado no se publica', () => {
  const r = evaluarPublicacion({ rutNumero: null, revisionEstado: ESTADOS.SIN_ENVIAR });
  assert.equal(r.puedePublicar, false);
  assert.equal(r.motivo, 'SIN_RUT');
});

test('con el RUT en revisión no se publica', () => {
  const r = evaluarPublicacion({ rutNumero: '1020304050', revisionEstado: ESTADOS.PENDIENTE });
  assert.equal(r.puedePublicar, false);
  assert.equal(r.motivo, 'EN_REVISION');
});

test('con el RUT rechazado no se publica', () => {
  const r = evaluarPublicacion({ rutNumero: '1020304050', revisionEstado: ESTADOS.RECHAZADA });
  assert.equal(r.puedePublicar, false);
  assert.equal(r.motivo, 'RECHAZADA');
});

test('sólo con el RUT aprobado se publica', () => {
  const r = evaluarPublicacion({ rutNumero: '1020304050', revisionEstado: ESTADOS.APROBADA });
  assert.equal(r.puedePublicar, true);
  assert.equal(r.motivo, 'APROBADA');
});

test('un estado desconocido no habilita la publicación', () => {
  const r = evaluarPublicacion({ rutNumero: '1020304050', revisionEstado: 'CUALQUIERA' });
  assert.equal(r.puedePublicar, false);
});

test('enviar el RUT lo deja en la cola de revisión', () => {
  const r = transicionar({ actual: ESTADOS.SIN_ENVIAR, accion: ACCIONES.ENVIAR });
  assert.equal(r.valido, true);
  assert.equal(r.estado, ESTADOS.PENDIENTE);
  assert.equal(r.limpiarNota, true);
});

test('tras un rechazo el prestador puede reenviar', () => {
  const r = transicionar({ actual: ESTADOS.RECHAZADA, accion: ACCIONES.ENVIAR });
  assert.equal(r.valido, true);
  assert.equal(r.estado, ESTADOS.PENDIENTE);
});

test('no se reenvía un RUT que ya está en revisión ni uno aprobado', () => {
  assert.equal(transicionar({ actual: ESTADOS.PENDIENTE, accion: ACCIONES.ENVIAR }).valido, false);
  assert.equal(transicionar({ actual: ESTADOS.APROBADA, accion: ACCIONES.ENVIAR }).valido, false);
});

test('el equipo aprueba lo que está pendiente', () => {
  const r = transicionar({ actual: ESTADOS.PENDIENTE, accion: ACCIONES.APROBAR });
  assert.equal(r.valido, true);
  assert.equal(r.estado, ESTADOS.APROBADA);
});

test('no se aprueba lo que nadie envió', () => {
  assert.equal(transicionar({ actual: ESTADOS.SIN_ENVIAR, accion: ACCIONES.APROBAR }).valido, false);
  assert.equal(transicionar({ actual: ESTADOS.APROBADA, accion: ACCIONES.APROBAR }).valido, false);
});

test('rechazar exige motivo para el prestador', () => {
  const sinMotivo = transicionar({ actual: ESTADOS.PENDIENTE, accion: ACCIONES.RECHAZAR });
  assert.equal(sinMotivo.valido, false);

  const soloEspacios = transicionar({
    actual: ESTADOS.PENDIENTE,
    accion: ACCIONES.RECHAZAR,
    nota: '   ',
  });
  assert.equal(soloEspacios.valido, false);

  const conMotivo = transicionar({
    actual: ESTADOS.PENDIENTE,
    accion: ACCIONES.RECHAZAR,
    nota: 'El RUT está vencido.',
  });
  assert.equal(conMotivo.valido, true);
  assert.equal(conMotivo.estado, ESTADOS.RECHAZADA);
  assert.equal(conMotivo.nota, 'El RUT está vencido.');
});

test('una acción desconocida no cambia el estado', () => {
  assert.equal(transicionar({ actual: ESTADOS.PENDIENTE, accion: 'BORRAR' }).valido, false);
});

test('el código 48 marca responsable de IVA y el 49 no', () => {
  assert.equal(responsabilidadDesdeCodigo(48), true);
  assert.equal(responsabilidadDesdeCodigo('48'), true);
  assert.equal(responsabilidadDesdeCodigo(49), false);
  assert.equal(responsabilidadDesdeCodigo('49'), false);
});

test('un código distinto de 48/49 no inventa responsabilidad', () => {
  assert.equal(responsabilidadDesdeCodigo(42), null);
  assert.equal(responsabilidadDesdeCodigo(null), null);
  assert.equal(responsabilidadDesdeCodigo(undefined), null);
});
