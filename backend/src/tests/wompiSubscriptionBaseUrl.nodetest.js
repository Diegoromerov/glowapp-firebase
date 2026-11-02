// Antes: `const WOMPI_BASE_URL = process.env.WOMPI_BASE_URL || 'https://production.wompi.co/v1'`
// evaluado al importar. Con llaves pub_test_* y sin la variable, las
// suscripciones SaaS pegaban a producción mientras la tienda (wompiClient, que
// decide por NODE_ENV) usaba sandbox.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveWompiBaseUrl } = require(
  path.join(__dirname, '..', 'services', 'wompiSubscriptionService')
);

const original = { ...process.env };

function restaurar() {
  for (const k of ['WOMPI_BASE_URL', 'NODE_ENV']) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
}

test('usa WOMPI_BASE_URL cuando está definida', () => {
  process.env.WOMPI_BASE_URL = 'https://sandbox.wompi.co/v1';
  try {
    assert.equal(resolveWompiBaseUrl(), 'https://sandbox.wompi.co/v1');
  } finally {
    restaurar();
  }
});

test('quita la barra final de la variable', () => {
  process.env.WOMPI_BASE_URL = 'https://sandbox.wompi.co/v1/';
  try {
    assert.equal(resolveWompiBaseUrl(), 'https://sandbox.wompi.co/v1');
  } finally {
    restaurar();
  }
});

test('sin variable y en producción usa production.wompi.co', () => {
  delete process.env.WOMPI_BASE_URL;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(resolveWompiBaseUrl(), 'https://production.wompi.co/v1');
  } finally {
    restaurar();
  }
});

test('sin variable y fuera de producción usa el sandbox', () => {
  delete process.env.WOMPI_BASE_URL;
  process.env.NODE_ENV = 'development';
  try {
    assert.equal(resolveWompiBaseUrl(), 'https://sandbox.wompi.co/v1');
  } finally {
    restaurar();
  }
});
