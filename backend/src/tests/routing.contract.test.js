const request = require('supertest');
const express = require('express');
const app = require('../../index');

function cleanRegexpSource(source) {
  if (!source || source === '^\\/' || source === '^\\/\\/?') return '';
  let cleaned = source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)/g, '')
    .replace(/\$\/?$/g, '')
    .replace(/\\\//g, '/')
    .replace(/\?\(\?=\/\|\$\)/g, '')
    .replace(/\?$/g, '');
  if (!cleaned.startsWith('/')) {
    cleaned = '/' + cleaned;
  }
  return cleaned;
}

describe('ORDEN A-03 — Contrato de Enrutamiento (Un router, un prefijo)', () => {
  test('C1: Ningún router debe estar montado más de una vez en el stack de Express', () => {
    const routerHandles = new Map();
    const duplicates = [];

    if (app._router && app._router.stack) {
      app._router.stack.forEach((layer, idx) => {
        if (layer.name === 'router' && layer.handle) {
          const prefix = cleanRegexpSource(layer.regexp ? layer.regexp.source : '');
          if (routerHandles.has(layer.handle)) {
            duplicates.push({
              firstIndex: routerHandles.get(layer.handle).index,
              firstPrefix: routerHandles.get(layer.handle).prefix,
              secondIndex: idx,
              secondPrefix: prefix
            });
          } else {
            routerHandles.set(layer.handle, { index: idx, prefix });
          }
        }
      });
    }

    expect(duplicates).toEqual([]);
  });

  test('C1, C3: Ninguna ruta final debe contener segmentos de ruta repetidos (ej. /precios/precios)', () => {
    const routes = [];

    function extract(stack, prefix = '') {
      if (!stack) return;
      stack.forEach(layer => {
        if (layer.route) {
          let routePath = layer.route.path;
          if (routePath === '/') routePath = '';
          const fullPath = (prefix + routePath) || '/';
          routes.push(fullPath.replace(/\/+/g, '/'));
        } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
          const routePrefix = cleanRegexpSource(layer.regexp ? layer.regexp.source : '');
          extract(layer.handle.stack, prefix + routePrefix);
        }
      });
    }

    if (app._router && app._router.stack) {
      extract(app._router.stack);
    }

    const repeatedSegmentRoutes = [];
    routes.forEach(r => {
      const segments = r.split('/').filter(Boolean);
      for (let i = 0; i < segments.length - 1; i++) {
        if (segments[i] === segments[i + 1]) {
          repeatedSegmentRoutes.push({ route: r, repeatedSegment: segments[i] });
          break;
        }
      }
    });

    expect(repeatedSegmentRoutes).toEqual([]);
  });

  test('C2, C4: Verificación HTTP de rutas canónicas vs rutas duplicadas (C4: /api/admin/precios responde y /api/admin/precios/precios da 404)', async () => {
    // Este caso mide el CONTRATO DE MONTAJES (un router, un prefijo): qué rutas quedan registradas.
    // Por eso neutraliza el candado de degradación si está montado: ese middleware responde
    // 503 DATA_LAYER_DEGRADED a cualquier superficie de datos bajo /api cuando el estado de la base
    // no está verificado o hay datos fabricados, y lo hace ANTES que el router ⇒ taparía el 404 que
    // aquí se quiere medir (una URL inexistente). Sin el candado, la respuesta la decide el router.
    const appSinCandado = (a) => {
      if (a && a._router && Array.isArray(a._router.stack)) {
        a._router.stack = a._router.stack.filter(
          (layer) => !(layer.handle && layer.handle.name === 'degradedLockMiddleware')
        );
      }
      return a;
    };

    const testApp = express();
    testApp.use((req, res, next) => {
      req.user = { id: 1, rol: 'admin', email: 'admin@glowapp.com' };
      next();
    });
    testApp.use(appSinCandado(app));

    // /api/admin/precios debe responder (200 o 500 si falla BD), NUNCA 404
    const resPrecios = await request(testApp).get('/api/admin/precios');
    expect(resPrecios.status).not.toBe(404);

    // /api/admin/precios/precios DEBE responder 404 Not Found
    const resPreciosDuplicated = await request(testApp).get('/api/admin/precios/precios');
    expect(resPreciosDuplicated.status).toBe(404);

    // /api/admin/academy/courses debe responder (200 o 500 si falla BD), NUNCA 404
    const resAcademy = await request(testApp).get('/api/admin/academy/courses');
    expect(resAcademy.status).not.toBe(404);

    // /api/events debe responder (200 o 500 si falla BD), NUNCA 404
    const resEvents = await request(testApp).get('/api/events');
    expect(resEvents.status).not.toBe(404);
  });
});
