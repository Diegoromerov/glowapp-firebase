/**
 * backend/src/tests/wompiClient.test.js
 *
 * Contrato del cliente real de Wompi. Estos tests fijan los formatos
 * DOCUMENTADOS (docs.wompi.co) para que una regresión no reintroduzca una
 * integración inventada. Se mockea axios: no hay tráfico de red.
 */

const crypto = require('crypto');

jest.mock('axios');
const axios = require('axios');

const wompiClient = require('../services/wompiClient');

const ENV = {
  WOMPI_PRIVATE_KEY: 'prv_test_private_123',
  WOMPI_PUBLIC_KEY: 'pub_test_public_456',
  WOMPI_INTEGRITY_SECRET: 'test_integrity_secret_789',
  WOMPI_EVENTS_SECRET: 'test_events_secret_abc',
  WOMPI_BASE_URL: 'https://sandbox.wompi.co/v1'
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, ENV);
});

afterEach(() => {
  delete process.env.WOMPI_PRIVATE_KEY;
  delete process.env.WOMPI_PUBLIC_KEY;
  delete process.env.WOMPI_INTEGRITY_SECRET;
  delete process.env.WOMPI_EVENTS_SECRET;
  delete process.env.WOMPI_BASE_URL;
});

describe('createIntegritySignature', () => {
  test('reproduce EXACTAMENTE el ejemplo oficial de la documentación de Wompi', () => {
    // docs.wompi.co/en/docs/colombia/widget-checkout-web → "Generate an integrity signature"
    process.env.WOMPI_INTEGRITY_SECRET = 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6';
    const firma = wompiClient.createIntegritySignature({
      reference: 'sk8-438k4-xmxm392-sn2m',
      amountInCents: 2490000,
      currency: 'COP'
    });
    expect(firma).toBe('37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5');
  });

  test('incluye expiration_time en la cadena cuando se provee (orden documentado)', () => {
    process.env.WOMPI_INTEGRITY_SECRET = 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6';
    const expiration = '2023-06-09T20:28:50.000Z';
    const firma = wompiClient.createIntegritySignature({
      reference: 'sk8-438k4-xmxm392-sn2m',
      amountInCents: 2490000,
      currency: 'COP',
      expirationTime: expiration
    });
    const esperado = crypto
      .createHash('sha256')
      .update(`sk8-438k4-xmxm392-sn2m2490000COP${expiration}prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6`)
      .digest('hex');
    expect(firma).toBe(esperado);
  });

  test('lanza si falta el secreto de integridad', () => {
    delete process.env.WOMPI_INTEGRITY_SECRET;
    expect(() =>
      wompiClient.createIntegritySignature({ reference: 'r1', amountInCents: 1000 })
    ).toThrow(/INTEGRITY_SECRET/i);
  });
});

describe('verifyEventChecksum (esquema real de eventos de Wompi)', () => {
  const buildEvent = (overrides = {}) => {
    const data = {
      transaction: { id: '1234-1610641025-49201', status: 'APPROVED', amount_in_cents: 4490000 }
    };
    const timestamp = 1530291411;
    const properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
    const secret = process.env.WOMPI_EVENTS_SECRET;
    const checksum = crypto
      .createHash('sha256')
      .update(`1234-1610641025-49201APPROVED4490000${timestamp}${secret}`)
      .digest('hex');
    return {
      event: 'transaction.updated',
      data,
      signature: { properties, checksum },
      timestamp,
      ...overrides
    };
  };

  test('acepta un evento cuyo checksum coincide', () => {
    const res = wompiClient.verifyEventChecksum(buildEvent());
    expect(res.valid).toBe(true);
  });

  test('acepta el checksum tomado del header X-Event-Checksum', () => {
    const event = buildEvent();
    const header = event.signature.checksum;
    delete event.signature.checksum;
    expect(wompiClient.verifyEventChecksum(event, header).valid).toBe(true);
  });

  test('RECHAZA si el monto fue alterado (checksum no coincide)', () => {
    const event = buildEvent();
    event.data.transaction.amount_in_cents = 1; // atacante cambia el monto
    const res = wompiClient.verifyEventChecksum(event);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/checksum/i);
  });

  test('RECHAZA si se altera el timestamp (evita reusar un checksum viejo)', () => {
    const event = buildEvent({ timestamp: 1530291411 + 99999 });
    expect(wompiClient.verifyEventChecksum(event).valid).toBe(false);
  });

  test('RECHAZA si falta signature.properties', () => {
    const event = buildEvent();
    delete event.signature.properties;
    expect(wompiClient.verifyEventChecksum(event).valid).toBe(false);
  });

  test('RECHAZA si una property apunta a un campo inexistente en data', () => {
    const event = buildEvent();
    event.signature.properties = ['transaction.campo_que_no_existe'];
    const res = wompiClient.verifyEventChecksum(event);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/inexistentes/i);
  });

  test('RECHAZA si falta el secreto de eventos', () => {
    delete process.env.WOMPI_EVENTS_SECRET;
    const res = wompiClient.verifyEventChecksum(buildEvent());
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/EVENTS_SECRET/i);
  });

  test('soporta la estructura de eventos de payout (properties camelCase)', () => {
    const secret = process.env.WOMPI_EVENTS_SECRET;
    const timestamp = 1747673128600;
    const data = { payout: { id: '04a6e53d-a244-4140-ab9e-48fa541f9fe5', status: 'TOTAL_PAYMENT', amountInCents: 7500000 } };
    const checksum = crypto
      .createHash('sha256')
      .update(`04a6e53d-a244-4140-ab9e-48fa541f9fe5TOTAL_PAYMENT7500000${timestamp}${secret}`)
      .digest('hex');
    const event = {
      event: 'payout.updated',
      data,
      signature: { properties: ['payout.id', 'payout.status', 'payout.amountInCents'], checksum },
      timestamp
    };
    expect(wompiClient.verifyEventChecksum(event).valid).toBe(true);
  });
});

