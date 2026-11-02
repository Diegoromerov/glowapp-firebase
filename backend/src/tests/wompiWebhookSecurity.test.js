/**
 * backend/src/tests/wompiWebhookSecurity.test.js
 *
 * Contrato de verificación de eventos de Wompi.
 *
 * El archivo anterior exigía un esquema INVENTADO (HMAC-SHA256 de
 * `timestamp.nonce.rawBody` con headers `x-wompi-signature`/`x-wompi-timestamp`/
 * `x-wompi-nonce`). Wompi no firma así: ningún evento real lo cumplía, de modo que
 * el webhook habría respondido 401 a TODO pago legítimo y ningún cobro se habría
 * confirmado nunca.
 *
 * Este archivo fija el esquema REAL (docs.wompi.co → Eventos → Validación de
 * integridad):
 *   checksum = SHA256( <valores de signature.properties en orden, sin separador>
 *                      + <timestamp del evento> + <events_secret> )
 * disponible en el header `X-Event-Checksum` y en `signature.checksum`.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const bookingController = require('../controllers/bookingController');

const SECRET = 'test_wompi_events_secret_12345';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function checksumDe(evento, secret = SECRET) {
  const valores = evento.signature.properties
    .map((ruta) => ruta.split('.').reduce((acc, k) => acc[k], evento.data))
    .join('');
  return sha256(`${valores}${evento.timestamp}${secret}`);
}

function eventoTransaccion({ status = 'APPROVED', amountInCents = 4490000, timestamp = 1747673128600 } = {}) {
  const evento = {
    event: 'transaction.updated',
    data: {
      transaction: {
        id: '1234-1610641025-49201',
        reference: 'booking-456',
        status,
        amount_in_cents: amountInCents,
        payment_method_type: 'NEQUI'
      }
    },
    signature: {
      properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
      checksum: null
    },
    timestamp
  };
  evento.signature.checksum = checksumDe(evento);
  return evento;
}

function verify(evento) {
  return bookingController.verifyWompiSignature({ body: evento, header: () => undefined, ip: '127.0.0.1' });
}

function buildApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app.post('/api/payments/wompi-webhook', bookingController.wompiWebhook);
  return app;
}

describe('Wompi webhook — validación del checksum real de eventos', () => {
  beforeEach(() => {
    process.env.WOMPI_EVENTS_SECRET = SECRET;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    delete process.env.WOMPI_EVENTS_SECRET;
  });

  test('expone verifyWompiSignature para poder verificarlo de forma aislada', () => {
    expect(typeof bookingController.verifyWompiSignature).toBe('function');
  });

  test('acepta un evento cuyo checksum coincide (cuerpo)', () => {
    expect(verify(eventoTransaccion())).toBe(true);
  });

  test('acepta el checksum tomado del header X-Event-Checksum', () => {
    const evento = eventoTransaccion();
    const header = evento.signature.checksum;
    delete evento.signature.checksum;
    const req = {
      body: evento,
      header: (n) => (String(n).toLowerCase() === 'x-event-checksum' ? header : undefined),
      ip: '127.0.0.1'
    };
    expect(bookingController.verifyWompiSignature(req)).toBe(true);
  });

  describe('Rechazos', () => {
    test('RECHAZA si el monto fue alterado tras firmar (no se puede inflar lo pagado)', () => {
      const evento = eventoTransaccion();
      evento.data.transaction.amount_in_cents = 1;
      expect(verify(evento)).toBe(false);
    });

    test('RECHAZA si se altera el timestamp (impide reusar un checksum capturado)', () => {
      const evento = eventoTransaccion();
      evento.timestamp = evento.timestamp + 99999;
      expect(verify(evento)).toBe(false);
    });

    test('RECHAZA si se altera el estado (DECLINED -> APPROVED)', () => {
      const evento = eventoTransaccion({ status: 'DECLINED' });
      evento.data.transaction.status = 'APPROVED';
      expect(verify(evento)).toBe(false);
    });

    test('RECHAZA una firma calculada con otro secreto', () => {
      const evento = eventoTransaccion();
      evento.signature.checksum = checksumDe(evento, 'otro_secreto');
      expect(verify(evento)).toBe(false);
    });

    test('RECHAZA si falta signature.properties', () => {
      const evento = eventoTransaccion();
      delete evento.signature.properties;
      expect(verify(evento)).toBe(false);
    });

    test('RECHAZA si falta el checksum y no viene en el header', () => {
      const evento = eventoTransaccion();
      delete evento.signature.checksum;
      expect(verify(evento)).toBe(false);
    });

    test('RECHAZA si una property apunta a un campo inexistente en data', () => {
      const evento = eventoTransaccion();
      evento.signature.properties = ['transaction.campo_inexistente'];
      expect(verify(evento)).toBe(false);
    });

    test('RECHAZA si no hay secreto de eventos configurado', () => {
      delete process.env.WOMPI_EVENTS_SECRET;
      // En NODE_ENV=test hay un atajo para no romper otros tests; se desactiva para
      // comprobar que sin secreto la verificación real falla en cerrado.
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(verify(eventoTransaccion())).toBe(false);
      } finally {
        process.env.NODE_ENV = prev;
      }
    });
  });

  describe('Integración HTTP (/api/payments/wompi-webhook)', () => {
    test('responde 200 a un evento correctamente firmado', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/payments/wompi-webhook')
        .send(eventoTransaccion({ status: 'PENDING' }));
      expect(res.status).toBe(200);
    });

    test('responde 401 cuando el checksum no corresponde', async () => {
      const app = buildApp();
      const evento = eventoTransaccion();
      evento.data.transaction.amount_in_cents = 1; // alterado después de firmar
      const res = await request(app).post('/api/payments/wompi-webhook').send(evento);
      expect(res.status).toBe(401);
    });

    test('responde 401 si el evento no trae firma alguna', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/payments/wompi-webhook').send({
        event: 'transaction.updated',
        data: { transaction: { id: 'x', reference: 'b', status: 'APPROVED', amount_in_cents: 1 } }
      });
      expect(res.status).toBe(401);
    });
  });
});

// ---------------------------------------------------------------------------
// Wompi entrega TODOS los eventos a una sola URL. La de reservas recibia tambien
// los de pedidos de tienda, no encontraba la reserva y Wompi reintentaba: el
// pedido no se cerraba nunca. Estos casos fijan el despacho por prefijo.
// ---------------------------------------------------------------------------
describe('Wompi webhook — despacho por tipo de referencia', () => {
  const orderController = require('../controllers/orderController');
  let storeSpy;

  beforeEach(() => {
    process.env.WOMPI_EVENTS_SECRET = SECRET;
    storeSpy = jest
      .spyOn(orderController, 'storeWebhook')
      .mockImplementation((req, res) => res.json({ delegado: 'store' }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.WOMPI_EVENTS_SECRET;
  });

  test('una referencia wompi_order_ se despacha al webhook de tienda', async () => {
    const evento = eventoTransaccion();
    evento.data.transaction.reference =
      'wompi_order_8f14e45f-ceea-467f-a1c0-000000000001_1750000000000';
    evento.signature.checksum = checksumDe(evento);

    const res = await request(buildApp()).post('/api/payments/wompi-webhook').send(evento);

    expect(storeSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  test('una referencia de reserva NO se desvia al webhook de tienda', async () => {
    await request(buildApp()).post('/api/payments/wompi-webhook').send(eventoTransaccion());
    expect(storeSpy).not.toHaveBeenCalled();
  });
});
