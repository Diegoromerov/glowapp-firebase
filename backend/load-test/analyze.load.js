// backend/load-test/analyze.load.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Subir a 10 usuarios
    { duration: '1m', target: 30 },   // Subir a 30 usuarios
    { duration: '30s', target: 0 },   // Bajada
  ],
  thresholds: {
    http_req_duration: ['p(95)<8000'], // 95% de requests < 8s
    http_req_failed: ['rate<0.01'],    // <1% de fallos
  },
};

export default function () {
  const payload = JSON.stringify({
    userId: `load-user-${__VU}`,
    faceImage: 'bW9jay1mYWNlLWltYWdl', // mock-face-image en base64
    handsImage: 'bW9jay1oYW5kcy1pbWFnZQ==', // mock-hands-image en base64
  });

  const res = http.post('http://localhost:8080/api/biometric/analyze', payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 8s': (r) => r.timings.duration < 8000,
  });

  sleep(1);
}
