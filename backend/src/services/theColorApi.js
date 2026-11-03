// backend/src/services/theColorApi.js
const axios = require('axios');

class TheColorApiClient {
  constructor() {
    this.baseUrl = 'https://www.thecolorapi.com';
    this.timeout = 3000;
  }

  /**
   * Genera una paleta de colores armónica a partir de un color base
   * @param {string} hex - Código HEX (ej. '#FF6B6B')
   * @param {number} count - Número de colores en la paleta
   * @param {string} mode - 'monochrome', 'analogic', 'complement', 'triad', 'tetrad'
   */
  async getPalette(hex, count = 5, mode = 'analogic') {
    try {
      const response = await axios.get(`${this.baseUrl}/scheme`, {
        params: {
          hex: hex.replace('#', ''),
          mode: mode,
          count: count,
          format: 'json',
        },
        timeout: this.timeout,
      });

      if (response.data && response.data.colors) {
        return response.data.colors.map(c => ({
          hex: c.hex.value,
          name: c.name.value,
          hsl: c.hsl.value,
          rgb: c.rgb.value,
        }));
      }
      return [];
    } catch (error) {
      console.error('The Color API error:', error.message);
      // Fallback a colores básicos para el subtono correspondiente
      return [
        { hex: '#E6C2A0', name: 'Almond Blush', hsl: 'hsl(30, 50%, 76%)', rgb: 'rgb(230, 194, 160)' },
        { hex: '#D4A373', name: 'Fawn Tan', hsl: 'hsl(30, 52%, 64%)', rgb: 'rgb(212, 163, 115)' },
        { hex: '#CCD5AE', name: 'Sage Green', hsl: 'hsl(73, 27%, 76%)', rgb: 'rgb(204, 213, 174)' },
        { hex: '#E8C547', name: 'Saffron Gold', hsl: 'hsl(47, 79%, 59%)', rgb: 'rgb(232, 197, 71)' },
        { hex: '#D8A47F', name: 'Peach Warmth', hsl: 'hsl(25, 52%, 67%)', rgb: 'rgb(216, 164, 127)' },
      ];
    }
  }

  /**
   * Obtiene el nombre de un color a partir de su HEX
   */
  async getColorName(hex) {
    try {
      const response = await axios.get(`${this.baseUrl}/id`, {
        params: {
          hex: hex.replace('#', ''),
          format: 'json',
        },
        timeout: this.timeout,
      });

      if (response.data && response.data.name) {
        return response.data.name.value;
      }
      return 'Color';
    } catch (error) {
      return 'Color';
    }
  }
}

module.exports = new TheColorApiClient();
