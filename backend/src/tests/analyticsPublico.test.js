// backend/src/tests/analyticsPublico.test.js
/**
 * La telemetría tiene que aceptar eventos SIN sesión.
 *
 * Por qué: el embudo anónimo y los crash reports de un arranque que falla no
 * llevan token. Con authMiddleware en la ruta se perdían con un 401 y la
 * observabilidad quedaba ciega justo en los casos que importan.
 *
 * Si alguien vuelve a montar authMiddleware en POST /events, el primer test
 * falla: es la mutación que protege el arreglo.
 */
const express = require('express');
const request = require('supertest');

// El limitador se relaja cuando NODE_ENV=test; esta suite prueba justamente que
// existe, así que se fuerza el comportamiento de producción.
process.env.TEST_RATE_LIMIT = 'true';

jest.mock('../controllers/analyticsController', () => ({
  logEvent: (req, res) => res.status(201).json({ success: true, received: req.body }),
}));

const analyticsRoutes = require('../routes/analyticsRoutes');

function appDePrueba() {
  const app = express();
  app.use(express.json());
  app.use('/api', analyticsRoutes);
  return app;
}

describe('POST /api/events — telemetría pública', () => {
  it('acepta un evento sin cabecera Authorization', async () => {
    const res = await request(appDePrueba())
      .post('/api/events')
      .send({ events: [{ event_type: 'APP_OPEN', screen_name: '/home' }] });

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(201);
    expect(res.body.received.events).toHaveLength(1);
  });

  it('acepta un evento de crash sin sesión (el caso que se perdía)', async () => {
    const res = await request(appDePrueba())
      .post('/api/events')
      .send({ events: [{ event_type: 'APP_CRASH', screen_name: '/boot' }] });

    expect(res.status).toBe(201);
  });

  it('responde 429 cuando una misma IP supera el límite', async () => {
    const app = appDePrueba();
    let ultimo = 0;
    for (let i = 0; i < 125; i++) {
      const r = await request(app).post('/api/events').send({ events: [{ event_type: 'APP_OPEN' }] });
      ultimo = r.status;
    }
    expect(ultimo).toBe(429);
  });
});
