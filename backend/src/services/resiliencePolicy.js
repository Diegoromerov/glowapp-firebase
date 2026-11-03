// backend/src/services/resiliencePolicy.js
/**
 * Default resilience policies for external service calls.
 * These values are starting points and should be validated via testing.
 */
const defaultPolicy = {
  retry: 3,
  retryDelay: 100, // base delay in ms for exponential backoff
  timeout: 5000, // timeout per attempt in ms
  circuitBreakerFailureThreshold: 3,
  circuitBreakerTimeout: 30000, // recovery timeout in ms
};

module.exports = { defaultPolicy };