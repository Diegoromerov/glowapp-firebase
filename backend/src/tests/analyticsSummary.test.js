// backend/src/tests/analyticsSummary.test.js
/**
 * El consumidor del embudo: GET /api/analytics/summary.
 *
 * La telemetría se escribía y nadie la leía (ítem 68 de la auditoría). Se prueba
 * en dos capas: la ruta exige sesión (401 sin token) y el controlador devuelve
 * los dos cortes con la ventana acotada.
 *
 * El controlador se invoca con dobles de req/res en vez de pasar por
 * authMiddleware: esa capa abre transacción de tenant y ya tiene sus suites.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../models/AnalyticsEvent', () => {
  const findAll = jest.fn();
  return {
    findAll,
    sequelize: { fn: (...a) => a.join('-'), col: (c) => c, literal: (s) => s },
  };
});

const AnalyticsEvent = require('../models/AnalyticsEvent');
const analyticsController = require('../controllers/analyticsController');
const analyticsRoutes = require('../routes/analyticsRoutes');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/analytics', analyticsRoutes);
  return a;
}

function resFalso() {
  const salida = { status: 200, body: null };
  const res = {
    status(c) { salida.status = c; return res; },
    json(b) { salida.body = b; return res; },
  };
  return { res, salida };
}

describe('GET /api/analytics/summary — la ruta', () => {
  it('rechaza sin sesión: es un corte de administración', async () => {
    const res = await request(app()).get('/api/analytics/summary');
    expect(res.status).toBe(401);
  });

  it('no atiende con un token que no es un JWT', async () => {
    const res = await request(app())
      .get('/api/analytics/summary')
      .set('Authorization', 'Bearer no-es-un-jwt');
    expect(res.status).not.toBe(200);
  });
});

describe('analyticsController.summary — el embudo', () => {
  beforeEach(() => {
    AnalyticsEvent.findAll.mockReset();
    AnalyticsEvent.findAll.mockImplementation(async (opciones) => {
      const pidePantalla = JSON.stringify(opciones.attributes || []).includes('screen_name');
      return pidePantalla
        ? [{ screen_name: '/home', total: '80' }]
        : [{ event_type: 'SCREEN_VIEW', total: '120' }];
    });
  });

  it('devuelve los dos cortes: por tipo y por pantalla', async () => {
    const { res, salida } = resFalso();
    await analyticsController.summary({ query: { days: '7' } }, res);

    expect(salida.status).toBe(200);
    expect(salida.body.success).toBe(true);
    expect(salida.body.days).toBe(7);
    expect(salida.body.por_tipo[0]).toEqual({ event_type: 'SCREEN_VIEW', total: '120' });
    expect(salida.body.por_pantalla[0]).toEqual({ screen_name: '/home', total: '80' });
    expect(AnalyticsEvent.findAll).toHaveBeenCalledTimes(2);
  });

  it('acota la ventana entre 1 y 90 días', async () => {
    const alto = resFalso();
    await analyticsController.summary({ query: { days: '999' } }, alto.res);
    expect(alto.salida.body.days).toBe(90);

    const bajo = resFalso();
    await analyticsController.summary({ query: { days: '0' } }, bajo.res);
    expect(bajo.salida.body.days).toBe(1);
  });

  it('sin parámetro usa 7 días', async () => {
    const { res, salida } = resFalso();
    await analyticsController.summary({ query: {} }, res);
    expect(salida.body.days).toBe(7);
  });
});
