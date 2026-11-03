// backend/src/services/wompiClient.js
//
// Cliente HTTP real de la API de Wompi Colombia (v1).
// Fuente de verdad de los contratos: https://docs.wompi.co
//
//   - Tokens de aceptación:      GET  /merchants/:public_key            (llave pública)
//   - Firma de integridad:       SHA256(<reference><amount><currency>[<expiration>]<integrity_secret>)
//   - Tokenizar tarjeta:         POST /tokens/cards                      (llave pública)
//   - Crear fuente de pago:      POST /payment_sources                   (llave privada)
//   - Crear transacción:         POST /transactions                      (llave privada)
//   - Consultar transacción:     GET  /transactions/:id                  (llave pública o privada)
//   - Checksum de eventos:       SHA256(<valores de properties><timestamp><events_secret>)
//
// IMPORTANTE: este módulo NO simula nada. Si falta configuración o la API
// responde con error, se lanza; nunca se fabrica una respuesta de éxito.

const axios = require('axios');
const crypto = require('crypto');

const SANDBOX_BASE_URL = 'https://sandbox.wompi.co/v1';
const PRODUCTION_BASE_URL = 'https://production.wompi.co/v1';

/**
 * Error de integración con Wompi. Conserva el status HTTP y el cuerpo de la
 * respuesta para que el llamador pueda mapear códigos (422 referencia
 * duplicada, 400 token de aceptación inválido, 401 llave inválida, ...).
 */
class WompiError extends Error {
  constructor(message, { status = null, body = null, cause = null } = {}) {
    super(message);
    this.name = 'WompiError';
    this.status = status;
    this.body = body;
    if (cause) this.cause = cause;
  }
}

/**
 * Comparación de hashes en tiempo constante (evita filtrar el checksum válido
 * por diferencia de tiempo en la comparación byte a byte).
 */
const timingSafeEqualHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

class WompiClient {
  constructor() {
    this.timeout = parseInt(process.env.WOMPI_TIMEOUT_MS, 10) || 20000;
  }

  // ── Configuración (leída en cada llamada para no capturar el entorno al importar) ──

  get privateKey() {
    return process.env.WOMPI_PRIVATE_KEY;
  }

  get publicKey() {
    return process.env.WOMPI_PUBLIC_KEY;
  }

  get integritySecret() {
    return process.env.WOMPI_INTEGRITY_SECRET;
  }

  get eventsSecret() {
    return process.env.WOMPI_EVENTS_SECRET;
  }

  get baseUrl() {
    if (process.env.WOMPI_BASE_URL) return process.env.WOMPI_BASE_URL.replace(/\/$/, '');
    return process.env.NODE_ENV === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }

  /**
   * ¿Está la integración real configurada? Se usa como compuerta explícita:
   * sin llaves no se intenta cobrar (y jamás se simula en su lugar).
   */
  isConfigured() {
    return Boolean(this.privateKey && this.publicKey && this.integritySecret && this.eventsSecret);
  }

  _assertConfigured() {
    const faltantes = [];
    if (!this.privateKey) faltantes.push('WOMPI_PRIVATE_KEY');
    if (!this.publicKey) faltantes.push('WOMPI_PUBLIC_KEY');
    if (!this.integritySecret) faltantes.push('WOMPI_INTEGRITY_SECRET');
    if (!this.eventsSecret) faltantes.push('WOMPI_EVENTS_SECRET');
    if (faltantes.length) {
      throw new WompiError(
        `Integración Wompi incompleta: faltan ${faltantes.join(', ')}. ` +
        'No se procesan pagos sin credenciales reales.'
      );
    }
  }

