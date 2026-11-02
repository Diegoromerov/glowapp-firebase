// backend/load-test/biometric_load_test.js
/**
 * Script de prueba de carga y resiliencia para el Hub Biométrico Refactorizado (Sprint 3.3)
 * Diseñado para ejecutarse con Artillery o k6
 */
module.exports = {
  config: {
    target: 'http://localhost:3000',
    phases: [
      { duration: 10, arrivalRate: 2, name: 'Warm-up phase' },
      { duration: 20, arrivalRate: 10, name: 'Ramp-up load' },
    ],
  },
  scenarios: [
    {
      name: 'Verificación de Estado de Consentimiento',
      flow: [
        {
          get: {
            url: '/api/consent/status/7',
            headers: {
              Authorization: 'Bearer valid-jwt-token',
            },
          },
        },
      ],
    },
  ],
};
