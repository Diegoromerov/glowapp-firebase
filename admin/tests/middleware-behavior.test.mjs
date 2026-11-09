#!/usr/bin/env node
/**
 * Comportamiento REAL de la decisión del portero del panel (src/lib/portero.ts).
 *
 * `middleware.test.mjs` comprueba el fuente por texto. Este archivo ejercita la DECISIÓN que
 * el middleware usa en producción, porque el defecto que dio origen a esta prueba no se ve
 * leyendo el código: había un atajo por EXTENSIÓN que daba por público cualquier camino
 * terminado en `.algo`, así que `/admin/lo-que-sea.json` no pasaba por el portero. El
 * contrato estático incluso lo afirmaba como si fuera una propiedad deseada.
 *
 * Comprobado contra el panel real, sin sesión: `/admin/pqrsf` respondía 307 y
 * `/admin/pqrsf.json` llegaba al router. Hoy no hay nada detrás de esos caminos, pero el
 * App Router admite un segmento de ruta con punto: una exportación o un JSON futuro habría
 * nacido público.
 *
 * Se ejecuta con `node --test tests/middleware-behavior.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const { clasificarCamino } = await import('../src/lib/portero.ts');

/** Exige que un camino pase por el portero (necesite sesión de ADMIN). */
function exigeSesion(camino) {
  assert.equal(
    clasificarCamino(camino),
    'protegido',
    `${camino} debería exigir sesión y la decisión fue "${clasificarCamino(camino)}"`
  );
}

test('una extensión bajo /admin NO puede saltarse el portero', () => {
  for (const camino of [
    '/admin/pqrsf.json',
    '/admin/precios.csv',
    '/admin/productos.json',
    '/admin/business.xml',
  ]) {
    exigeSesion(camino);
  }
});

test('tampoco cuela por los otros prefijos con rol (prestador, cliente, perfil)', () => {
  for (const camino of ['/prestador/datos.json', '/cliente/x.csv', '/perfil/lo-que-sea.txt']) {
    exigeSesion(camino);
  }
});

test('sin sesión, una ruta protegida sin extensión sigue redirigiendo al login', () => {
  for (const camino of ['/admin/pqrsf', '/admin/precios', '/', '/perfil']) {
    exigeSesion(camino);
  }
});

test('los archivos declarados como públicos se siguen sirviendo', () => {
  // Sin esto el panel se quedaría sin sus assets, y el arreglo sería peor que el defecto.
  for (const camino of ['/next.svg', '/file.svg', '/globe.svg', '/vercel.svg', '/window.svg']) {
    assert.equal(clasificarCamino(camino), 'asset', `${camino} debería servirse sin sesión`);
  }
  // `favicon.ico` NO está en esta lista a propósito: vive en src/app/ (no en public/) y el
  // matcher del middleware lo excluye, así que ni siquiera llega al portero. Que se sirva lo
  // comprueba el contrato del matcher en middleware.test.mjs, no esta decisión.
});

test('/login y /register siguen siendo públicos (y sus subrutas)', () => {
  for (const camino of ['/login', '/register', '/login/recuperar']) {
    assert.equal(clasificarCamino(camino), 'publico', `${camino} debería ser público`);
  }
});

test('/api sigue delegando en el BFF (que tiene su propia autenticación)', () => {
  for (const camino of ['/api/admin/tickets', '/api/glow-admin/sos/active']) {
    assert.equal(clasificarCamino(camino), 'api', `${camino} debería delegarse al BFF`);
  }
});

test('lo público ya NO es "tiene un punto": es una lista declarada', () => {
  // Si esto falla, alguien volvió a mirar la extensión en vez de la lista.
  for (const camino of ['/glow-logo.svg', '/datos.json', '/robots.txt', '/cualquier.cosa']) {
    exigeSesion(camino);
  }
});

test('la lista de assets públicos coincide con lo que hay en public/', () => {
  // Guardarraíl del otro lado: quien agregue un archivo a public/ tiene que declararlo, y
  // quien declare uno de más (o borre el archivo) se entera aquí.
  const enDisco = readdirSync(join(import.meta.dirname, '..', 'public'), { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => `/${e.name}`)
    .sort();

  // Se lee SOLO el bloque de la declaración. Buscar la palabra en todo el archivo se tragaba
  // también las otras listas ('/login', '/register', '/api') y la comparación habría pasado
  // siempre, comprobando nada.
  const fuente = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'portero.ts'), 'utf8');
  const inicio = fuente.indexOf('export const ASSETS_PUBLICOS = new Set([');
  const fin = fuente.indexOf(']);', inicio);
  const bloque = fuente.slice(inicio, fin);
  const declarados = (bloque.match(/'(\/[^']+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  assert.deepEqual(declarados, enDisco, 'la lista de assets públicos y public/ se separaron');
});
