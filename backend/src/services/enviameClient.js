// backend/src/services/enviameClient.js
// Cliente Envíame multi-carrier — F1 Logística
// Placeholder/mock para desarrollo; integración real cuando haya credenciales

const crypto = require('crypto');

class EnviameClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.ENVIAME_BASE_URL || 'https://api.envia.com/v1';
    this.apiKey = options.apiKey || process.env.ENVIAME_API_KEY;
    this.webhookSecret = options.webhookSecret || process.env.ENVIAME_WEBHOOK_SECRET;
    this.timeout = options.timeout || 30000;
    
    this._mockMode = !this.apiKey || this.apiKey.includes('placeholder') || this.apiKey === 'mock';
    
    if (this._mockMode) {
      console.warn('[ENVIAMAE] ⚠️ MODO MOCK: Sin API key real. Respuestas simuladas.');
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1. VALIDACIÓN DE DIRECCIONES (DANE codes)
  // ────────────────────────────────────────────────────────────────────────
  
  /**
   * Valida y normaliza una dirección colombiana, retorna código DANE
   * @param {Object} params
   * @param {string} params.city - Ciudad (ej: 'Bogotá', 'Medellín')
   * @param {string} params.state - Código DANE departamento 2 dígitos (ej: '11', '05')
   * @param {string} params.country - Siempre 'CO'
   * @param {string} params.postal_code - Código postal 6 dígitos
   * @param {string} params.street - Dirección completa
   * @returns {Promise<Object>} { valid, dane_code, normalized_address, city, state }
   */
  async validateAddress({ city, state, country = 'CO', postal_code, street }) {
    if (this._mockMode) {
      // Mock: retorna DANE codes conocidos para ciudades principales
      const daneMap = {
        'bogota': '11001',
        'medellin': '05001',
        'cali': '76001',
        'barranquilla': '08001',
        'cartagena': '13001',
        'bucaramanga': '68001',
        'pereira': '66001',
        'manizales': '17001',
        'ibague': '73001',
        'villavicencio': '50001'
      };
      const normalizedCity = this._normalizeText(city);
      return {
        valid: true,
        dane_code: daneMap[normalizedCity] || '11001',
        normalized_address: street,
        city: city,
        state: state,
        country: 'CO'
      };
    }

    const res = await this._fetch('/geocodes/validate', 'POST', {
      city, state, country, postal_code, street
    });
    return res;
  }

  /**
   * Busca ciudad por nombre y retorna código DANE (endpoint específico Colombia)
   * @param {string} city - Nombre ciudad
   * @param {string} state - Código departamento 2 dígitos
   * @returns {Promise<Object>} { city, dane_code, state }
   */
  async locateColombiaCity(city, state) {
    if (this._mockMode) {
      return { city, dane_code: '11001', state };
    }
    const res = await this._fetch(`/locate/colombia/city?city=${encodeURIComponent(city)}&state=${state}&country=CO`, 'GET');
    return res;
  }

  // ────────────────────────────────────────────────────────────────────────
  // 2. COTIZACIÓN MULTI-CARRIER (Rate Shopping)
  // ────────────────────────────────────────────────────────────────────────
  
  /**
   * Obtiene cotizaciones de múltiples carriers para una ruta
   * @param {Object} params
   * @param {Object} params.origin - { city (dane_code), state, country, postal_code, street }
   * @param {Object} params.destination - { city (dane_code), state, country, postal_code, street }
   * @param {Object[]} params.parcels - [{ weight_kg, length_cm, width_cm, height_cm }]
   * @param {number} params.value_cop - Valor declarado para seguro
   * @param {string} params.currency - 'COP'
   * @returns {Promise<Array>} [{ carrier, service_code, rate_cop, days_min, days_max, pickup_available, dropoff_available }]
   */
  async getRates({ origin, destination, parcels, value_cop, currency = 'COP' }) {
    if (this._mockMode) {
      // Mock: retorna 3 carriers simulados con tarifas basadas en zonas_envio
      return [
        {
          carrier: 'inter',
          service_code: 'inter_express',
          rate_cop: 12000,
          days_min: 1,
          days_max: 2,
          pickup_available: true,
          dropoff_available: true
        },
        {
          carrier: 'coordinadora',
          service_code: 'coord_paq',
          rate_cop: 10500,
          days_min: 2,
          days_max: 3,
          pickup_available: true,
          dropoff_available: true
        },
        {
          carrier: 'servientrega',
          service_code: 'servi_estandar',
          rate_cop: 11500,
          days_min: 2,
          days_max: 4,
          pickup_available: true,
          dropoff_available: true
        }
      ];
    }

    const res = await this._fetch('/ship/rate', 'POST', {
      origin: { ...origin, country: 'CO' },
      destination: { ...destination, country: 'CO' },
      parcels,
      value: value_cop,
      currency
    });
    return res;
  }

  // ────────────────────────────────────────────────────────────────────────
  // 3. GENERACIÓN DE ETIQUETAS
  // ────────────────────────────────────────────────────────────────────────
  
  /**
   * Genera etiqueta de envío (label PDF + ZPL)
   * @param {Object} params
   * @param {string} params.rate_id - ID de la cotización elegida (del getRates)
   * @param {string} params.reference - Referencia interna (ej: 'order_<uuid>')
   * @param {Object} params.metadata - Metadatos extra
   * @returns {Promise<Object>} { tracking_number, label_pdf_url, label_zpl, carrier, service_code, carrier_account_id }
   */
  async generateLabel({ rate_id, reference, metadata = {} }) {
    if (this._mockMode) {
      const tracking = `ENV${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
      return {
        tracking_number: tracking,
        label_pdf_url: `https://mock.envia.com/labels/${tracking}.pdf`,
        label_zpl: `^XA^FO50,50^BY3^BCN,100,Y,N,N^FD${tracking}^FS^XZ`,
        carrier: 'inter',
        service_code: 'inter_express',
        carrier_account_id: 'mock-account-id'
      };
    }

    const res = await this._fetch('/ship/generate', 'POST', {
      rate_id,
      reference,
      metadata
    });
    return res;
  }

  // ────────────────────────────────────────────────────────────────────────
  // 4. PROGRAMACIÓN DE RECOLECCIÓN (PICKUP)
  // ────────────────────────────────────────────────────────────────────────
  
  /**
   * Solicita recolección al carrier
   * @param {Object} params
   * @param {string} params.tracking_number - Guía del envío
   * @param {Object} params.pickup_address - Dirección de recolección (formato CO + dane_code)
   * @param {string} params.pickup_window_start - ISO timestamp inicio ventana
   * @param {string} params.pickup_window_end - ISO timestamp fin ventana
   * @param {string} params.contact_name - Nombre contacto
   * @param {string} params.contact_phone - Teléfono contacto
   * @returns {Promise<Object>} { pickup_id, scheduled_at, carrier, status }
   */
  async schedulePickup({ tracking_number, pickup_address, pickup_window_start, pickup_window_end, contact_name, contact_phone }) {
    if (this._mockMode) {
      const pickupId = `PKP${Date.now().toString(36).toUpperCase()}`;
      return {
        pickup_id: pickupId,
        scheduled_at: pickup_window_start,
        carrier: 'inter',
        status: 'scheduled'
      };
    }

    const res = await this._fetch('/ship/pickup', 'POST', {
      tracking_number,
      pickup_address,
      pickup_window_start,
      pickup_window_end,
      contact_name,
      contact_phone
    });
    return res;
  }

  // ────────────────────────────────────────────────────────────────────────
  // 5. WEBHOOKS
  // ────────────────────────────────────────────────────────────────────────
  
  /**
   * Verifica firma de webhook Envíame (HMAC SHA256)
   * @param {string|Buffer} payload - Body raw del request
   * @param {string} signature - Header 'x-envia-signature' o similar
   * @returns {boolean}
   */
  verifyWebhook(payload, signature) {
    if (!this.webhookSecret || this._mockMode) {
      console.warn('[ENVIAMAE] Webhook secret no configurado — omitiendo verificación');
      return true; // En mock mode acepta todo
    }
    const expected = crypto.createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  /**
   * Parsea payload de webhook Envíame a formato interno
   * @param {Object} payload - Body parseado
   * @returns {Object} Evento normalizado
   */
  parseWebhookEvent(payload) {
    // Formato típico Envíame:
    // { event: 'shipment.status_update', data: { tracking_number, status, timestamp, ... } }
    return {
      provider: 'envia',
      event_id: payload.event_id || `env_${Date.now()}`,
      evento_tipo: payload.event,
      tracking_number: payload.data?.tracking_number,
      shipment_id: payload.data?.shipment_id,
      status: payload.data?.status,           // 'CREADO', 'RECOGIDO', 'EN_TRANSITO', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'
      timestamp: payload.data?.timestamp ? new Date(payload.data.timestamp) : new Date(),
      raw_payload: payload
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ────────────────────────────────────────────────────────────────────────
  
  async _fetch(path, method = 'GET', body = null) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Envíame API ${res.status}: ${errText}`);
      }
      
      return await res.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error('Envíame API timeout');
      throw err;
    }
  }

  _normalizeText(text) {
    return (text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}

// Exportar instancia singleton y clase
const enviameClient = new EnviameClient();

module.exports = {
  EnviameClient,
  enviameClient
};