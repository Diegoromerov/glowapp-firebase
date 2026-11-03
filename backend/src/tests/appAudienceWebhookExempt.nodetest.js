// Los webhooks de Wompi son callbacks máquina-a-máquina: la pasarela no envía
// `X-App-Audience`. Con el middleware global montado en /api sin exenciones, su
// POST moría en 400 antes de llegar al handler, así que ningún evento se procesó
// nunca (webhook_events vacío) y los pagos aprobados no cerraban el pedido.
//
// La autenticación real de esos endpoints es la firma del evento (checksum con
// WOMPI_EVENTS_SECRET), que cada handler verifica y falla cerrado con 401.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const { validateAppAudience } = require(
  path.join(__dirname, '..', 'middleware', 'appAudience')
);

const app = express();
app.use(express.json());
app.use('/api', validateAppAudience({ required: true }));

// Rutas falsas que sólo confirman "el middleware me dejó pasar".
app.post('/api/payments/store-webhook', (req, res) => res.json({ tocado: 'store-webhook' }));
app.post('/api/payments/wompi-webhook', (req, res) => res.json({ tocado: 'wompi-webhook' }));
app.post('/api/products', (req, res) => res.json({ tocado: 'products' }));
app.post('/api/payments/store-webhook/extra', (req, res) => res.json({ tocado: 'extra' }));

test('el webhook de la tienda pasa sin X-App-Audience', async () => {
  const res = await request(app).post('/api/payments/store-webhook').send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.tocado, 'store-webhook');
});

test('el webhook de reservas pasa sin X-App-Audience', async () => {
  const res = await request(app).post('/api/payments/wompi-webhook').send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.tocado, 'wompi-webhook');
});

test('la exención no se rompe con query string', async () => {
  const res = await request(app)
    .post('/api/payments/store-webhook?evento=prueba')
    .send({});
  assert.equal(res.status, 200);
});

test('una ruta normal sigue exigiendo la cabecera', async () => {
  const res = await request(app).post('/api/products').send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.message, 'Header X-App-Audience requerido');
});

test('la exención es exacta: no cubre subrutas', async () => {
  const res = await request(app).post('/api/payments/store-webhook/extra').send({});
  assert.equal(res.status, 400);
});
