'use strict';

/**
 * Vitrina pública del proveedor (D-GL-031, T-077).
 *
 * Lo que se prueba aquí es lo que ve una clienta: un perfil en preparación no
 * puede ofrecer reserva, y el slug tiene que salir estable porque vive en un
 * enlace que el proveedor comparte.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  generarSlug,
  slugConSufijo,
  construirPerfilPublico,
} = require(path.join(__dirname, '..', 'services', 'vitrinaProveedor'));

test('el nombre se convierte en slug sin acentos ni símbolos', () => {
  assert.equal(generarSlug('Valentina Pérez'), 'valentina-perez');
  assert.equal(generarSlug('  Salón Ñandú & Spa  '), 'salon-nandu-spa');
});

test('un nombre sin letras usables no produce slug', () => {
  assert.equal(generarSlug('...'), null);
  assert.equal(generarSlug(''), null);
  assert.equal(generarSlug(null), null);
});

test('el sufijo resuelve colisiones sin pasar de 60 caracteres', () => {
  assert.equal(slugConSufijo('valentina', 2), 'valentina-2');
  const largo = 'a'.repeat(60);
  const conSufijo = slugConSufijo(largo, 12);
  assert.equal(conSufijo.length, 60);
  assert.ok(conSufijo.endsWith('-12'));
});

test('un proveedor en exploración se muestra sin reserva y con sello', () => {
  const perfil = construirPerfilPublico({ nombre: 'Valentina', estado_operativo: 'EXPLORACION' });
  assert.equal(perfil.reservable, false);
  assert.equal(perfil.estado, 'EN_PREPARACION');
  assert.match(perfil.sello, /aún no recibe reservas/);
});

test('en verificación tampoco se reserva', () => {
  assert.equal(construirPerfilPublico({ estado_operativo: 'EN_VERIFICACION' }).reservable, false);
});

test('suspendido no se reserva', () => {
  assert.equal(construirPerfilPublico({ estado_operativo: 'SUSPENDIDO' }).reservable, false);
});

test('habilitado sí se reserva y no lleva sello', () => {
  const perfil = construirPerfilPublico({ nombre: 'Valentina', estado_operativo: 'HABILITADO' });
  assert.equal(perfil.reservable, true);
  assert.equal(perfil.sello, null);
  assert.equal(perfil.estado, 'ACTIVO');
});

test('sin estado se asume exploración', () => {
  assert.equal(construirPerfilPublico({ nombre: 'X' }).reservable, false);
});

test('el perfil público no expone campos internos', () => {
  const perfil = construirPerfilPublico({
    nombre: 'X',
    rut_numero: '1020304050',
    email: 'x@y.co',
    responsable_iva: true,
  });
  assert.equal(perfil.rut_numero, undefined);
  assert.equal(perfil.email, undefined);
  assert.equal(perfil.responsable_iva, undefined);
});
