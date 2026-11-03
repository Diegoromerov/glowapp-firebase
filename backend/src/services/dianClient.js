'use strict';

/**
 * Cliente HTTP real para consultar el RUT en la DIAN (MUISCA).
 *
 * Fuente: https://muisca.dian.gov.co/WebRutMuisca/DefConsultaEstadoRUT.faces
 * El servicio público de consulta de estado del RUT NO requiere autenticación.
 * Devuelve: estado (Activo/Inactivo/Suspendido), razón social, actividad económica,
 * y las responsabilidades (códigos) registradas.
 *
 * IMPORTANTE: este módulo NO simula nada. Si la API responde con error o no
 * está disponible, se lanza; nunca se fabrica una respuesta de éxito.
 */

const axios = require('axios');

const SANDBOX_BASE_URL = 'https://muisca.dian.gov.co/WebRutMuisca';
const PRODUCTION_BASE_URL = 'https://muisca.dian.gov.co/WebRutMuisca';

class DianClient {
  constructor() {
    this.timeout = parseInt(process.env.DIAN_TIMEOUT_MS, 10) || 15000;
  }

  get baseUrl() {
    if (process.env.DIAN_BASE_URL) return process.env.DIAN_BASE_URL.replace(/\/$/, '');
    return process.env.NODE_ENV === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }

  isConfigured() {
    // La consulta pública no requiere credenciales, pero se puede desactivar
    return process.env.DIAN_ENABLED !== 'false';
  }

  _assertConfigured() {
    if (!this.isConfigured()) {
      throw new Error('Consulta DIAN desactivada (DIAN_ENABLED=false).');
    }
  }

