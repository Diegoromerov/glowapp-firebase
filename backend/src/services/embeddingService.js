/**
 * backend/src/services/embeddingService.js
 * Wrapper reutilizable para NVIDIA NIM Embeddings (nvidia/nemotron-3-embed-1b, 2048 dimensiones)
 * Incluye circuit breaker, rate limiting, validación de dimensiones, backoff exponencial
 */

const axios = require('axios');
const { breakers } = require('./circuitBreakerService');

/**
 * Configuración por defecto
 */
const DEFAULT_CONFIG = {
  // Modelo vivo por defecto (override: NVIDIA_EMBEDDING_MODEL). El valor anterior estaba
  // retirado (EOL 2026-08-25 → HTTP 410 Gone).
  model: process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nemotron-3-embed-1b',
  baseUrl: (process.env.NVIDIA_EMBED_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/embeddings$/, ''),
  apiKey: process.env.NVIDIA_API_KEY,
  expectedDimension: 2048,
  timeout: 15000,
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Valida que el embedding tenga la dimensión esperada
 * @param {number[]} embedding - Vector de embedding
 * @param {number} expectedDimension - Dimensión esperada (default 2048)
 * @throws {Error} Si la dimensión no coincide
 */
function validateEmbeddingDimension(embedding, expectedDimension = 2048) {
  if (!Array.isArray(embedding)) {
    throw new Error('Embedding no es un array');
  }
  
  if (embedding.length !== expectedDimension) {
    throw new Error(`Dimensión embedding incorrecta: esperado ${expectedDimension}, recibido ${embedding.length}`);
  }
  
  // Verificar que no sean todos ceros (embedding dummy/fallback)
  const allZeros = embedding.every(v => v === 0);
  if (allZeros) {
    console.warn('⚠️ Embedding consiste solo de ceros');
  }
  
  return true;
}

/**
 * Genera embedding usando NVIDIA NIM API con retry y backoff
 * @param {string} text - Texto a embeddizar
 * @param {'query'|'passage'} inputType - Tipo de entrada (asymmetric models)
 * @param {Object} options - Opciones de configuración
 * @returns {Promise<number[]>} Vector de embedding de 2048 dimensiones
 */
async function generateNvidiaEmbedding(text, inputType = 'query', options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  
  if (!config.apiKey) {
    throw new Error('NVIDIA_API_KEY no configurada en variables de entorno');
  }
  
  const truncatedText = text.slice(0, 8000); // Límite de la API NVIDIA
  
  let lastError;
  
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const url = `${config.baseUrl}/embeddings`;
      
      const response = await axios.post(
        url,
        {
          input: [truncatedText],
          model: config.model,
          encoding_format: 'float',
          input_type: inputType,
        },
        {
          timeout: config.timeout,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
        }
      );
      
      // Validar estructura de respuesta
      if (!response.data?.data?.[0]?.embedding) {
        throw new Error('Respuesta NVIDIA inválida: ' + JSON.stringify(response.data).slice(0, 500));
      }
      
      const embedding = response.data.data[0].embedding;
      
      // Validar dimensión
      validateEmbeddingDimension(embedding, config.expectedDimension);
      
      return embedding;
      
    } catch (error) {
      lastError = error;
      
      // Determinar si es error reintentable
      const isRetryable = error.response 
        ? [408, 429, 500, 502, 503, 504].includes(error.response.status)
        : error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND';
      
      if (!isRetryable || attempt === config.maxRetries) {
        throw error;
      }
      
      // Backoff exponencial con jitter
      const delay = Math.min(
        config.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000,
        config.maxDelayMs
      );
      
      console.warn(`⚠️ NVIDIA Embedding intento ${attempt}/${config.maxRetries} falló: ${error.message}. Reintentando en ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Genera embedding con circuit breaker integrado
 * @param {string} text - Texto a embeddizar
 * @param {'query'|'passage'} inputType - Tipo de entrada
 * @param {Object} options - Opciones
 * @returns {Promise<number[]>} Vector de embedding
 */
async function generateEmbedding(text, inputType = 'query', options = {}) {
  // R1-R4: SIN fallback. Si NVIDIA falla (o el breaker está OPEN) el error se propaga:
  //  - la ingesta falla el chunk afectado en lugar de guardar un vector falso;
  //  - el retrieval (ragService) degrada a búsqueda full-text.
  if (breakers?.nvidiaEmbeddings) {
    return breakers.nvidiaEmbeddings.execute(
      () => generateNvidiaEmbedding(text, inputType, options)
    );
  }

  return generateNvidiaEmbedding(text, inputType, options);
}

/**
 * Genera embedding dummy determinístico (fallback)
 * @param {string} text - Texto para generar embedding determinístico
 * @returns {number[]} Vector normalizado de 2048 dimensiones
 */
function generateDummyEmbedding(text) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(text).digest();
  const embedding = new Array(2048).fill(0).map((_, i) => {
    return (hash[i % 32] / 255 - 0.5) * 0.01;
  });
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return embedding.map(v => v / norm);
}

/**
 * Genera embeddings en lote con rate limiting
 * @param {string[]} texts - Array de textos
 * @param {'query'|'passage'} inputType - Tipo de entrada
 * @param {Object} options - Opciones
 * @returns {Promise<number[][]>} Array de embeddings
 */
async function generateBatchEmbeddings(texts, inputType = 'passage', options = {}) {
  const { 
    batchSize = 10, 
    delayMs = 100, // 10 chunks/seg = 100ms entre cada
    concurrency = 1 
  } = options;
  
  const results = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    // Procesar lote con concurrencia limitada
    const batchPromises = batch.map(text => generateEmbedding(text, inputType, options));
    const batchResults = await Promise.all(batchPromises);
    
    results.push(...batchResults);
    
    // Rate limiting entre lotes
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return results;
}

/**
 * Verifica disponibilidad del servicio NVIDIA
 * @returns {Promise<boolean>} True si disponible
 */
async function checkNvidiaAvailability() {
  try {
    await generateNvidiaEmbedding('test', 'query', { maxRetries: 1, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  generateEmbedding,
  generateNvidiaEmbedding,
  generateBatchEmbeddings,
  generateDummyEmbedding,
  validateEmbeddingDimension,
  checkNvidiaAvailability,
  DEFAULT_CONFIG,
};