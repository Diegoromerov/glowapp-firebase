// backend/src/services/enviameClient.js
// Cliente Envíame multi-carrier — F1 Logística
// Placeholder/mock para desarrollo; integración real cuando haya credenciales

const crypto = require('crypto');

class EnviameClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.ENVIAME_BASE_URL || 'https://api.envia.com/v1';
    this.apiKey = options.apiKey ?? process.env.ENVIAME_API_KEY;
    this.webhookSecret = options.webhookSecret ?? process.env.ENVIAME_WEBHOOK_SECRET;
    this.timeout = options.timeout || 30000;
    this.pool = options.pool || null; // Pool de BD para routing rules y municipios_dane
    
    const production = process.env.NODE_ENV === 'production';
    this._mockMode = !production && (!this.apiKey || /placeholder|mock/i.test(this.apiKey));
    
    if (this._mockMode) {
      console.warn('[ENVIAMAE] ⚠️ MODO MOCK: Sin API key real. Respuestas simuladas.');
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1. VALIDACIÓN DE DIRECCIONES (DANE codes) — usa municipios_dane table
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Valida y normaliza una dirección colombiana, retorna código DANE
   * @param {Object} params
   * @param {string} params.city - Ciudad (ej: 'Bogotá', 'Medellín')
   * @param {string} params.state - Código DANE departamento 2 dígitos (ej: '11', '05')
   * @param {string} params.country - Siempre 'CO'
   * @param {string} params.postal_code - Código postal 6 dígitos
   * @param {string} params.street - Dirección completa
   * @returns {Promise<Object>} { valid, dane_code, normalized_address, city, state, zona_envio_id }
   */
  async validateAddress({ city, state, country = 'CO', postal_code, street }) {
    if (String(country).toUpperCase() !== 'CO') {
      return { valid: false, reason: 'Solo se admiten direcciones de Colombia' };
    }

    // Try DB lookup first (municipios_dane table)
    if (this.pool) {
      const res = await this._findMunicipality(city, state);
      if (res) {
        return {
          valid: true,
          dane_code: res.dane_code,
          normalized_address: street,
          city: res.nombre,
          state: res.departamento_codigo,
          country: 'CO',
          zona_envio_id: res.zona_envio_id
        };
      }
    }

    if (this._mockMode) {
      return {
        valid: false,
        reason: this.pool
          ? 'Municipio o departamento no encontrado en DIVIPOLA'
          : 'Catálogo DIVIPOLA no disponible'
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
    if (this.pool) {
      const row = await this._findMunicipality(city, state);
      if (row) return { city: row.nombre, dane_code: row.dane_code, state: row.departamento_codigo };
    }

    if (this._mockMode) {
      throw new Error(this.pool ? 'Municipio o departamento no encontrado en DIVIPOLA' : 'Catálogo DIVIPOLA no disponible');
    }
    const res = await this._fetch(`/locate/colombia/city?city=${encodeURIComponent(city)}&state=${state}&country=CO`, 'GET');
    return res;
  }

  // ────────────────────────────────────────────────────────────────────────
  // 2. COTIZACIÓN MULTI-CARRIER (Rate Shopping) — usa shipping_routing_rules
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
    const destDane = await this._resolveDaneCode(destination);
    const totalWeight = parcels.reduce((sum, p) => sum + Number(p.weight_kg ?? p.weight ?? 0.5), 0);
    const totalValue = value_cop || 0;

    // Try DB routing rules first
    let routingRules = [];
    if (this.pool) {
      try {
        // Get zona_envio_id from destination municipio
        const zonaRes = await this.pool.query(
          `SELECT zona_envio_id FROM municipios_dane WHERE dane_code = $1 AND activo = true`,
          [destDane]
        );
        let zonaId = zonaRes.rows[0]?.zona_envio_id;
        if (!zonaId) {
          const fallbackZona = await this.pool.query(
            `SELECT id FROM zonas_envio
              WHERE activa AND translate(lower(ciudad), 'áéíóúüñ', 'aeiouun') = 'otro'
              ORDER BY creado_en ASC LIMIT 1`
          );
          zonaId = fallbackZona.rows[0]?.id;
        }

        if (zonaId) {
          const rulesRes = await this.pool.query(
            `SELECT carrier, carrier_service_code, carrier_account_id, prioridad,
                    peso_min_kg, peso_max_kg, valor_min_cop, valor_max_cop, dias_maximos_entrega
             FROM shipping_routing_rules
             WHERE zona_id = $1 AND activo = true
             ORDER BY prioridad`,
            [zonaId]
          );
          routingRules = rulesRes.rows;
        }

        // Municipios sin reglas propias heredan las reglas de OTRO (fallback
        // nacional), en vez de inventar otra tarifa por fuera de la tabla.
        if (routingRules.length === 0) {
          const fallbackZona = await this.pool.query(
            `SELECT id FROM zonas_envio
              WHERE activa AND translate(lower(ciudad), 'áéíóúüñ', 'aeiouun') = 'otro'
              ORDER BY creado_en ASC LIMIT 1`
          );
          const fallbackZonaId = fallbackZona.rows[0]?.id;
          if (fallbackZonaId && fallbackZonaId !== zonaId) {
            const fallbackRules = await this.pool.query(
              `SELECT carrier, carrier_service_code, carrier_account_id, prioridad,
                      peso_min_kg, peso_max_kg, valor_min_cop, valor_max_cop, dias_maximos_entrega
                 FROM shipping_routing_rules
                WHERE zona_id = $1 AND activo = true
                ORDER BY prioridad`,
              [fallbackZonaId]
            );
            routingRules = fallbackRules.rows;
          }
        }
      } catch (err) {
        console.warn('[ENVIAMAE] DB routing rules failed:', err.message);
      }
    }

    if (!this._mockMode) {
      throw new Error('La cotización real de transportadoras aún no está habilitada; no se generó una tarifa simulada para producción');
    }

    if (routingRules.length === 0) {
      // Fallback solo para desarrollo sin reglas sembradas: una tarifa genérica,
      // sin asociar códigos DANE a precios o transportadoras inventados.
      const rule = { carrier: 'coordinadora', service: 'coord_paq', base: 15000, days: [3,6] };
      const weightSurcharge = Math.max(0, totalWeight - 1) * 800; // 800 COP/kg extra
      const valueSurcharge = totalValue > 1000000 ? totalValue * 0.001 : 0; // 0.1% seguro > 1M

      return [
        {
          carrier: rule.carrier,
          service_code: rule.service,
          prioridad: 1,
          rate_id: `mock-${rule.carrier}-${rule.service}-1`,
          rate_cop: Math.round(rule.base + weightSurcharge + valueSurcharge),
          days_min: rule.days[0],
          days_max: rule.days[1],
          pickup_available: true,
          dropoff_available: true
        },
        {
          carrier: 'envia',
          service_code: 'envia_estandar',
          prioridad: 2,
          rate_id: 'mock-envia-envia_estandar-2',
          rate_cop: Math.round(rule.base + 2000 + weightSurcharge + valueSurcharge),
          days_min: rule.days[0] + 1,
          days_max: rule.days[1] + 2,
          pickup_available: true,
          dropoff_available: true
        },
        {
          carrier: 'envia',
          service_code: 'envia_economico',
          prioridad: 3,
          rate_id: 'mock-envia-envia_economico-3',
          rate_cop: Math.round(rule.base - 1000 + weightSurcharge + valueSurcharge),
          days_min: rule.days[0] + 2,
          days_max: rule.days[1] + 3,
          pickup_available: true,
          dropoff_available: true
        }
      ];
    }

    // Reglas activas desde la base, ordenadas por prioridad y filtradas arriba.
    const rates = [];
    for (const rule of routingRules) {
      // Validate weight range
      if (rule.peso_min_kg != null && totalWeight < Number(rule.peso_min_kg)) continue;
      if (rule.peso_max_kg != null && totalWeight > Number(rule.peso_max_kg)) continue;
      // Validate value range
      if (rule.valor_min_cop != null && totalValue < Number(rule.valor_min_cop)) continue;
      if (rule.valor_max_cop != null && totalValue > Number(rule.valor_max_cop)) continue;

      // Mock rate calculation based on rule (real would call carrier API)
      const baseRate = this._estimateBaseRate(rule.carrier, rule.carrier_service_code, destDane);
      const weightSurcharge = Math.max(0, totalWeight - 1) * 800;
      const valueSurcharge = totalValue > 1000000 ? totalValue * 0.001 : 0;
      const daysMax = Number(rule.dias_maximos_entrega) || 6;

      rates.push({
        carrier: rule.carrier,
        service_code: rule.carrier_service_code,
        carrier_account_id: rule.carrier_account_id,
        prioridad: Number(rule.prioridad),
        rate_id: `mock-${rule.carrier}-${rule.carrier_service_code}-${rule.prioridad}`,
        rate_cop: Math.round(baseRate + weightSurcharge + valueSurcharge),
        days_min: Math.max(1, daysMax - 1),
        days_max: daysMax,
        pickup_available: true,
        dropoff_available: true
      });
    }

    if (rates.length === 0) {
      throw new Error(`No hay reglas de envío activas aplicables al municipio ${destDane} para el peso y valor indicados`);
    }

    return rates;
  }

  _estimateBaseRate(carrier, serviceCode, destDane) {
    // Estimaciones base por carrier/servicio (mock para cuando no hay API real)
    const bases = {
      'inter': { 'inter_express': 12000, 'inter_estandar': 9000 },
      'coordinadora': { 'coord_paq': 13000, 'coord_estandar': 10000 },
      'servientrega': { 'servi_estandar': 11000, 'servi_economico': 8000 },
      'tcc': { 'tcc_express': 14000, 'tcc_estandar': 11000 },
      'envia': { 'envia_express': 13000, 'envia_estandar': 10000, 'envia_economico': 7000 }
    };
    return bases[carrier]?.[serviceCode] || 12000;
  }

  // ────────────────────────────────────────────────────────────────────────
  // 3. GENERACIÓN DE ETIQUETAS — usa routing rules para carrier/service
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
        carrier: metadata.carrier || 'inter',
        service_code: metadata.service_code || 'inter_express',
        carrier_account_id: metadata.carrier_account_id || 'mock-account-id'
      };
    }

    if (!rate_id) throw new Error('No se puede generar una etiqueta real sin un rate_id confirmado por la transportadora');

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
  async schedulePickup({ tracking_number, pickup_address, pickup_window_start, pickup_window_end, contact_name, contact_phone, carrier }) {
    if (this._mockMode) {
      const pickupId = `PKP${Date.now().toString(36).toUpperCase()}`;
      return {
        pickup_id: pickupId,
        scheduled_at: pickup_window_start,
        carrier: carrier || 'inter',
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
    if (this._mockMode) return true;
    if (!this.webhookSecret || !signature) return false;
    const expected = crypto.createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');
    const receivedBuffer = Buffer.from(String(signature), 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return receivedBuffer.length === expectedBuffer.length
      && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
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
    if (!this.apiKey) throw new Error('ENVIAME_API_KEY no está configurada');
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

  async _findMunicipality(city, state) {
    if (!city) return null;
    const normalizedCity = this._normalizeText(city);
    const normalizedState = this._normalizeText(state);
    const result = await this.pool.query(
      `SELECT dane_code, nombre, departamento_codigo, departamento_nombre, zona_envio_id
         FROM municipios_dane
        WHERE activo = true
          AND (dane_code = $1 OR translate(lower(nombre), 'áéíóúüñ', 'aeiouun') = $2)
          AND ($3 = '' OR departamento_codigo = $3
               OR translate(lower(departamento_nombre), 'áéíóúüñ', 'aeiouun') = $4)
        ORDER BY dane_code
        LIMIT 1`,
      [String(city).trim(), normalizedCity, /^\d{2}$/.test(String(state || '')) ? String(state) : '', normalizedState]
    );
    return result.rows?.[0] || null;
  }

  async _resolveDaneCode(address = {}) {
    const city = String(address.city || '').trim();
    if (this.pool) {
      const row = await this._findMunicipality(city, address.state);
      if (row) return row.dane_code;
      throw new Error(`No se encontró el municipio DANE para la dirección: ${city || '(vacía)'}`);
    }
    if (/^\d{5}$/.test(city)) return city;
    throw new Error(`No se encontró el municipio DANE para la dirección: ${city || '(vacía)'}`);
  }
}

// Exportar instancia singleton y clase
const enviameClient = new EnviameClient();

module.exports = {
  EnviameClient,
  enviameClient
};
