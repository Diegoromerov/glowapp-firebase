// backend/src/tests/resilience.service.test.js
/**
 * Tests for the resilience service using the real circuitBreakerService.
 * We reset the circuit breaker state before each test.
 */

const { executeWithResilience } = require('../services/resilienceService');
const { CircuitBreaker, breakers } = require('../services/circuitBreakerService');

describe('Resilience Service', () => {
  let onSuccessSpy;
  let onFailureSpy;

  beforeEach(() => {
    // Reset all existing breakers to a known state
    Object.keys(breakers).forEach(key => {
      const breaker = breakers[key];
      breaker.state = 'CLOSED';
      breaker.failureCount = 0;
      breaker.nextAttempt = Date.now();
    });
    // Ensure we have a test breaker
    if (!breakers.test) {
      breakers.test = new CircuitBreaker('test');
    }
    // Get the test breaker and set up spies on its methods
    const breaker = breakers.test;
    onSuccessSpy = jest.spyOn(breaker, 'onSuccess');
    onFailureSpy = jest.spyOn(breaker, 'onFailure');
  });

  afterEach(() => {
    // Restore the spies
    onSuccessSpy.mockRestore();
    onFailureSpy.mockRestore();
  });

  test('should execute successful function without retries', async () => {
    // Set the test breaker to CLOSED
    breakers.test.state = 'CLOSED';
    const fn = jest.fn().mockResolvedValue('success');
    const result = await executeWithResilience(fn, { retry: 2, circuitBreakerName: 'test' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('success');
    expect(onSuccessSpy).toHaveBeenCalledTimes(1);
    expect(onFailureSpy).toHaveBeenCalledTimes(0);
  });

  test('should retry specified number of times before succeeding', async () => {
    breakers.test.state = 'CLOSED';
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');
    const result = await executeWithResilience(fn, { retry: 2, retryDelay: 10, circuitBreakerName: 'test' });
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(result).toBe('success');
    expect(onFailureSpy).toHaveBeenCalledTimes(2);
    expect(onSuccessSpy).toHaveBeenCalledTimes(1);
  });

  test('should use exponential backoff between retries', async () => {
    // Use small delays to make test fast
    const retryDelay = 1; // 1 ms
    breakers.test.state = 'CLOSED';
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');
    const start = Date.now();
    const result = await executeWithResilience(fn, { retry: 2, retryDelay, circuitBreakerName: 'test' });
    const end = Date.now();
    const elapsed = end - start;
    // Expected minimum delay: first retry after 1ms, second after 2ms, total at least 3ms
    // We'll allow some variance due to setTimeout imprecision, but should be less than, say, 100ms
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result).toBe('success');
    expect(elapsed).toBeGreaterThanOrEqual(3);
    expect(elapsed).toBeLessThan(100); // generous upper bound
  });

  test('should reject when all retries exhausted and no fallback', async () => {
    breakers.test.state = 'CLOSED';
    const fn = jest.fn().mockRejectedValue(new Error('persistent fail'));
    await expect(
      executeWithResilience(fn, { retry: 2, retryDelay: 10, circuitBreakerName: 'test' })
    ).rejects.toThrow('persistent fail');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onFailureSpy).toHaveBeenCalledTimes(3);
    expect(onSuccessSpy).toHaveBeenCalledTimes(0);
  });

  test('should call fallback when all retries exhausted and fallback provided', async () => {
    breakers.test.state = 'CLOSED';
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const fallback = jest.fn().mockReturnValue('fallback value');
    const result = await executeWithResilience(fn, {
      retry: 2,
      retryDelay: 10,
      circuitBreakerName: 'test',
      fallback,
    });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(result).toBe('fallback value');
    expect(onFailureSpy).toHaveBeenCalledTimes(3);
    expect(onSuccessSpy).toHaveBeenCalledTimes(0);
  });

  test('should respect timeout per attempt', async () => {
    // Use a short timeout to make test fast
    breakers.test.state = 'CLOSED';
    const fn = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve('late'), 50)));
    await expect(
      executeWithResilience(fn, { retry: 1, timeout: 10, circuitBreakerName: 'test' })
    ).rejects.toThrow(/Operation timeout/);
    // With retry:1, total attempts = 2 (initial + 1 retry)
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onFailureSpy).toHaveBeenCalledTimes(2);
    expect(onSuccessSpy).toHaveBeenCalledTimes(0);
  });

  test('should open circuit breaker after failures and short-circuit calls', async () => {
    // Set the breaker to OPEN state
    breakers.test.state = 'OPEN';
    breakers.test.nextAttempt = Date.now() + 5000; // open for 5 seconds
    const fn = jest.fn().mockResolvedValue('should not be called');
    const fallback = jest.fn().mockReturnValue('fallback');
    const result = await executeWithResilience(fn, {
      retry: 3,
      circuitBreakerName: 'test',
      fallback,
    });
    expect(fn).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(result).toBe('fallback');
    // No calls to onSuccess/onFailure expected because the function wasn't called.
  });

  test('should allow half-open trial request after timeout', async () => {
    // Set the breaker to OPEN with expired nextAttempt
    breakers.test.state = 'OPEN';
    breakers.test.nextAttempt = Date.now() - 1000; // expired, should allow half-open
    const fn = jest.fn().mockResolvedValue('success');
    const result = await executeWithResilience(fn, {
      retry: 0,
      circuitBreakerName: 'test',
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('success');
    expect(onSuccessSpy).toHaveBeenCalledTimes(1);
  });

  test('should propagate circuit breaker open error when no fallback', async () => {
    breakers.test.state = 'OPEN';
    breakers.test.nextAttempt = Date.now() + 5000;
    const fn = jest.fn().mockResolvedValue('success');
    await expect(
      executeWithResilience(fn, { retry: 0, circuitBreakerName: 'test' })
    ).rejects.toThrow(/Circuit Breaker OPEN/);
    expect(fn).not.toHaveBeenCalled();
  });

  test('should open circuit breaker state to OPEN after exactly 3 consecutive failures', async () => {
    const breaker = breakers.youcam;
    breaker.reset();
    expect(breaker.failureThreshold).toBe(3);
    expect(breaker.state).toBe('CLOSED');

    breaker.onFailure(new Error('fail 1'));
    expect(breaker.state).toBe('CLOSED');

    breaker.onFailure(new Error('fail 2'));
    expect(breaker.state).toBe('CLOSED');

    breaker.onFailure(new Error('fail 3'));
    expect(breaker.state).toBe('OPEN');
  });
});