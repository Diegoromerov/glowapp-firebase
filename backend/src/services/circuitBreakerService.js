// backend/src/services/circuitBreakerService.js
/**
 * Circuit Breaker Service (ADR-001 Sprint 2.3)
 * Protege llamadas a servicios externos de IA/VTO (YouCam, Gemini, DeepSeek) evitando degradación en cascada.
 */
class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 3; // fallos seguidos para abrir el circuito
    this.cooldownPeriod = options.cooldownPeriod || 30000;  // 30 segundos en estado OPEN antes de probar HALF-OPEN
    
    this.state = 'CLOSED'; // 'CLOSED', 'OPEN', 'HALF-OPEN'
    this.failureCount = 0;
    this.nextAttempt = Date.now();
  }

  async execute(asyncFunction, fallbackFunction) {
    if (this.state === 'OPEN') {
      if (Date.now() > this.nextAttempt) {
        this.state = 'HALF-OPEN';
        console.log(`🔌 [CIRCUIT_BREAKER] ${this.name} entrando en estado HALF-OPEN (probando recuperación)`);
      } else {
        console.warn(`⚡ [CIRCUIT_BREAKER] ${this.name} está OPEN. Redirigiendo inmediatamente al fallback.`);
        return fallbackFunction ? fallbackFunction() : Promise.reject(new Error(`Circuit Breaker OPEN for ${this.name}`));
      }
    }

    try {
      const result = await asyncFunction();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      if (fallbackFunction) {
        console.warn(`⚠️ [CIRCUIT_BREAKER] Executando fallback para ${this.name} debido a error: ${error.message}`);
        return fallbackFunction(error);
      }
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF-OPEN') {
      this.state = 'CLOSED';
      console.log(`✅ [CIRCUIT_BREAKER] ${this.name} recuperado exitosamente. Estado: CLOSED`);
    }
  }

  onFailure(error) {
    this.failureCount++;
    console.error(`❌ [CIRCUIT_BREAKER] Fallo #${this.failureCount} en ${this.name}: ${error.message}`);

    if (this.failureCount >= this.failureThreshold || this.state === 'HALF-OPEN') {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.cooldownPeriod;
      console.error(`🚨 [CIRCUIT_BREAKER] ${this.name} ha ABIERTO el circuito. Cooldown: ${this.cooldownPeriod}ms`);
    }
  }

  /**
   * Resetea el circuit breaker a estado inicial (CLOSED)
   * Útil para tests
   */
  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.nextAttempt = Date.now();
  }
}

const breakers = {
  youcam: new CircuitBreaker('YouCam SDK'),
  gemini: new CircuitBreaker('Gemini Vision'),
  deepseek: new CircuitBreaker('DeepSeek Embeddings/Recs'),
  // RAG (port R1-R4): NVIDIA NIM embeddings. Se registra SIN fallback a propósito:
  // si NVIDIA falla, el error se propaga y el retrieval degrada a full-text
  // (ragService) en lugar de buscar con un vector sin valor semántico.
  nvidiaEmbeddings: new CircuitBreaker('NVIDIA Embeddings'),
};

module.exports = {
  CircuitBreaker,
  breakers,
};