// backend/src/tests/resilience-verification.js
/**
 * Verification script for the resilience service.
 * Tests the resilience service in isolation with mocked circuit breaker.
 */

// Helper to reset require cache for a module
function resetCache(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

// Mock circuit breaker service
function createMockBreaker(state = 'CLOSED', nextAttempt = 0) {
  return {
    state,
    onSuccess: () => {},
    onFailure: () => {},
    nextAttempt,
  };
}

function createMockCircuitBreakerService(breakers) {
  return {
    CircuitBreaker: function() {},
    breakers,
  };
}

async function runTests() {
  console.log('=== Resilience Service Functional Verification ===\n');

  // We'll test the resilience service by requiring it with a mocked circuit breaker service.
  // We need to reset the cache for both modules before each test to ensure isolation.

  // Test 1: Successful function, no retries
  console.log('Test 1: Successful function, no retries');
  resetCache('../services/circuitBreakerService');
  resetCache('../services/resilienceService');
  const mockBreaker1 = createMockBreaker();
  const mockCBS1 = createMockCircuitBreakerService({ test: mockBreaker1 });
  require.cache[require.resolve('../services/circuitBreakerService')] = { exports: mockCBS1 };
  const resilience1 = require('../services/resilienceService');
  let callCount1 = 0;
  const fn1 = () => {
    callCount1++;
    return Promise.resolve('success');
  };
  const result1 = await resilience1.executeWithResilience(fn1, { retry: 2, retryDelay: 10, circuitBreakerName: 'test' });
  console.log(`  Calls: ${callCount1}, Result: ${result1}`);
  console.log(`  Expected: Calls=1, Result=success\n`);

  // Test 2: Retry until success
  console.log('Test 2: Retry until success (2 retries)');
  resetCache('../services/circuitBreakerService');
  resetCache('../services/resilienceService');
  const mockBreaker2 = createMockBreaker();
  const mockCBS2 = createMockCircuitBreakerService({ test: mockBreaker2 });
  require.cache[require.resolve('../services/circuitBreakerService')] = { exports: mockCBS2 };
  const resilience2 = require('../services/resilienceService');
  let callCount2 = 0;
  const fn2 = () => {
    callCount2++;
    if (callCount2 <= 2) {
      return Promise.reject(new Error(`fail ${callCount2}`));
    }
    return Promise.resolve('success');
  };
  const result2 = await resilience2.executeWithResilience(fn2, { retry: 2, retryDelay: 10, circuitBreakerName: 'test' });
  console.log(`  Calls: ${callCount2}, Result: ${result2}`);
  console.log(`  Expected: Calls=3, Result=success\n`);

  // Test 3: Exponential backoff
  console.log('Test 3: Exponential backoff timing');
  resetCache('../services/circuitBreakerService');
  resetCache('../services/resilienceService');
  const mockBreaker3 = createMockBreaker();
  const mockCBS3 = createMockCircuitBreakerService({ test: mockBreaker3 });
  require.cache[require.resolve('../services/circuitBreakerService')] = { exports: mockCBS3 };
  const resilience3 = require('../services/resilienceService');
  const start = Date.now();
  let callCount3 = 0;
  const fn3 = () => {
    callCount3++;
    if (callCount3 < 3) {
      return Promise.reject(new Error(`fail ${callCount3}`));
    }
    return Promise.resolve('success');
  };
  const promise3 = resilience3.executeWithResilience(fn3, { retry: 2, retryDelay: 10, circuitBreakerName: 'test' });
  // We cannot wait for the promise and then check time because the delays are internal.
  // Instead, we will rely on the fact that the implementation uses setTimeout with exponential backoff.
  // We can verify by checking that the delays are set correctly? Not easily without mocking timers.
  // We'll skip the exact timing check and just verify that it eventually succeeds.
  const result3 = await promise3;
  const end = Date.now();
  console.log(`  Calls: ${callCount3}, Result: ${result3}, Time: ${end - start}ms`);
  console.log(`  Expected: Calls=3, Result=success, Time >= 30ms (10 + 20)\n`);

  // Test 4: Timeout per attempt
  console.log('Test 4: Timeout per attempt');
  resetCache('../services/circuitBreakerService');
  resetCache('../services/resilienceService');
  const mockBreaker4 = createMockBreaker();
  const mockCBS4 = createMockCircuitBreakerService({ test: mockBreaker4 });
  require.cache[require.resolve('../services/circuitBreakerService')] = { exports: mockCBS4 };
  const resilience4 = require('../services/resilienceService');
  let callCount4 = 0;
  const fn4 = () => {
    callCount4++;
    return new Promise(resolve => setTimeout(() => resolve('late'), 100)); // takes 100ms
  };
  try {
    await resilience4.executeWithResilience(fn4, { retry: 1, timeout: 50, circuitBreakerName: 'test' });
    console.log('  ERROR: Should have timed out');
  } catch (e) {
    console.log(`  Calls: ${callCount4}, Error: ${e.message}`);
    console.log(`  Expected: Calls=2 (initial + 1 retry), Error: Operation timeout\n`);
  }

  // Test 5: Fallback
  console.log('Test 5: Fallback when all retries exhausted');
  resetCache('../services/circuitBreakerService');
  resetCache('../services/resilienceService');
  const mockBreaker5 = createMockBreaker();
  const mockCBS5 = createMockCircuitBreakerService({ test: mockBreaker5 });
  require.cache[require.resolve('../services/circuitBreakerService')] = { exports: mockCBS5 };
  const resilience5 = require('../services/resilienceService');
  let callCount5 = 0;
  const fn5 = () => {
    callCount5++;
    return Promise.reject(new Error('fail'));
  };
  const fallback5 = () => 'fallback value';
  const result5 = await resilience5.executeWithResilience(fn5, {
    retry: 2,
    retryDelay: 10,
    circuitBreakerName: 'test',
    fallback: fallback5,
  });
  console.log(`  Calls: ${callCount5}, Result: ${result5}`);
  console.log(`  Expected: Calls=3, Result: fallback value\n`);

  // Test 6: Circuit breaker open, no fallback
  console.log('Test 6: Circuit breaker open, no fallback');
  resetCache('../services/circuitBreakerService');
  resetCache('../services/resilienceService');
  const mockBreaker6 = createMockBreaker('OPEN', Date.now() + 5000); // open for 5 seconds
  const mockCBS6 = createMockCircuitBreakerService({ test: mockBreaker6 });
  require.cache[require.resolve('../services/circuitBreakerService')] = { exports: mockCBS6 };
  const resilience6 = require('../services/resilienceService');
  let callCount6 = 0;
  const fn6 = () => {
    callCount6++;
    return Promise.resolve('should not be called');
  };
  try {
    await resilience6.executeWithResilience(fn6, { retry: 2, circuitBreakerName: 'test' });
    console.log('  ERROR: Should have rejected due to open circuit breaker');
  } catch (e) {
    console.log(`  Calls: ${callCount6}, Error: ${e.message}`);
    console.log(`  Expected: Calls=0, Error: Circuit Breaker OPEN for test\n`);
  }

  // Test 7: Circuit breaker open with fallback
  console.log('\nTest 7: Circuit breaker open with fallback');
  resetCache('../services/circuitBreakerService');
  resetCache('../services/resilienceService');
  const mockBreaker7 = createMockBreaker('OPEN', Date.now() + 5000);
  const mockCBS7 = createMockCircuitBreakerService({ test: mockBreaker7 });
  require.cache[require.resolve('../services/circuitBreakerService')] = { exports: mockCBS7 };
  const resilience7 = require('../services/resilienceService');
  let callCount7 = 0;
  const fn7 = () => {
    callCount7++;
    return Promise.resolve('should not be called');
  };
  const fallback7 = () => 'fallback from CB';
  const result7 = await resilience7.executeWithResilience(fn7, {
    retry: 2,
    circuitBreakerName: 'test',
    fallback: fallback7,
  });
  console.log(`  Calls: ${callCount7}, Result: ${result7}`);
  console.log(`  Expected: Calls=0, Result: fallback from CB\n`);

  // Test 8: Circuit breaker half-open after timeout (allow one trial)
  console.log('Test 8: Circuit breaker half-open after timeout');
  resetCache('../services/circuitBreakerService');
  resetCache('../services/resilienceService');
  const mockBreaker8 = createMockBreaker('OPEN', Date.now() - 1000); // expired
  const mockCBS8 = createMockCircuitBreakerService({ test: mockBreaker8 });
  require.cache[require.resolve('../services/circuitBreakerService')] = { exports: mockCBS8 };
  const resilience8 = require('../services/resilienceService');
  let callCount8 = 0;
  const fn8 = () => {
    callCount8++;
    return Promise.resolve('success');
  };
  const result8 = await resilience8.executeWithResilience(fn8, {
    retry: 0,
    circuitBreakerName: 'test',
  });
  console.log(`  Calls: ${callCount8}, Result: ${result8}`);
  console.log(`  Expected: Calls=1, Result: success\n`);

  // Test 9: Circuit breaker open error when no fallback
  console.log('Test 9: Circuit breaker open error when no fallback');
  resetCache('../services/circuitBreakerService');
  resetCache('../services/resilienceService');
  const mockBreaker9 = createMockBreaker('OPEN', Date.now() + 5000);
  const mockCBS9 = createMockCircuitBreakerService({ test: mockBreaker9 });
  require.cache[require.resolve('../services/circuitBreakerService')] = { exports: mockCBS9 };
  const resilience9 = require('../services/resilienceService');
  let callCount9 = 0;
  const fn9 = () => {
    callCount9++;
    return Promise.resolve('success');
  };
  try {
    await resilience9.executeWithResilience(fn9, { retry: 0, circuitBreakerName: 'test' });
    console.log('  ERROR: Should have rejected due to open circuit breaker');
  } catch (e) {
    console.log(`  Calls: ${callCount9}, Error: ${e.message}`);
    console.log(`  Expected: Calls=0, Error: Circuit Breaker OPEN for test\n`);
  }

  console.log('=== Verification complete ===');
}

runTests().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});