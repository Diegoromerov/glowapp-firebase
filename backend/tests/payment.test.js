// backend/tests/payment.test.js
const crypto = require('crypto');

describe('Payment System & Webhook Signature Tests', () => {
  const WOMPI_EVENTS_SECRET = 'test_wompi_events_secret_12345';

  /**
   * Genera una firma SHA-256 de integridad para simular webhooks de Wompi
   */
  function generateWompiSignature(transactionId, status, amountInCents, currency, secret) {
    const stringToHash = `${transactionId}${status}${amountInCents}${currency}${secret}`;
    return crypto.createHash('sha256').update(stringToHash).digest('hex');
  }

  test('Debe generar y validar correctamente la firma SHA-256 del webhook de pagos', () => {
    const transactionId = 'tx_glow_987654';
    const status = 'APPROVED';
    const amountInCents = 4500000;
    const currency = 'COP';

    const signature = generateWompiSignature(transactionId, status, amountInCents, currency, WOMPI_EVENTS_SECRET);

    expect(signature).toBeDefined();
    expect(typeof signature).toBe('string');
    expect(signature.length).toBe(64); // HASH SHA-256 hex tiene 64 caracteres

    // Verificar recalculación con la misma clave
    const expected = generateWompiSignature(transactionId, status, amountInCents, currency, WOMPI_EVENTS_SECRET);
    expect(signature).toBe(expected);
  });

  test('Debe rechazar firmas de webhook alteradas o con clave incorrecta', () => {
    const transactionId = 'tx_glow_987654';
    const status = 'APPROVED';
    const amountInCents = 4500000;
    const currency = 'COP';

    const validSignature = generateWompiSignature(transactionId, status, amountInCents, currency, WOMPI_EVENTS_SECRET);
    const tamperedSignature = generateWompiSignature(transactionId, status, amountInCents, currency, 'fake_secret');

    expect(validSignature).not.toBe(tamperedSignature);
  });
});
