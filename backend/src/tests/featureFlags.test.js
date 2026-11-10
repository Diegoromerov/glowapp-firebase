// Ítem 80 — los feature flags se leen de FEATURE_FLAGS (JSON en el entorno).
//
// El sistema ya estaba implementado de punta a punta (endpoint + cliente), pero
// sin pruebas: cualquier error de parseo dejaba todos los flags apagados o
// encendidos sin que nadie lo notara. Aquí se fija el contrato del lector.
describe('leerFlags (GET /api/config/flags)', () => {
  const ENV_ORIGINAL = process.env.FEATURE_FLAGS;
  let leerFlagsYLimpiar;

  beforeAll(() => {
    // Se recarga el módulo antes de cada caso para saltar la caché de 60 s.
    ({ leerFlags: leerFlagsYLimpiar } = require('../routes/configRoutes'));
  });

  afterEach(() => {
    if (ENV_ORIGINAL === undefined) delete process.env.FEATURE_FLAGS;
    else process.env.FEATURE_FLAGS = ENV_ORIGINAL;
    jest.resetModules();
  });

  function leer(config) {
    if (config === undefined) delete process.env.FEATURE_FLAGS;
    else process.env.FEATURE_FLAGS = config;
    jest.resetModules();
    return require('../routes/configRoutes').leerFlags();
  }

  test('acepta solo booleanos y descarta el resto', () => {
    const flags = leer('{"propinas":true,"glowstore":false,"raro":"si","n":1}');
    expect(flags).toEqual({ propinas: true, glowstore: false });
  });

  test('JSON inválido no rompe: devuelve objeto vacío', () => {
    expect(leer('{no-es-json')).toEqual({});
  });

  test('una lista no se acepta como flags', () => {
    expect(leer('[true,false]')).toEqual({});
  });

  test('sin variable de entorno no hay flags', () => {
    expect(leer(undefined)).toEqual({});
  });

  test('el endpoint publica los flags sin autenticación', async () => {
    process.env.FEATURE_FLAGS = '{"propinas":true}';
    jest.resetModules();
    const router = require('../routes/configRoutes');
    // El handler vive en el router; se busca la capa de /config/flags.
    const capa = router.stack.find(
      (c) => c.route && c.route.path === '/config/flags',
    );
    expect(capa).toBeDefined();

    const res = {
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    capa.route.stack[0].handle({}, res);
    expect(res.body.success).toBe(true);
    expect(res.body.flags).toEqual({ propinas: true });
  });
});
