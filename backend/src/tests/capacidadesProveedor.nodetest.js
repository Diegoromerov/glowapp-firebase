'use strict';

/**
 * Capacidades del proveedor — Modo Exploración (D-GL-031).
 *
 * Estas reglas son la puerta del dinero: si un explorador cobra o un suspendido
 * sigue operando, el daño es real. Se prueban como contrato, no como detalle.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  ESTADOS,
  CAPACIDADES,
  calcularCapacidades,
  motivoBloqueo,
} = require(path.join(__dirname, '..', 'services', 'capacidadesProveedor'));

const explorador = () =>
  calcularCapacidades({ estadoOperativo: 'EXPLORACION', rol: 'PRESTADOR' });

test('un explorador ve el dashboard y prepara su negocio', () => {
  const c = explorador();
  assert.equal(c.puede(CAPACIDADES.VER_DASHBOARD), true);
  assert.equal(c.puede(CAPACIDADES.EDITAR_PERFIL), true);
  assert.equal(c.puede(CAPACIDADES.GESTIONAR_AGENDA), true);
  assert.equal(c.puede(CAPACIDADES.CREAR_SERVICIOS), true);
});

test('un explorador no cobra, no retira y no recibe reservas', () => {
  const c = explorador();
  assert.equal(c.puede(CAPACIDADES.RECIBIR_RESERVAS), false);
  assert.equal(c.puede(CAPACIDADES.COBRAR), false);
  assert.equal(c.puede(CAPACIDADES.RETIRAR), false);
  assert.equal(c.puede(CAPACIDADES.FACTURAR), false);
  assert.equal(c.puede(CAPACIDADES.PUBLICAR_SERVICIOS), false);
});

test('un explorador no compra, no escribe a clientes y no usa la API', () => {
  const c = explorador();
  assert.equal(c.puede(CAPACIDADES.COMPRAR), false);
  assert.equal(c.puede(CAPACIDADES.MENSAJERIA_CLIENTES), false);
  assert.equal(c.puede(CAPACIDADES.USAR_API), false);
});

test('en verificación se mantienen las mismas restricciones', () => {
  const c = calcularCapacidades({ estadoOperativo: 'EN_VERIFICACION', rol: 'PRESTADOR' });
  assert.equal(c.puede(CAPACIDADES.CREAR_SERVICIOS), true);
  assert.equal(c.puede(CAPACIDADES.COBRAR), false);
  assert.equal(c.puede(CAPACIDADES.RECIBIR_RESERVAS), false);
});

test('habilitado puede todo', () => {
  const c = calcularCapacidades({ estadoOperativo: 'HABILITADO', rol: 'PRESTADOR' });
  for (const capacidad of Object.values(CAPACIDADES)) {
    assert.equal(c.puede(capacidad), true, `debería poder ${capacidad}`);
  }
});

test('un salón sigue las mismas reglas que un prestador', () => {
  const c = calcularCapacidades({ estadoOperativo: 'EXPLORACION', rol: 'SALON' });
  assert.equal(c.puede(CAPACIDADES.CREAR_SERVICIOS), true);
  assert.equal(c.puede(CAPACIDADES.COBRAR), false);
});

test('suspendido sólo conserva la lectura del dashboard', () => {
  const c = calcularCapacidades({ estadoOperativo: 'SUSPENDIDO', rol: 'PRESTADOR' });
  assert.equal(c.puede(CAPACIDADES.VER_DASHBOARD), true);
  assert.equal(c.puede(CAPACIDADES.EDITAR_PERFIL), false);
  assert.equal(c.puede(CAPACIDADES.CREAR_SERVICIOS), false);
  assert.equal(c.puede(CAPACIDADES.COBRAR), false);
});

test('un rol que no es proveedor no recibe capacidades', () => {
  const c = calcularCapacidades({ estadoOperativo: 'HABILITADO', rol: 'CLIENTE' });
  assert.equal(c.puede(CAPACIDADES.COBRAR), false);
  assert.deepEqual(c.permitidas, []);
});

test('un estado desconocido cae en exploración, nunca en habilitado', () => {
  const c = calcularCapacidades({ estadoOperativo: 'INVENTADO', rol: 'PRESTADOR' });
  assert.equal(c.estado, ESTADOS.EXPLORACION);
  assert.equal(c.puede(CAPACIDADES.COBRAR), false);
});

test('sin estado se asume exploración', () => {
  const c = calcularCapacidades({ rol: 'PRESTADOR' });
  assert.equal(c.estado, ESTADOS.EXPLORACION);
});

test('el bloqueo de un explorador dice el siguiente paso', () => {
  const motivo = motivoBloqueo('EXPLORACION');
  assert.match(motivo.mensaje, /Modo Exploración/);
  assert.equal(motivo.siguiente_paso, 'VERIFICAR_DOCUMENTOS');
});

test('habilitado no tiene motivo de bloqueo', () => {
  assert.equal(motivoBloqueo('HABILITADO'), null);
});