describe('getAcceptanceTokens', () => {
  test('extrae el token de aceptación del merchant', async () => {
    axios.mockResolvedValue({
      data: {
        data: {
          presigned_acceptance: { acceptance_token: 'acc_tok_1', permalink: 'https://wompi.co/terms' },
          presigned_personal_data_auth: { acceptance_token: 'personal_tok_1' }
        }
      }
    });

    const tokens = await wompiClient.getAcceptanceTokens();
    expect(tokens.acceptanceToken).toBe('acc_tok_1');
    expect(tokens.personalDataAuthToken).toBe('personal_tok_1');

    const [config] = axios.mock.calls[0];
    expect(config.url).toBe('https://sandbox.wompi.co/v1/merchants/pub_test_public_456');
    expect(config.headers.Authorization).toBe('Bearer pub_test_public_456');
  });
});

describe('createTransaction', () => {
  test('construye el payload documentado y firma la integridad', async () => {
    axios.mockResolvedValue({
      data: { data: { id: '1292-1602113476-10985', status: 'PENDING', reference: 'ORDER-1', amount_in_cents: 50000 } }
    });

    const tx = await wompiClient.createTransaction({
      amountInCents: 50000,
      reference: 'ORDER-1',
      customerEmail: 'juan@example.com',
      acceptanceToken: 'acc_tok_1',
      paymentMethod: { type: 'CARD', token: 'tok_1', installments: 1 }
    });

    const [config] = axios.mock.calls[0];
    expect(config.method).toBe('POST');
    expect(config.url).toBe('https://sandbox.wompi.co/v1/transactions');
    expect(config.headers.Authorization).toBe('Bearer prv_test_private_123');
    expect(config.data.amount_in_cents).toBe(50000);
    expect(config.data.currency).toBe('COP');
    expect(config.data.acceptance_token).toBe('acc_tok_1');
    expect(config.data.reference).toBe('ORDER-1');
    expect(config.data.payment_method).toEqual({ type: 'CARD', token: 'tok_1', installments: 1 });
    expect(config.data.payment_source_id).toBeUndefined();
    // la firma debe ser el SHA256 documentado
    expect(config.data.signature).toBe(
      wompiClient.createIntegritySignature({ reference: 'ORDER-1', amountInCents: 50000, currency: 'COP' })
    );
    expect(tx.status).toBe('PENDING');
    expect(tx.id).toBe('1292-1602113476-10985');
  });

  test('NEQUI viaja con phone_number verbatim: el cliente no reescribe el medio de pago', async () => {
    // Wompi NO admite `token` en payment_method NEQUI (docs → Métodos de pago):
    // va con phone_number. El cliente debe reenviar el objeto tal cual, sin
    // "normalizarlo", o el cobro con Nequi —el método por defecto de la app— falla.
    axios.mockResolvedValue({ data: { data: { id: 'tx-nequi', status: 'PENDING', reference: 'ORDER-2' } } });

    await wompiClient.createTransaction({
      amountInCents: 15000000,
      reference: 'ORDER-2',
      customerEmail: 'ana@example.com',
      acceptanceToken: 'acc_tok_1',
      paymentMethod: { type: 'NEQUI', phone_number: '3991111111' }
    });

    const [config] = axios.mock.calls[0];
    expect(config.data.payment_method).toEqual({ type: 'NEQUI', phone_number: '3991111111' });
    expect(config.data.payment_method.token).toBeUndefined();
    expect(config.data.payment_source_id).toBeUndefined();
  });

  test('`auth` elige la llave: privada por defecto, pública si se pide', async () => {
    axios.mockResolvedValue({ data: { data: { id: 'tx-1', status: 'PENDING', reference: 'R' } } });
    const base = {
      amountInCents: 1000,
      reference: 'R',
      customerEmail: 'a@b.co',
      acceptanceToken: 't',
      paymentMethod: { type: 'NEQUI', phone_number: '3991111111' }
    };

    await wompiClient.createTransaction(base);
    expect(axios.mock.calls[0][0].headers.Authorization).toBe('Bearer prv_test_private_123');

    axios.mockClear();
    axios.mockResolvedValue({ data: { data: { id: 'tx-2', status: 'PENDING', reference: 'R2' } } });
    await wompiClient.createTransaction({ ...base, reference: 'R2', auth: 'public' });
    expect(axios.mock.calls[0][0].headers.Authorization).toBe('Bearer pub_test_public_456');
  });

  test('rechaza si se envían payment_source_id Y payment_method a la vez', async () => {
    await expect(
      wompiClient.createTransaction({
        amountInCents: 1000,
        reference: 'r',
        customerEmail: 'a@b.co',
        acceptanceToken: 't',
        paymentSourceId: 12,
        paymentMethod: { type: 'CARD', token: 'x', installments: 1 }
      })
    ).rejects.toThrow(/exactamente uno/i);
    expect(axios).not.toHaveBeenCalled();
  });

  test('rechaza si no se envía ninguno de los dos', async () => {
    await expect(
      wompiClient.createTransaction({ amountInCents: 1000, reference: 'r', customerEmail: 'a@b.co', acceptanceToken: 't' })
    ).rejects.toThrow(/exactamente uno/i);
  });

  test('rechaza monto no entero o <= 0', async () => {
    await expect(
      wompiClient.createTransaction({
        amountInCents: 0, reference: 'r', customerEmail: 'a@b.co', acceptanceToken: 't',
        paymentMethod: { type: 'NEQUI' }
      })
    ).rejects.toThrow(/entero positivo/i);
  });

  test('sin credenciales completas lanza y NO llama a la API', async () => {
    delete process.env.WOMPI_PRIVATE_KEY;
    await expect(
      wompiClient.createTransaction({
        amountInCents: 1000, reference: 'r', customerEmail: 'a@b.co', acceptanceToken: 't',
        paymentMethod: { type: 'NEQUI' }
      })
    ).rejects.toThrow(/WOMPI_PRIVATE_KEY/);
    expect(axios).not.toHaveBeenCalled();
  });

  test('propaga el status y el cuerpo del error de Wompi', async () => {
    const error = new Error('Request failed');
    error.response = { status: 422, data: { error: { messages: { reference: ['Duplicate reference'] } } } };
    axios.mockRejectedValue(error);

    await expect(
      wompiClient.createTransaction({
        amountInCents: 1000, reference: 'dup', customerEmail: 'a@b.co', acceptanceToken: 't',
        paymentMethod: { type: 'NEQUI' }
      })
    ).rejects.toMatchObject({ name: 'WompiError', status: 422 });
  });
});

