const axios = require('axios');

// URL del worker de Python (ajustar según entorno: local o Railway)
const PYTHON_WORKER_URL = process.env.PYTHON_WORKER_URL || 'http://localhost:8000';

async function processBiometricScan(imageBase64) {
  try {
    console.log('🧠 Iniciando análisis biométrico con AI Worker...');
    
    const response = await axios.post(`${PYTHON_WORKER_URL}/api/v1/analyze-skin`, {
      image_base64: imageBase64
    }, {
      timeout: 5000 // 5 segundos máximo de espera
    });

    return response.data;
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      throw new Error('El análisis IA está tomando más tiempo del esperado.');
    }
    console.error('❌ Error comunicándose con AI Worker:', error.message);
    const unavailable = new Error('No se pudo completar el análisis de piel.');
    unavailable.statusCode = 503;
    unavailable.code = 'BIOMETRIC_ANALYSIS_UNAVAILABLE';
    throw unavailable;
  }
}

module.exports = { processBiometricScan };
