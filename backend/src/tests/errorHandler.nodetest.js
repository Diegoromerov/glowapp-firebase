// Sin middleware global, cualquier next(err) —incluidos los de los wrappers
// ah()/wrapRouterAsync— cae en el handler por defecto de Express: 500 en HTML,
// sin request_id y sin log estructurado. La app y el panel esperan JSON.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const errorHandler = require(path.join(__dirname, '..', 'middleware', 'errorHandler'));

function resFalsa() {
  const salida = {};
  return {
    salida,
    headersSent: false,
    status(codigo) {
      salida.status = codigo;
      return this;
    },
    json(cuerpo) {
      salida.body = cuerpo;
      return this;
    },
  };
}

test('responde JSON con 500 y sin filtrar el mensaje interno', () => {
  const req = { method: 'GET', originalUrl: '/api/x', headers: {}, id: 'req-1' };
  const res = resFalsa();

  errorHandler(new Error('detalle interno con SQL'), req, res, () => {});

  assert.equal(res.salida.status, 500);
  assert.equal(res.salida.body.success, false);
  assert.ok(!res.salida.body.error.includes('SQL'), 'no debe filtrar detalles internos');
  assert.equal(res.salida.body.request_id, 'req-1');
});

test('respeta statusCode del error y su mensaje cuando es 4xx', () => {
  const err = new Error('Ya hay un pago en curso');
  err.statusCode = 409;
  const res = resFalsa();

  errorHandler(
    err,
    { method: 'POST', originalUrl: '/api/store/orders/1/pay', headers: {} },
    res,
    () => {}
  );

  assert.equal(res.salida.status, 409);
  assert.equal(res.salida.body.error, 'Ya hay un pago en curso');
});

test('si la respuesta ya empezó, delega en next sin escribir', () => {
  const res = resFalsa();
  res.headersSent = true;
  let delegado = false;

  errorHandler(
    new Error('tarde'),
    { method: 'GET', originalUrl: '/x', headers: {} },
    res,
    () => {
      delegado = true;
    }
  );

  assert.equal(delegado, true);
  assert.equal(res.salida.status, undefined);
});
