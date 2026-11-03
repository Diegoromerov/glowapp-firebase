// backend/src/services/openUV.js
const axios = require('axios');
const redisClient = require('../config/redis');

class OpenUVClient {
  constructor() {
    this.apiKey = process.env.OPENUV_API_KEY;
    this.baseUrl = 'https://api.openuv.io/api/v1';
    this.timeout = 5000;
    this.cacheTTL = 3600; // 1 hora
  }

  /**
   * Obtiene el índice UV para una ubicación (lat, lng)
   * Con caché por ciudad (usando coordenadas redondeadas)
   */
  async getUV(lat, lng) {
    const roundedLat = Math.round(lat * 100) / 100;
    const roundedLng = Math.round(lng * 100) / 100;
    const cacheKey = `uv:${roundedLat}:${roundedLng}`;

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn('⚠️  No se pudo leer de la caché de Redis para UV:', err.message);
    }

    // Fallback de simulación si la API key no está provista
    if (!this.apiKey || this.apiKey === 'tu_api_key_aqui') {
      const mockResult = {
        uv: 5.4,
        uvMax: 7.2,
        ozone: 290.4,
        safeExposure: { st1: 25, st2: 30, st3: 40 },
        riskLevel: 'moderado',
        recommendation: 'Usa protector solar FPS 30+. Busca sombra al mediodía.',
        updatedAt: new Date().toISOString(),
      };
      return mockResult;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/uv`, {
        params: { lat: roundedLat, lng: roundedLng },
        headers: {
          'x-access-token': this.apiKey,
        },
        timeout: this.timeout,
      });

      if (response.data && response.data.result) {
        const result = {
          uv: response.data.result.uv,
          uvMax: response.data.result.uv_max,
          ozone: response.data.result.ozone,
          safeExposure: response.data.result.safe_exposure_time,
          riskLevel: this._getRiskLevel(response.data.result.uv),
          recommendation: this._getRecommendation(response.data.result.uv),
          updatedAt: new Date().toISOString(),
        };

        try {
          await redisClient.setEx(cacheKey, this.cacheTTL, JSON.stringify(result));
        } catch (err) {
          console.warn('⚠️  No se pudo escribir en la caché de Redis para UV:', err.message);
        }
        return result;
      }
      return null;
    } catch (error) {
      console.error('OpenUV error:', error.message);
      return null;
    }
  }

  _getRiskLevel(uv) {
    if (uv < 3) return 'bajo';
    if (uv < 6) return 'moderado';
    if (uv < 8) return 'alto';
    if (uv < 11) return 'muy alto';
    return 'extremo';
  }

  _getRecommendation(uv) {
    if (uv < 3) return 'Puedes estar al sol sin protección durante períodos cortos.';
    if (uv < 6) return 'Usa protector solar FPS 30+. Busca sombra al mediodía.';
    if (uv < 8) return 'Usa protector solar FPS 50+. Evita el sol entre 10 AM y 4 PM.';
    if (uv < 11) return 'Protector solar FPS 50+ cada 2 horas. Usa sombrero y gafas.';
    return 'Protector solar FPS 50+ cada hora. Permanece en interiores si es posible.';
  }
}

module.exports = new OpenUVClient();