  async _request(method, path, { body, auth = 'private', params } = {}) {
    const key = auth === 'public' ? this.publicKey : this.privateKey;
    if (!key) {
      throw new WompiError(`Falta la llave ${auth === 'public' ? 'pública' : 'privada'} de Wompi.`);
    }

    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${path}`,
        params,
        data: body,
        timeout: this.timeout,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      const status = error.response?.status ?? null;
      const respuesta = error.response?.data ?? null;
      const detalle =
        respuesta?.error?.messages || respuesta?.error?.message || respuesta?.message || error.message;
      throw new WompiError(`Wompi ${method} ${path} falló (${status ?? 'sin status'}): ${JSON.stringify(detalle)}`, {
        status,
        body: respuesta,
        cause: error
      });
    }
  }

  // ── Tokens de aceptación ─────────────────────────────────────────────────
  /**
   * Obtiene los tokens de aceptación del comercio. Requeridos en toda creación
   * de transacción o fuente de pago (Habeas Data).
   * @returns {Promise<{acceptanceToken: string, personalDataAuthToken: string, permalink: string}>}
   */
  async getAcceptanceTokens() {
    if (!this.publicKey) {
      throw new WompiError('Falta WOMPI_PUBLIC_KEY para obtener los tokens de aceptación.');
    }
    const { data } = await this._request('GET', `/merchants/${this.publicKey}`, { auth: 'public' });

    const acceptance = data?.presigned_acceptance?.acceptance_token;
    const personalAuth = data?.presigned_personal_data_auth?.acceptance_token;

    if (!acceptance) {
      throw new WompiError('La respuesta de Wompi no incluyó presigned_acceptance.acceptance_token.');
    }

    return {
      acceptanceToken: acceptance,
      personalDataAuthToken: personalAuth || null,
      permalink: data?.presigned_acceptance?.permalink || null
    };
  }

  // ── Firma de integridad ──────────────────────────────────────────────────
  /**
   * SHA256 de `<reference><amount_in_cents><currency>[<expiration_time>]<integrity_secret>`.
   * Debe calcularse en el servidor: el secreto nunca viaja al cliente.
   */
  createIntegritySignature({ reference, amountInCents, currency = 'COP', expirationTime = null }) {
    if (!this.integritySecret) {
      throw new WompiError('Falta WOMPI_INTEGRITY_SECRET para firmar la transacción.');
    }
    if (!reference || !Number.isFinite(Number(amountInCents))) {
      throw new WompiError('reference y amountInCents son obligatorios para firmar la transacción.');
    }

    const cadena =
      `${reference}${amountInCents}${currency}` +
      (expirationTime ? `${expirationTime}` : '') +
      this.integritySecret;

    return crypto.createHash('sha256').update(cadena).digest('hex');
  }

  // ── Verificación de eventos (webhook) ────────────────────────────────────
  /**
   * Valida la autenticidad de un evento de Wompi.
   *
   * Esquema REAL de Wompi (docs "Eventos → Validación de integridad"):
   *   checksum = SHA256( <valores de signature.properties, en orden, sin separador>
   *                      + <timestamp del evento>
   *                      + <events_secret> )
   * y llega en el header `X-Event-Checksum` o en `signature.checksum`.
   *
   * @param {object} event - Cuerpo del evento tal como lo envía Wompi.
   * @param {string} [headerChecksum] - Valor del header X-Event-Checksum (opcional).
   * @returns {{valid: boolean, reason?: string}}
   */
  verifyEventChecksum(event, headerChecksum) {
    const secret = this.eventsSecret;
    if (!secret) return { valid: false, reason: 'WOMPI_EVENTS_SECRET no configurado' };

    const signature = event?.signature;
    const properties = signature?.properties;
    const checksum = signature?.checksum || headerChecksum;

    if (!Array.isArray(properties) || properties.length === 0) {
      return { valid: false, reason: 'signature.properties ausente o vacío' };
    }
    if (!checksum) return { valid: false, reason: 'checksum ausente' };
    if (event?.timestamp === undefined || event?.timestamp === null) {
      return { valid: false, reason: 'timestamp ausente' };
    }

    const data = event?.data ?? {};
    const valores = properties.map((ruta) =>
      String(ruta)
        .split('.')
        .reduce((acc, clave) => (acc === undefined || acc === null ? undefined : acc[clave]), data)
    );

    if (valores.some((v) => v === undefined)) {
      return { valid: false, reason: `properties apunta a campos inexistentes en data: ${properties.join(', ')}` };
    }

    const esperado = crypto
      .createHash('sha256')
      .update(`${valores.join('')}${event.timestamp}${secret}`)
      .digest('hex');

    if (!timingSafeEqualHex(esperado, String(checksum))) {
      return { valid: false, reason: 'checksum no coincide' };
    }

    return { valid: true };
  }

  // ── Tokenización de tarjeta ──────────────────────────────────────────────
  /**
   * Tokeniza una tarjeta por "tokenización simple" (los datos viajan en claro
   * del cliente al servidor; usar SOLO si no es viable el widget del navegador
   * ni la variante cifrada JWE). Endpoint: POST /tokens/cards (llave pública).
   *
   * @returns {Promise<{id: string, brand: string, lastFour: string, expiresAt: string}>}
   */
  async tokenizeCard({ number, cvc, expMonth, expYear, cardHolder }) {
    const { data } = await this._request('POST', '/tokens/cards', {
      auth: 'public',
      body: {
        number,
        cvc,
        exp_month: expMonth,
        exp_year: expYear,
        card_holder: cardHolder
      }
    });

    if (!data?.id) throw new WompiError('Wompi no devolvió un token de tarjeta.');

    return {
      id: data.id,
      brand: data.brand || null,
      lastFour: data.last_four || null,
      expiresAt: data.expires_at || null
    };
  }

  /** Tokeniza una cuenta Nequi: POST /tokens/nequi (llave pública). */
  async tokenizeNequi(phoneNumber) {
    const { data } = await this._request('POST', '/tokens/nequi', {
      auth: 'public',
      body: { phone_number: phoneNumber }
    });

    if (!data?.id) throw new WompiError('Wompi no devolvió un token de Nequi.');

    // El usuario debe aceptar la suscripción en su celular: el estado pasa de
    // PENDING a APPROVED. Sin APPROVED no se puede crear la fuente de pago.
    return { id: data.id, status: data.status, phoneNumber: data.phone_number };
  }

  // ── Fuentes de pago ──────────────────────────────────────────────────────
  /**
   * Crea una fuente de pago reutilizable: POST /payment_sources (llave privada).
   * Requiere el token del medio (tarjeta o Nequi) ya creado.
   */
  async createPaymentSource({ customerEmail, type, token, acceptanceToken, personalDataAuthToken }) {
    if (!acceptanceToken) throw new WompiError('acceptance_token es obligatorio para crear la fuente de pago.');

    const body = {
      customer_email: customerEmail,
      type,
      token,
      acceptance_token: acceptanceToken
    };
    if (personalDataAuthToken) body.accept_personal_auth = personalDataAuthToken;

    const { data } = await this._request('POST', '/payment_sources', { auth: 'private', body });
    if (!data?.id) throw new WompiError('Wompi no devolvió el id de la fuente de pago.');

    return { id: data.id, status: data.status, type: data.type };
  }

  // ── Transacciones ────────────────────────────────────────────────────────
  /**
   * Crea una transacción real: POST /transactions.
   * Exige exactamente uno de `paymentMethod` (tarjeta recién tokenizada) o
   * `paymentSourceId` (fuente de pago guardada).
   *
   * `auth`: la doc oficial de Wompi dice que POST /transactions va con la llave
   * PRIVADA (Bearer). Existe un SDK de terceros que afirma que el camino con
   * `payment_method` usa la PÚBLICA. Se deja parametrizable para poder resolver
   * la duda con una prueba real en sandbox en vez de adivinarla.
   */
  async createTransaction({
    amountInCents,
    currency = 'COP',
    reference,
    customerEmail,
    acceptanceToken,
    paymentSourceId = null,
    paymentMethod = null,
    customerData = null,
    redirectUrl = null,
    ip = null,
    auth = 'private'
  }) {
    this._assertConfigured();

    if (!acceptanceToken) throw new WompiError('acceptance_token es obligatorio.');
    if (!reference) throw new WompiError('reference es obligatorio.');
    if (!customerEmail) throw new WompiError('customer_email es obligatorio.');
    if (!Number.isInteger(amountInCents) || amountInCents <= 0) {
      throw new WompiError('amount_in_cents debe ser un entero positivo (en centavos).');
    }
    if (Boolean(paymentSourceId) === Boolean(paymentMethod)) {
      throw new WompiError('Se requiere exactamente uno de payment_source_id o payment_method.');
    }

    const body = {
      amount_in_cents: amountInCents,
      currency,
      reference,
      customer_email: customerEmail,
      acceptance_token: acceptanceToken,
      signature: this.createIntegritySignature({ reference, amountInCents, currency })
    };

    if (paymentSourceId) body.payment_source_id = paymentSourceId;
    if (paymentMethod) body.payment_method = paymentMethod;
    if (customerData) body.customer_data = customerData;
    if (redirectUrl) body.redirect_url = redirectUrl;
    if (ip) body.ip = ip;

    const { data } = await this._request('POST', '/transactions', { auth, body });
    if (!data?.id) throw new WompiError('Wompi no devolvió el id de la transacción.');

    return {
      id: data.id,
      status: data.status,
      reference: data.reference,
      amountInCents: data.amount_in_cents,
      paymentMethodType: data.payment_method_type || null,
      statusMessage: data.status_message || null,
      // Métodos de redirección (PSE, BANCOLOMBIA_TRANSFER, DAVIPLATA): Wompi NO cobra
      // en la creación; devuelve una URL a la que el usuario debe ir para autorizar.
      // Descartarla aquí dejaba la transacción en PENDING sin forma de completarla:
      // el cliente pagaba con una pantalla que nunca redirigía.
      asyncPaymentUrl: this._extraerAsyncPaymentUrl(data)
    };
  }

  /**
   * Extrae la URL de autorización de una transacción de redirección.
   * Wompi la publica como `payment_method.extra.async_payment_url`; se acepta
   * también la forma plana por si el proveedor la aplana.
   */
  _extraerAsyncPaymentUrl(data) {
    const url = data?.payment_method?.extra?.async_payment_url
      || data?.payment_method_extra?.async_payment_url
      || data?.async_payment_url
      || null;
    return url ? String(url) : null;
  }

  /** Consulta el estado de una transacción: GET /transactions/:id. */
  async getTransaction(id) {
    const { data } = await this._request('GET', `/transactions/${id}`, { auth: 'private' });
    return {
      id: data?.id,
      status: data?.status,
      reference: data?.reference,
      amountInCents: data?.amount_in_cents,
      paymentMethodType: data?.payment_method_type || null,
      statusMessage: data?.status_message || null,
      asyncPaymentUrl: this._extraerAsyncPaymentUrl(data)
    };
  }
}

const client = new WompiClient();
client.WompiError = WompiError;
client.timingSafeEqualHex = timingSafeEqualHex;

module.exports = client;
