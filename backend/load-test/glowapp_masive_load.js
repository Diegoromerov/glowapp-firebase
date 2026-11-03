// backend/load-test/glowapp_masive_load.js
import http from 'k6/http';
import { check, sleep, group } from 'k6';

// 📊 CONFIGURACIÓN DE RAMPA Y UMBRALES DE ACEPTACIÓN (SLA)
export const options = {
  stages: [
    { duration: '15s', target: 50 },   // Rampa inicial a 50 usuarios
    { duration: '30s', target: 200 },  // Escalado a 200 usuarios
    { duration: '30s', target: 500 },  // Pico máximo de 500 usuarios
    { duration: '15s', target: 0 },    // Cierre suave
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // El 95% de las peticiones debe responder en menos de 1000ms
    http_req_failed: ['rate<0.05'],    // Menos del 5% de fallos permitidos
  },
};

const BASE_URL = __ENV.TARGET_URL || 'https://belleza-app-production.up.railway.app';

export default function () {
  // 1. Grupo 1: Verificación de Salud de la Infraestructura
  group('01_Healthcheck', function () {
    const res = http.get(`${BASE_URL}/api/health`);
    check(res, {
      'Health status 200': (r) => r.status === 200,
      'DB is CONNECTED': (r) => r.json('db') === 'CONNECTED',
    });
  });

  sleep(0.5);

  // 2. Grupo 2: Catálogo de Productos y Servicios (Lectura Intensiva)
  group('02_Store_Catalog', function () {
    const res = http.get(`${BASE_URL}/api/products`);
    check(res, {
      'Products status 200 or 404': (r) => r.status === 200 || r.status === 404,
      'Response time < 1000ms': (r) => r.timings.duration < 1000,
    });
  });

  sleep(1);
}
