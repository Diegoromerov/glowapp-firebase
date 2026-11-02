// backend/src/services/resilienceService.js
/**
 * Resilience Service
 * Provides a wrapper for async functions with retry, timeout, and circuit breaker integration.
 */
const { CircuitBreaker, breakers } = require('./circuitBreakerService');
const { defaultPolicy } = require('./resiliencePolicy');
const logger = require('../config/logger');

// Apply policy values to the circuit breakers (failure threshold and timeout)
Object.values(breakers).forEach(breaker => {
  breaker.failureThreshold = defaultPolicy.circuitBreakerFailureThreshold;
  breaker.cooldownPeriod = defaultPolicy.circuitBreakerTimeout;
});

/**
 * Executes an async function with resilience patterns.
 * @param {Function} asyncFunction - Function that returns a promise.
 * @param {Object} options - Configuration options.
 * @param {number} [options.retry=defaultPolicy.retry] - Number of retry attempts after the first try.
 * @param {number} [options.retryDelay=defaultPolicy.retryDelay] - Base delay in ms for exponential backoff.
 * @param {number} [options.timeout=defaultPolicy.timeout] - Timeout in ms for each attempt.
 * @param {string} [options.circuitBreakerName] - Name of the circuit breaker to use (e.g., 'youcam').
 * @param {Function} [options.fallback] - Optional fallback function to call on failure.
 * @param {string} [options.traceId] - Trace ID for logging and correlation.
 * @returns {Promise<any>} Result of the async function or fallback value.
 */
async function executeWithResilience(asyncFunction, options = {}) {
  // Use provided options or fall back to default policy
  const {
    retry = defaultPolicy.retry,
    retryDelay = defaultPolicy.retryDelay,
    timeout = defaultPolicy.timeout,
    circuitBreakerName,
    fallback,
    traceId
  } = options;

  const breaker = circuitBreakerName ? breakers[circuitBreakerName] : null;

  let lastError;
  for (let attempt = 0; attempt <= retry; attempt++) {
    // Check circuit breaker state
    if (breaker && breaker.state === 'OPEN') {
      if (Date.now() > breaker.nextAttempt) {
        breaker.state = 'HALF-OPEN';
        // Allow one trial request
        logger.debug('Circuit breaker half-open', { 
          circuitBreakerName, 
          attempt, 
          traceId 
        });
      } else {
        // Circuit is open, return fallback immediately if available
        if (fallback) {
          logger.warn('Circuit breaker open, using fallback', { 
            circuitBreakerName, 
            attempt, 
            traceId 
          });
          return fallback();
        }
        logger.warn('Circuit breaker open, no fallback available', { 
          circuitBreakerName, 
          attempt, 
          traceId 
        });
        return Promise.reject(new Error(`Circuit Breaker OPEN for ${circuitBreakerName}`));
      }
    }

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Operation timeout')), timeout)
      );
      // Race the async function against the timeout
      const result = await Promise.race([
        asyncFunction(),
        timeoutPromise
      ]);
      // Success: notify circuit breaker and log
      if (breaker) {
        breaker.onSuccess();
      }
      logger.debug('Operation succeeded', { 
        circuitBreakerName, 
        attempt, 
        traceId 
      });
      return result;
    } catch (error) {
      lastError = error;
      // Notify circuit breaker of failure
      if (breaker) {
        breaker.onFailure(error);
      }
      logger.warn('Operation failed', { 
        circuitBreakerName, 
        attempt, 
        error: error.message,
        traceId 
      });
      // If we have retries left, wait and try again
      if (attempt < retry) {
        // Exponential backoff: retryDelay * 2^attempt
        const delay = retryDelay * Math.pow(2, attempt);
        logger.debug('Retrying after delay', { 
          attempt, 
          delay, 
          traceId 
        });
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      // No more retries, exit loop
      break;
    }
  }

  // All retries exhausted
  if (fallback) {
    logger.warn('All retries exhausted, using fallback', { 
      attempt: retry + 1, 
      traceId 
    });
    return fallback();
  }
  logger.error('All retries exhausted, no fallback available', { 
    attempt: retry + 1, 
    error: lastError?.message,
    traceId 
  });
  return Promise.reject(lastError);
}

module.exports = { executeWithResilience };