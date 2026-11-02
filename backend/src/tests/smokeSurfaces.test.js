const { decidirRutas } = require('../../scripts/smokeSurfaces');

describe('smokeSurfaces — Decision Engine & Fail-Fast Inventory Policy (Ronda 5)', () => {

  test('C1, C2: app = null con inventario disponible retorna exitCode = 1 y fuente = "inventario" (NO sustituye medición)', () => {
    const mockInventario = [{ method: 'GET', path: '/api/v1/dummy' }];
    const res = decidirRutas({ app: null, inventario: mockInventario });

    expect(res.exitCode).toBe(1);
    expect(res.fuente).toBe('inventario');
    expect(res.rutas).toEqual(mockInventario);
    expect(res.error).toContain('no se pudo cargar el entry vivo de la app');
  });

  test('C1, C2: app con stack de rutas vacío retorna exitCode = 1 y fuente = "inventario"', () => {
    const emptyApp = { _router: { stack: [] } };
    const mockInventario = [{ method: 'GET', path: '/api/v1/dummy' }];
    const res = decidirRutas({ app: emptyApp, inventario: mockInventario });

    expect(res.exitCode).toBe(1);
    expect(res.fuente).toBe('inventario');
    expect(res.error).toContain('no se pudo cargar el entry vivo de la app');
  });

  test('C1, C2: app con stack vivo de rutas retorna exitCode = 0 y fuente = "express_stack"', () => {
    const liveApp = {
      _router: {
        stack: [
          {
            route: {
              path: '/api/health',
              methods: { get: true }
            }
          }
        ]
      }
    };
    const mockInventario = [{ method: 'GET', path: '/api/v1/dummy' }];
    const res = decidirRutas({ app: liveApp, inventario: mockInventario });

    expect(res.exitCode).toBe(0);
    expect(res.fuente).toBe('express_stack');
    expect(res.rutas).toHaveLength(1);
    expect(res.rutas[0]).toEqual({ method: 'GET', path: '/api/health' });
    expect(res.error).toBeUndefined();
  });

  test('C1, C2: sin app viva y sin inventario respaldado retorna exitCode = 1 y fuente = "ninguna"', () => {
    const res = decidirRutas({ app: null, inventario: [] });

    expect(res.exitCode).toBe(1);
    expect(res.fuente).toBe('ninguna');
    expect(res.rutas).toEqual([]);
    expect(res.error).toContain('no se pudieron obtener rutas');
  });

});