describe('isConfigured', () => {
  test('true solo con las cuatro credenciales', () => {
    expect(wompiClient.isConfigured()).toBe(true);
    delete process.env.WOMPI_EVENTS_SECRET;
    expect(wompiClient.isConfigured()).toBe(false);
  });
});

describe('W10 — surface de la URL de redirección (async_payment_url)', () => {
  const extraer = (data) => wompiClient._extraerAsyncPaymentUrl(data);

  test('lee payment_method.extra.async_payment_url (forma documentada de Wompi)', () => {
    expect(extraer({
      payment_method: { extra: { async_payment_url: 'https://sandbox.wompi.co/redirect/x' } }
    })).toBe('https://sandbox.wompi.co/redirect/x');
  });

  test('acepta la forma aplanada del proveedor', () => {
    expect(extraer({ async_payment_url: 'https://wompi.co/r/1' })).toBe('https://wompi.co/r/1');
    expect(extraer({ payment_method_extra: { async_payment_url: 'https://wompi.co/r/2' } }))
      .toBe('https://wompi.co/r/2');
  });

  test('null cuando no hay redirección (Nequi, tarjeta): nunca inventa una URL', () => {
    expect(extraer({ id: 'tx-1', status: 'PENDING', payment_method: { type: 'NEQUI' } })).toBeNull();
    expect(extraer({})).toBeNull();
    expect(extraer(null)).toBeNull();
    expect(extraer(undefined)).toBeNull();
  });

  test('createTransaction expone asyncPaymentUrl en su resultado', async () => {
    axios.mockResolvedValue({
      data: {
        data: {
          id: 'tx-pse-1',
          status: 'PENDING',
          reference: 'ref-1',
          amount_in_cents: 150000,
          payment_method_type: 'PSE',
          payment_method: { extra: { async_payment_url: 'https://sandbox.wompi.co/redirect/pse' } }
        }
      }
    });

    const tx = await wompiClient.createTransaction({
      amountInCents: 150000,
      reference: 'ref-1',
      customerEmail: 'ana@example.com',
      acceptanceToken: 'acc',
      paymentMethod: 'PSE',
      redirectUrl: 'https://glowapp.co/pago/resultado',
      customerData: { email: 'ana@example.com', full_name: 'Ana', phone_number: '3001234567' }
    });

    expect(tx.asyncPaymentUrl).toBe('https://sandbox.wompi.co/redirect/pse');
  });
});