  async _request(method, path, { body, params } = {}) {
    this._assertConfigured();

    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${path}`,
        params,
        data: body,
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'GlowApp/1.0 (+https://glowapp.co)'
        }
      });
      return response.data;
    } catch (error) {
      const status = error.response?.status ?? null;
      const respuesta = error.response?.data ?? null;
      throw new Error(
        `DIAN ${method} ${path} falló (${status ?? 'sin status'}): ${JSON.stringify(respuesta || error.message)}`
      );
    }
  }

  /**
   * Consulta el estado del RUT y sus responsabilidades.
   * @param {string} numeroIdentificacion - NIT o cédula (sin puntos, con dígito de verificación si es NIT)
   * @returns {Promise<{estado: string, razonSocial: string, actividadEconomica: string, responsabilidades: number[], html: string}>}
   */
  async consultarRut(numeroIdentificacion) {
    if (!numeroIdentificacion || typeof numeroIdentificacion !== 'string') {
      throw new Error('numeroIdentificacion es obligatorio para consultar el RUT.');
    }

    const nit = numeroIdentificacion.trim().replace(/[.\s]/g, '');
    if (!nit) {
      throw new Error('numeroIdentificacion no puede estar vacío.');
    }

    try {
      // La consulta pública de MUISCA es un POST a /DefConsultaEstadoRUT.faces
      // con parámetros: vista=consultaEstadoRUT&numNit=XXXX&btnConsultar=Consultar
      const html = await this._request('POST', '/DefConsultaEstadoRUT.faces', {
        body: new URLSearchParams({
          vista: 'consultaEstadoRUT',
          numNit: nit,
          btnConsultar: 'Consultar'
        }).toString()
      });

      return this._parsearRespuesta(html, nit);
    } catch (error) {
      throw new Error(`Error consultando RUT ${nit} en DIAN: ${error.message}`);
    }
  }

  /**
   * Parsea el HTML de respuesta de MUISCA para extraer los datos relevantes.
   * @private
   */
  _parsearRespuesta(html, nit) {
    if (!html || typeof html !== 'string') {
      throw new Error('Respuesta vacía de DIAN.');
    }

    // Buscar estado del RUT (Activo/Inactivo/Suspendido)
    const estadoMatch = html.match(/Estado del RUT[^<]*<[^>]*>([^<]+)</i) ||
                        html.match(/estado\s*[=:]\s*["']?([^"'<>\n]+)/i);
    const estado = estadoMatch ? estadoMatch[1].trim() : 'DESCONOCIDO';

    // Buscar razón social
    const razonMatch = html.match(/Raz[oó]n Social[^<]*<[^>]*>([^<]+)</i) ||
                       html.match(/Raz[oó]n social[^<]*<[^>]*>([^<]+)</i);
    const razonSocial = razonMatch ? razonMatch[1].trim() : '';

    // Buscar actividad económica
    const actMatch = html.match(/Actividad Econ[oó]mica[^<]*<[^>]*>([^<]+)</i) ||
                     html.match(/CIIU[^<]*<[^>]*>([^<]+)</i);
    const actividadEconomica = actMatch ? actMatch[1].trim() : '';

    // Extraer códigos de responsabilidad (buscar patrones numéricos de 2 dígitos en tablas/listas)
    const responsabilidades = this._extraerCodigosResponsabilidad(html);

    return {
      nit,
      estado: estado.toUpperCase(),
      razonSocial,
      actividadEconomica,
      responsabilidades,
      html // guardamos el HTML crudo para auditoría
    };
  }

  /**
   * Extrae los códigos de responsabilidad del HTML.
   * Los códigos aparecen típicamente en tablas o listas como "11 - IVA", "48 - Responsable IVA", etc.
   * @private
   */
  _extraerCodigosResponsabilidad(html) {
    const codigos = new Set();

    // Patrones comunes en el HTML de MUISCA
    const patrones = [
      // <td>11</td><td>IVA</td>
      /<\s*td[^>]*>\s*(\d{2})\s*<\s*\/\s*td\s*>/gi,
      // "Código 11" o "11 - Responsable"
      /\b(\d{2})\s*[-–]\s*(?:Responsable|IVA|Renta|Consumo|Ex[óo]gena|Facturar|Autorretenedor)/gi,
      // En listas: "11" como código
      /\b(?:0[1-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9]|9[0-9])\b/g
    ];

    for (const patron of patrones) {
      let match;
      while ((match = patron.exec(html)) !== null) {
        const codigo = parseInt(match[1] || match[0], 10);
        if (codigo >= 1 && codigo <= 99) {
          codigos.add(codigo);
        }
      }
    }

    // Filtrar códigos conocidos de responsabilidad tributaria (lista no exhaustiva)
    const codigosConocidos = new Set([
      5, 7, 11, 14, 23, 42, 47, 48, 49,  // comunes
      1, 2, 3, 4, 6, 8, 9, 10, 12, 13, 15, 16, 17, 18, 19, 20,
      21, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
      41, 43, 44, 45, 46, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60
    ]);

    return Array.from(codigos).filter(c => codigosConocidos.has(c)).sort((a, b) => a - b);
  }

  /**
   * Verifica si un NIT tiene la responsabilidad de IVA (código 48) o no responsable (código 49).
   * @param {string} numeroIdentificacion
   * @returns {Promise<{tieneResponsabilidadIva: boolean|null, codigoEncontrado: number|null, estado: string, detalles: object}>}
   */
  async verificarResponsabilidadIva(numeroIdentificacion) {
    const resultado = await this.consultarRut(numeroIdentificacion);

    const codigos = resultado.responsabilidades || [];
    const tiene48 = codigos.includes(48);
    const tiene49 = codigos.includes(49);

    let responsableIva = null;
    let codigoEncontrado = null;

    if (tiene48 && !tiene49) {
      responsableIva = true;
      codigoEncontrado = 48;
    } else if (tiene49 && !tiene48) {
      responsableIva = false;
      codigoEncontrado = 49;
    } else if (tiene48 && tiene49) {
      // Inconsistencia: ambos códigos no deberían coexistir
      responsableIva = null;
      codigoEncontrado = null;
    } else {
      // No tiene ninguno de los dos códigos explícitos
      responsableIva = null;
      codigoEncontrado = null;
    }

    return {
      tieneResponsabilidadIva: responsableIva,
      codigoEncontrado,
      estado: resultado.estado,
      detalles: {
        nit: resultado.nit,
        razonSocial: resultado.razonSocial,
        actividadEconomica: resultado.actividadEconomica,
        responsabilidades: codigos
      }
    };
  }
}

const client = new DianClient();

module.exports = client;