// backend/src/services/biometric/gemini.client.js
const axios = require('axios');
const { HANDS_ANALYSIS_PROMPT, RECOMMENDATION_PROMPT } = require('./prompts');
const { executeWithResilience } = require('../../services/resilienceService');
const { defaultPolicy } = require('../../services/resiliencePolicy');

class GeminiClient {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.timeout = 15000; // 15 segundos
    this.modelName = 'gemini-3.1-flash-lite'; // Estandarizado 100% en la app
  }

  /** Analiza una imagen de manos usando Gemini 3.1 Flash-Lite (Visión ultra-rápida y económica)
   * @param {Buffer|string} image - Imagen en base64 o buffer
   * @param {string} [traceId] - Optional trace ID for logging and correlation
   * @returns {Promise<Object>} Diagnóstico de manos
   */
  async analyzeHands(image, traceId) {
    try {
      const base64Image = typeof image === 'string' ? image : image.toString('base64');

      if (!this.apiKey || this.apiKey.includes('tu_api_key_aqui')) {
        throw new Error('Gemini API key no configurada.');
      }

      // Consulta directa a Gemini 3.1 Flash-Lite
      const response = await executeWithResilience(async () => {
        return await axios.post(
          `${this.baseUrl}/models/${this.modelName}:generateContent?key=${this.apiKey}`,
          {
            contents: [
              {
                parts: [
                  { text: HANDS_ANALYSIS_PROMPT },
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: base64Image,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 256,
            },
          },
          {
            timeout: this.timeout,
          }
        );
      }, {
        retry: defaultPolicy.retry,
        retryDelay: defaultPolicy.retryDelay,
        // Use default policy timeout (5000ms) for resilience
        circuitBreakerName: 'gemini',
        traceId: traceId,
      });

      const text = response.data.candidates[0].content.parts[0].text;
      const jsonMatch = text.match(/\\{[\\s\\S]*\\}/);
      if (!jsonMatch) {
        throw new Error('No se pudo extraer JSON de la respuesta de Gemini');
      }

      const diagnosis = JSON.parse(jsonMatch[0]);
      return {
        manchasSolares: diagnosis.manchas_solares || 'leve',
        sequedad: diagnosis.sequedad || 'leve',
        cuticulas: diagnosis.cuticulas || 'sanas',
        unas: diagnosis.uñas || diagnosis.unas || 'sanas',
        edadAparente: diagnosis.edad_aparente || 30,
      };
    } catch (error) {
      console.error('Gemini 3.1 Flash-Lite Vision error:', error.response?.data || error.message);
      throw error;
    }
  }

  getFallbackHandsDiagnosis() {
    return {
      manchasSolares: 'leve',
      sequedad: 'moderada',
      cuticulas: 'sanas',
      unas: 'sanas',
      edadAparente: 35,
    };
  }

  /** Genera recomendación personalizada usando Gemini 3.1 Flash-Lite
   * @param {Object} faceScores - Scores de YouCam
   * @param {Object} handsDiagnosis - Diagnóstico de manos
   * @param {string} [traceId] - Optional trace ID for logging and correlation
   * @returns {Promise<string>} Recomendación en texto
   */
  async generateRecommendation(faceScores, handsDiagnosis, traceId) {
    try {
      const prompt = RECOMMENDATION_PROMPT
        .replace('{hydration}', faceScores.hydration)
        .replace('{wrinkles}', faceScores.wrinkles)
        .replace('{spots}', faceScores.spots)
        .replace('{pores}', faceScores.pores)
        .replace('{subtono}', faceScores.subtono)
        .replace('{bioAge}', faceScores.bioAge)
        .replace('{handSpots}', handsDiagnosis.manchasSolares)
        .replace('{handDryness}', handsDiagnosis.sequedad)
        .replace('{cuticles}', handsDiagnosis.cuticulas)
        .replace('{nails}', handsDiagnosis.unas || handsDiagnosis.uñas || 'sanas');

      if (!this.apiKey || this.apiKey.includes('tu_api_key_aqui')) {
        throw new Error('Gemini API key no configurada.');
      }

      // Configurado globalmente con Gemini 3.1 Flash-Lite para máxima eficiencia de costos en toda la app
      const response = await executeWithResilience(async () => {
        return await axios.post(
          `${this.baseUrl}/models/${this.modelName}:generateContent?key=${this.apiKey}`,
          {
            contents: [
              {
                parts: [
                  { text: prompt },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 800,
            },
          },
          {
            timeout: this.timeout,
          }
        );
      }, {
        retry: defaultPolicy.retry,
        retryDelay: defaultPolicy.retryDelay,
        // Use default policy timeout (5000ms) for resilience
        circuitBreakerName: 'gemini',
        traceId: traceId,
      });

      return response.data.candidates[0].content.parts[0].text;
    } catch (error) {
      console.error('Gemini Text error:', error.response?.data || error.message);
      throw error;
    }
  }

  getFallbackRecommendation() {
    return `\\n**Diagnóstico general**\\nTu piel presenta niveles óptimos de hidratación y cuidado general. Te sugerimos mantener una barrera cutánea sólida y proteger las áreas expuestas al sol.\\n\\n**Rutina AM**\\n1. Limpiador facial suave\\n2. Sérum con Vitamina C o Ácido Hialurónico\\n3. Protector solar facial FPS 50+\\n\\n**Rutina PM**\\n1. Limpieza profunda\\n2. Sérum hidratante de Niacinamida\\n3. Crema de noche reparadora\\n\\n**Cuidado de Manos**\\n1. Exfoliación suave semanal\\n2. Crema reparadora con urea y ceramidas\\n\\n*Ingredientes recomendados:* Ácido hialurónico, Niacinamida, Ceramidas.\\n\\n¡La constancia es el secreto de una piel saludable!\\n`;
  }
}

module.exports = new GeminiClient();
