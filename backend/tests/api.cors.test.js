// api.cors.test.js
// Lo que se mide aqui son las CABECERAS CORS, no el veredicto de salud.
// El endpoint elegido, /api/health, responde 503 cuando la base esta degradada: es su
// proposito (index.js:465-473, clasificarSalud + X-GlowApp-Degraded), no un fallo.
// Antes se asertaba .expect(200), atando este test a un veredicto que varia por diseño.
// MEDIDO antes de cambiar nada: el 503 SI trae access-control-allow-origin,
// access-control-allow-credentials y vary. O sea que CORS funciona sobre el 503 y lo que
// estaba mal era la asercion, no el comportamiento.
const request = require('supertest');
const app = require('../index');

describe('CORS configuration', () => {
  const endpoint = '/api/health';
  test('should allow origin from production Railway URL', async () => {
    const response = await request(app)
      .get(endpoint)
      .set('Origin', 'https://belleza-app-production.up.railway.app');
    expect(response.headers['access-control-allow-origin']).toBe('https://belleza-app-production.up.railway.app');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  test('should allow request with no Origin (curl/Postman)', async () => {
    const response = await request(app).get(endpoint);
    // Sin Origin, CORS no debe bloquear: la peticion llega y responde con cuerpo.
    expect(response.body).toHaveProperty('status');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});