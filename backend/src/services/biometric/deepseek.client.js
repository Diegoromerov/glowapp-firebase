// backend/src/services/biometric/deepseek.client.js
const axios = require('axios');
const { RECOMMENDATION_PROMPT } = require('./prompts');

class DeepSeekClient {
  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENROUTER_API_KEY;
    this.baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
    this.timeout = 10000; // 10 segundos
    this.modelName = process.env.DEEPSEEK_MODEL || 'deepseek-chat'; // DeepSeek-V3/V4 Flash
  }

  /**
   * Genera recomendación personalizada y análisis cosmetológico/VTO con DeepSeek V4 Flash
   * @param {Object} faceScores - Scores de YouCam
   * @param {Object} handsDiagnosis - Diagnóstico de manos (Gemini 3.1)
   * @returns {Promise<string>} Recomendación clínica y cosmetológica en texto/markdown
   */
  async generateRecommendation(faceScores, handsDiagnosis) {
    try {
      const prompt = RECOMMENDATION_PROMPT
        .replace('{hydration}', faceScores.hydration)
        .replace('{wrinkles}', faceScores.wrinkles)
        .replace('{spots}', faceScores.spots)
        .replace('{pores}', faceScores.pores)
        .replace('{subtono}', faceScores.subtono || 'neutro')
        .replace('{bioAge}', faceScores.bioAge || 30)
        .replace('{handSpots}', handsDiagnosis.manchasSolares || 'leve')
        .replace('{handDryness}', handsDiagnosis.sequedad || 'leve')
        .replace('{cuticles}', handsDiagnosis.cuticulas || 'sanas')
        .replace('{nails}', handsDiagnosis.unas || handsDiagnosis.uñas || 'sanas');

      if (!this.apiKey || this.apiKey.includes('tu_api_key')) {
        throw new Error('DeepSeek API key no configurada.');
      }

      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.modelName,
          messages: [
            {
              role: 'system',
              content: 'Eres un experto cosmetólogo y dermatólogo senior de Beauty-App. Genera recomendaciones clínicas, de rutina facial y de combinaciones de maquillaje/VTO precisas y empáticas.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.6,
          max_tokens: 800,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: this.timeout,
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Respuesta vacía de DeepSeek V4 Flash API');
      }

      return content;
    } catch (error) {
      console.error('❌ [DEEPSEEK API ERROR]:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Genera recomendaciones de tonos VTO (Labiales, Esmaltes, Sombras) basadas en subtono biométrico
   * @param {string} subtono - 'cálido', 'frío', 'neutro'
   * @returns {Promise<Object>} Tonos HEX y paletas recomendadas
   */
  async getVtoToneMatching(subtono) {
    try {
      if (!this.apiKey || this.apiKey.includes('tu_api_key')) {
        throw new Error('DeepSeek API key no configurada.');
      }

      const prompt = `Analiza el subtono cutáneo "${subtono}" y responde EXCLUSIVAMENTE en JSON válido con el siguiente formato:
{
  "subtono": "${subtono}",
  "lipsticks": [
    { "name": "Coral Sunset", "hex": "#E05A47", "finish": "Mate", "description": "Tono ideal para subtono cálido" },
    { "name": "Nude Gold", "hex": "#C88A68", "finish": "Satinado", "description": "Resalta la calidez natural" }
  ],
  "nails": [
    { "name": "Terracota Chic", "hex": "#B84A39", "style": "Almond" },
    { "name": "Dorado Glam", "hex": "#D4AF37", "style": "Square" }
  ]
}`;

      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.modelName,
          messages: [
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 400,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: this.timeout,
        }
      );

      const text = response.data?.choices?.[0]?.message?.content;
      return JSON.parse(text);
    } catch (error) {
      console.error('❌ [DEEPSEEK VTO MATCHING ERROR]:', error.message);
      throw error;
    }
  }

  getFallbackVtoTones(subtono) {
    const isWarm = (subtono || '').toLowerCase().includes('cál');
    return {
      subtono: subtono || 'neutro',
      lipsticks: isWarm ? [
        { name: 'Coral Rose', hex: '#E05A47', finish: 'Mate', description: 'Realza matices dorados' },
        { name: 'Warm Nude', hex: '#C88A68', finish: 'Satinado', description: 'Elegancia cotidiana' },
      ] : [
        { name: 'Berry Crush', hex: '#9E2A2B', finish: 'Brillante', description: 'Armonía con tonos fríos' },
        { name: 'Pink Rose', hex: '#D87093', finish: 'Mate', description: 'Contraste suave' },
      ],
      nails: isWarm ? [
        { name: 'Terracota Warm', hex: '#B84A39', style: 'Almond' },
        { name: 'Glitter Gold', hex: '#D4AF37', style: 'Square' },
      ] : [
        { name: 'French Classic', hex: '#FFF0F5', style: 'Oval' },
        { name: 'Deep Burgundy', hex: '#4A0E17', style: 'Coffin' },
      ]
    };
  }

  getFallbackRecommendation() {
    return `
**Diagnóstico Biométrico & Cuidado Personalizado**
Tu piel presenta una barrera cutánea activa. Con base en tu biometría y radiación solar ambiental, te sugerimos una rutina de protección y nutrición diaria.

**Rutina Recomendada AM**
1. Limpiador facial suave equilibrante.
2. Sérum con Niacinamida o Vitamina C para uniformar el tono.
3. Fotoprotector solar FPS 50+ de amplio espectro.

**Rutina Recomendada PM**
1. Doble limpieza facial.
2. Sérum con Ácido Hialurónico e hidratación nocturna.
3. Crema restauradora de barrera con Ceramidas.

**Cuidado Especializado de Manos**
1. Exfoliación suave semanal.
2. Crema nutritiva con Manteca de Karité y Ceramidas.

*Ingredientes sugeridos:* Ácido hialurónico, Niacinamida, Ceramidas.
    `;
  }
}

module.exports = new DeepSeekClient();
