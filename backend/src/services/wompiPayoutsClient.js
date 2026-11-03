// backend/src/services/wompiPayoutsClient.js
//
// Cliente de la API de **Pagos a Terceros** de Wompi (dispersiones / payouts).
// Es una API DISTINTA de la de cobros: otro dominio, otra autenticación.
//
//   Base:    https://api.payouts.wompi.co/v1        (prod)
//            https://api.sandbox.payouts.wompi.co/v1 (sandbox)
//   Headers: x-api-key, user-principal-id, idempotency-key, Content-Type
//
//   GET  /banks      → catálogo de bancos (bankId es un UUID; NO se inventa)
//   GET  /accounts   → cuentas de origen del comercio (accountId)
//   POST /payouts    → crea un lote de pago (dispersión)
//   GET  /payouts/:id→ estado del lote
//
// Fuente: https://docs.wompi.co/docs/colombia/crea-tu-primer-lote/
//         https://docs.wompi.co/docs/colombia/sandbox-pagos-a-terceros/

const axios = require('axios');
const { WompiError } = require('./wompiClient');

const SANDBOX_BASE_URL = 'https://api.sandbox.payouts.wompi.co/v1';
const PRODUCTION_BASE_URL = 'https://api.payouts.wompi.co/v1';

/**
 * Normaliza un nombre de banco para poder cruzarlo contra el catálogo de Wompi
 * (que devuelve nombres como "BANCOLOMBIA", "BANCO DE BOGOTA", "NEQUI", ...).
 */
const normalizarNombreBanco = (nombre) =>
  String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .toUpperCase()
    .replace(/\b(BANCO|S\.?A\.?|SAS|CORP|CORPORACION)\b/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

/**
 * `idempotency-key` de Wompi solo admite letras, números y guiones (1-64 chars).
 * Las referencias internas llevan '_' (p.ej. `wompi_ret_AB12`) y serían rechazadas.
 */
const aIdempotencyKey = (referencia) =>
  String(referencia).replace(/_/g, '-').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);

class WompiPayoutsClient {
  constructor() {
    this.timeout = parseInt(process.env.WOMPI_TIMEOUT_MS, 10) || 20000;
    this._banksCache = null;
  }

  get apiKey() {
    return process.env.WOMPI_PAYOUTS_API_KEY;
  }

  get userPrincipalId() {
    return process.env.WOMPI_PAYOUTS_USER_PRINCIPAL_ID;
  }

  get accountId() {
    return process.env.WOMPI_PAYOUTS_ACCOUNT_ID;
  }

  get baseUrl() {
    if (process.env.WOMPI_PAYOUTS_BASE_URL) return process.env.WOMPI_PAYOUTS_BASE_URL.replace(/\/$/, '');
    return process.env.NODE_ENV === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.userPrincipalId && this.accountId);
  }

  _assertConfigured() {
    const faltantes = [];
    if (!this.apiKey) faltantes.push('WOMPI_PAYOUTS_API_KEY');
    if (!this.userPrincipalId) faltantes.push('WOMPI_PAYOUTS_USER_PRINCIPAL_ID');
    if (!this.accountId) faltantes.push('WOMPI_PAYOUTS_ACCOUNT_ID');
    if (faltantes.length) {
      throw new WompiError(
        `Dispersiones Wompi incompletas: faltan ${faltantes.join(', ')}. No se dispersa dinero sin credenciales reales.`
      );
    }
  }

  async _request(method, path, { body, params, idempotencyKey } = {}) {
    this._assertConfigured();

    const headers = {
      'x-api-key': this.apiKey,
      'user-principal-id': this.userPrincipalId,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (idempotencyKey) headers['idempotency-key'] = aIdempotencyKey(idempotencyKey);

    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${path}`,
        params,
        data: body,
        timeout: this.timeout,
        headers
      });
      return response.data;
    } catch (error) {
      const status = error.response?.status ?? null;
      const respuesta = error.response?.data ?? null;
      throw new WompiError(
        `Wompi Payouts ${method} ${path} falló (${status ?? 'sin status'}): ${JSON.stringify(respuesta || error.message)}`,
        { status, body: respuesta, cause: error }
      );
    }
  }

  /** GET /banks → [{ id, name }]. Se cachea: el catálogo cambia muy rara vez. */
  async listBanks({ force = false } = {}) {
    if (this._banksCache && !force) return this._banksCache;
    const respuesta = await this._request('GET', '/banks');
    const bancos = Array.isArray(respuesta) ? respuesta : respuesta?.data || [];
    this._banksCache = bancos.map((b) => ({ id: b.id, name: b.name }));
    return this._banksCache;
  }

  /** GET /accounts → cuentas de origen disponibles para dispersar. */
  async listAccounts() {
    const respuesta = await this._request('GET', '/accounts');
    return Array.isArray(respuesta) ? respuesta : respuesta?.data || [];
  }

  /**
   * Resuelve el UUID de banco que exige Wompi a partir del nombre guardado en la
   * app (`provider_wallet.banco`). NUNCA inventa un id: si no hay match, lanza.
   */
  async resolveBankId(nombreBanco) {
    const bancos = await this.listBanks();
    const objetivo = normalizarNombreBanco(nombreBanco);
    if (!objetivo) throw new WompiError('El nombre del banco del prestador está vacío.');

    const exacto = bancos.find((b) => normalizarNombreBanco(b.name) === objetivo);
    if (exacto) return exacto.id;

    const parcial = bancos.find((b) => {
      const n = normalizarNombreBanco(b.name);
      return n.includes(objetivo) || objetivo.includes(n);
    });
    if (parcial) return parcial.id;

    throw new WompiError(
      `No se pudo mapear el banco "${nombreBanco}" a un bankId de Wompi. ` +
      `Bancos disponibles: ${bancos.map((b) => b.name).join(', ')}`
    );
  }

  /**
   * Crea un lote de dispersión: POST /payouts.
   * @param {object} params
   * @param {string} params.reference - Referencia única del lote.
   * @param {Array}  params.transactions - Destinatarios (amount en CENTAVOS).
   * @param {string} [params.paymentType] - PAYROLL | PROVIDERS | OTHER.
   * @param {string} [params.idempotencyKey] - Evita duplicar el pago (24h).
   */
  async createPayoutBatch({ reference, transactions, paymentType = 'PROVIDERS', idempotencyKey, accountId }) {
    if (!reference) throw new WompiError('reference es obligatorio para crear el lote.');
    if (!Array.isArray(transactions) || transactions.length === 0) {
      throw new WompiError('El lote debe incluir al menos una transacción.');
    }

    const body = {
      reference,
      accountId: accountId || this.accountId,
      paymentType,
      transactions
    };

    const respuesta = await this._request('POST', '/payouts', {
      body,
      idempotencyKey: idempotencyKey || reference
    });

    const lote = respuesta?.data || respuesta;
    return {
      id: lote?.id || null,
      reference: lote?.reference || reference,
      status: lote?.status || null,
      raw: lote
    };
  }

  /** GET /payouts/:id → estado del lote (para reconciliación). */
  async getPayout(id) {
    const respuesta = await this._request('GET', `/payouts/${id}`);
    const lote = respuesta?.data || respuesta;
    return { id: lote?.id, reference: lote?.reference, status: lote?.status, raw: lote };
  }
}

const client = new WompiPayoutsClient();
client.normalizarNombreBanco = normalizarNombreBanco;
client.aIdempotencyKey = aIdempotencyKey;

module.exports = client;
