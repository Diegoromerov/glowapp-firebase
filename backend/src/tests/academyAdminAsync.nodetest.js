// Las rutas de academyAdminRoutes ya se envuelven con wrapRouterAsync(router) al
// final del archivo, así que cualquier rechazo llega a next(err). Lo que faltaba
// era el middleware global que convierte ese next(err) en una respuesta JSON: sin
// él, Express responde su página HTML por defecto.
//
// Esta prueba demuestra la cadena completa: pool que rechaza -> wrapRouterAsync ->
// errorHandler -> 500 JSON.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

function stub(modulo, exports) {
  const p = require.resolve(path.join(__dirname, '..', modulo));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

// Se saltan auth/admin para aislar el manejo de errores, y la base falla siempre.
stub(path.join('config', 'db'), {
  pool: { query: async () => { throw new Error('fallo simulado de base'); } },
  dbMode: 'stub',
});
stub(path.join('middleware', 'auth'), { authMiddleware: (req, res, next) => next() });
stub(path.join('middleware', 'admin'), (req, res, next) => next());

const rutas = require(path.join(__dirname, '..', 'routes', 'academyAdminRoutes'));
const errorHandler = require(path.join(__dirname, '..', 'middleware', 'errorHandler'));

const app = express();
app.use(express.json());
app.use('/api/admin/academy', rutas);
app.use(errorHandler);

test('GET /certificates responde 500 JSON cuando la consulta falla', async () => {
  const res = await request(app).get('/api/admin/academy/certificates');

  assert.equal(res.status, 500);
  assert.equal(res.body.success, false);
  assert.ok(res.headers['content-type'].includes('application/json'));
});


test('sin el middleware global la misma ruta NO responde JSON', async () => {
  // Contraste: demuestra que lo que cambia la conducta es el middleware, no el
  // wrapping de las rutas (que ya existía).
  const appSinMiddleware = express();
  appSinMiddleware.use(express.json());
  appSinMiddleware.use('/api/admin/academy', rutas);

  const res = await request(appSinMiddleware).get('/api/admin/academy/certificates');

  assert.equal(res.status, 500);
  assert.ok(
    !res.headers['content-type'].includes('application/json'),
    'sin el middleware Express responde su pagina por defecto (HTML/texto)'
  );
});
