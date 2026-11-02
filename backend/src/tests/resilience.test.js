// backend/src/tests/resilience.test.js
/**
 * Tests for the resilience service.
 * We mock the circuitBreakerService and then replace its breakers object in each test.
 */

jest.mock('../services/circuitBreakerService');

describe('Resilience Service', () => {
  let mockedCBS;

  beforeEach(() => {
    jest.resetModules();
    mockedCBS = require('../services/circuitBreakerService');
    // Clear any previous calls on the mock
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Los fake timers DEBEN revertirse aunque el test falle. Si no, se filtran al resto del
    // fichero: el backoff real ya no se dispara y los tests siguientes mueren por timeout.
    // Era el caso aqui: un test roto convertia 4 en rojos y 121 s de suite.
    jest.useRealTimers();
  });

  test('should execute successful function without retries', async () => {
    // Set up the breaker state for this test
    mockedCBS.breakers = {
      test: {
        state: 'CLOSED',
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
        nextAttempt: 0,
      },
    };
    const { executeWithResilience } = require('../services/resilienceService');
    const fn = jest.fn().mockResolvedValue('success');
    const result = await executeWithResilience(fn, { retry: 2, circuitBreakerName: 'test' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('success');
    expect(mockedCBS.breakers.test.onSuccess).toHaveBeenCalledTimes(1);
    expect(mockedCBS.breakers.test.onFailure).toHaveBeenCalledTimes(0);
  });

  test('should retry specified number of times before succeeding', async () => {
    mockedCBS.breakers = {
      test: {
        state: 'CLOSED',
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
        nextAttempt: 0,
      },
    };
    const { executeWithResilience } = require('../services/resilienceService');
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');
    const result = await executeWithResilience(fn, { retry: 2, retryDelay: 10, circuitBreakerName: 'test' });
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(result).toBe('success');
    expect(mockedCBS.breakers.test.onFailure).toHaveBeenCalledTimes(2);
    expect(mockedCBS.breakers.test.onSuccess).toHaveBeenCalledTimes(1);
  });

  test('should use exponential backoff between retries', async () => {
    jest.useFakeTimers();
    jest.setTimeout(60000); // Increase timeout for this test
    mockedCBS.breakers = {
      test: {
        state: 'CLOSED',
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
        nextAttempt: 0,
      },
    };
    const { executeWithResilience } = require('../services/resilienceService');
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');
    const promise = executeWithResilience(fn, { retry: 2, retryDelay: 100, circuitBreakerName: 'test' });
    // advance timers by 100 (first delay)
    await jest.advanceTimersByTimeAsync(100);
    // advance by 200 (second delay)
    await jest.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result).toBe('success');
    jest.useRealTimers();
  });

  test('should reject when all retries exhausted and no fallback', async () => {
    jest.setTimeout(60000); // Increase timeout for this test (though it's not using fake timers, but just in case)
    mockedCBS.breakers = {
      test: {
        state: 'CLOSED',
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
        nextAttempt: 0,
      },
    };
    const { executeWithResilience } = require('../services/resilienceService');
    const fn = jest.fn().mockRejectedValue(new Error('persistent fail'));
    await expect(
      executeWithResilience(fn, { retry: 2, retryDelay: 10, circuitBreakerName: 'test' })
    ).rejects.toThrow('persistent fail');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(mockedCBS.breakers.test.onFailure).toHaveBeenCalledTimes(3);
    expect(mockedCBS.breakers.test.onSuccess).toHaveBeenCalledTimes(0);
  });

  test('should call fallback when all retries exhausted and fallback provided', async () => {
    jest.setTimeout(60000); // Increase timeout for this test
    mockedCBS.breakers = {
      test: {
        state: 'CLOSED',
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
        nextAttempt: 0,
      },
    };
    const { executeWithResilience } = require('../services/resilienceService');
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
    expect(mockedCBS.breakers.test.onFailure).toHaveBeenCalledTimes(3);
    expect(mockedCBS.breakers.test.onSuccess).toHaveBeenCalledTimes(0);
  });

  test('should respect timeout per attempt', async () => {
    jest.useFakeTimers();
    jest.setTimeout(60000); // Increase timeout for this test
    mockedCBS.breakers = {
      test: {
        state: 'CLOSED',
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
        nextAttempt: 0,
      },
    };
    const { executeWithResilience } = require('../services/resilienceService');
    const fn = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve('late'), 300)));
    const limite = executeWithResilience(fn, { retry: 1, timeout: 100, circuitBreakerName: 'test' });
    // Enganchar el handler ANTES de avanzar los timers: si se avanza primero, la promesa
    // rechaza mientras nadie la observa y jest lo reporta como rechazo sin manejar.
    const esperado = expect(limite).rejects.toThrow(/Operation timeout/);  // toMatch exige string, y lo que rechaza es un Error: no podia pasar nunca
    // El timeout por intento es un setTimeout falseado: hay que avanzarlos o nunca se asienta.
    await jest.advanceTimersByTimeAsync(1000);
    await esperado;
    // With retry:1, total attempts = 2 (initial + 1 retry)
    expect(fn).toHaveBeenCalledTimes(2);
    expect(mockedCBS.breakers.test.onFailure).toHaveBeenCalledTimes(2);
    expect(mockedCBS.breakers.test.onSuccess).toHaveBeenCalledTimes(0);
    jest.useRealTimers();
  });

  test('should open circuit breaker after failures and short-circuit calls', async () => {
    jest.setTimeout(60000); // Increase timeout for this test
    mockedCBS.breakers = {
      test: {
        state: 'OPEN',
        nextAttempt: Date.now() + 5000, // open for 5 seconds
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
      },
    };
    const { executeWithResilience } = require('../services/resilienceService');
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
    jest.setTimeout(60000); // Increase timeout for this test
    mockedCBS.breakers = {
      test: {
        state: 'OPEN',
        nextAttempt: Date.now() - 1000, // expired, should allow half-open
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
      },
    };
    const { executeWithResilience } = require('../services/resilienceService');
    const fn = jest.fn().mockResolvedValue('success');
    const result = await executeWithResilience(fn, {
      retry: 0,
      circuitBreakerName: 'test',
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('success');
    expect(mockedCBS.breakers.test.onSuccess).toHaveBeenCalledTimes(1);
  });

  test('should propagate circuit breaker open error when no fallback', async () => {
    jest.setTimeout(60000); // Increase timeout for this test
    mockedCBS.breakers = {
      test: {
        state: 'OPEN',
        nextAttempt: Date.now() + 5000,
        onSuccess: jest.fn(),
        onFailure: jest.fn(),
      },
    };
    const { executeWithResilience } = require('../services/resilienceService');
    const fn = jest.fn().mockResolvedValue('success');
    await expect(
      executeWithResilience(fn, { retry: 0, circuitBreakerName: 'test' })
    ).rejects.toThrow(/Circuit Breaker OPEN/);
    expect(fn).not.toHaveBeenCalled();
  });
});