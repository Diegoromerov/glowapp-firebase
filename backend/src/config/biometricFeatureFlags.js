// backend/src/config/biometricFeatureFlags.js
/**
 * Feature Flags para el Hub Biométrico Refactorizado (Sprint 3.4 ADR-001)
 * Permite despliegue gradual y seguro (Canary release) de componentes refactorizados.
 */
class BiometricFeatureFlags {
  constructor() {
    this.flags = {
      ENABLE_ZOD_VALIDATION: process.env.FF_BIOMETRIC_ZOD !== 'false',
      ENABLE_IDEMPOTENCY_GUARD: process.env.FF_BIOMETRIC_IDEMPOTENCY !== 'false',
      ENABLE_CIRCUIT_BREAKER: process.env.FF_BIOMETRIC_CIRCUIT_BREAKER !== 'false',
      ENABLE_ATOMIC_CONSENT_TX: process.env.FF_BIOMETRIC_ATOMIC_CONSENT !== 'false',
    };
  }

  isEnabled(flagName) {
    return !!this.flags[flagName];
  }

  setFlag(flagName, value) {
    this.flags[flagName] = !!value;
  }
}

module.exports = new BiometricFeatureFlags();
