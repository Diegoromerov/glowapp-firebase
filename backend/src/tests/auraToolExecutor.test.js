// backend/src/tests/auraToolExecutor.test.js
jest.mock('../services/agents/atenaAgent');
jest.mock('../services/agents/hestiaAgent');
jest.mock('../services/agents/hermesAgent');
jest.mock('../services/agents/chronosAgent');
jest.mock('../services/agents/valkyrieAgent');
jest.mock('../services/ragService');
jest.mock('../config/db');
jest.mock('../config/redis');
jest.mock('../services/consentService');

let executeAuraTool;
let AURA_TOOLS_DEFINITIONS;
let atenaAgent;
let hestiaAgent;
let hermesAgent;
let chronosAgent;
let valkyrieAgent;
let ragService;
let dbPool;
let redisMock;
let consentService;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.BIOMETRIC_ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  // Require the module after mocks are set
  const auraToolExecutor = require('../services/auraToolExecutor');
  executeAuraTool = auraToolExecutor.executeAuraTool;
  AURA_TOOLS_DEFINITIONS = auraToolExecutor.AURA_TOOLS_DEFINITIONS;

  // Get mocks
  atenaAgent = require('../services/agents/atenaAgent');
  hestiaAgent = require('../services/agents/hestiaAgent');
  hermesAgent = require('../services/agents/hermesAgent');
  chronosAgent = require('../services/agents/chronosAgent');
  valkyrieAgent = require('../services/agents/valkyrieAgent');
  ragService = require('../services/ragService');
  dbPool = require('../config/db');
  redisMock = require('../config/redis');
  consentService = require('../services/consentService');
});

describe('Pruebas unitarias de AURA Tool Executor (auraToolExecutor.js)', () => {
  test('Debería tener definidas las 8 herramientas principales para el ecosistema de AURA', () => {
    // La fuente única (AURA_TOOLS_DEFINITIONS) declara 14 herramientas tras añadir las
    // operativas de proveedor y salón; la aserción seguía en 11.
    expect(AURA_TOOLS_DEFINITIONS.length).toBe(14);
    const toolNames = AURA_TOOLS_DEFINITIONS.map(t => t.function.name);
    expect(toolNames).toContain('query_user_biometric_profile');
    expect(toolNames).toContain('search_nearby_services');
    expect(toolNames).toContain('check_provider_availability');
    expect(toolNames).toContain('evaluate_user_rebooking');
    expect(toolNames).toContain('recommend_glowstore_products');
    expect(toolNames).toContain('get_provider_b2b_insights');
    expect(toolNames).toContain('search_beauty_knowledge_rag');
    expect(toolNames).toContain('trigger_ui_redirection');
  });

  test('Debería ejecutar trigger_ui_redirection y devolver la etiqueta correcta', async () => {
    const result = await executeAuraTool('trigger_ui_redirection', { moduleKey: 'eyebrow-visagism' }, 1);
    expect(result.status).toBe('success');
    expect(result.redirectionTag).toBe('Redirección Módulo Ideas: eyebrow-visagism');
  });

  test('Debería ejecutar query_user_biometric_profile delegando en ATENA', async () => {
    // Mock consent check
    consentService.checkConsent.mockResolvedValue({ granted: true, grantedAt: new Date(), version: '1.0' });
    consentService.logAccess.mockResolvedValue(undefined);

    // Forma REAL del retorno de atenaAgent.getBiometricDiagnosis (atenaAgent.js:105-116): el
    // agente ya mapea rawProfile.recommendation -> recommendationText y anade status.
    // El mock anterior devolvia el PERFIL CRUDO ({ recommendation }), que no es lo que el
    // agente entrega: el executor hace pass-through del resultado del agente, asi que el
    // test estaba midiendo contra una forma que ningun agente produce.
    const mockProfile = {
      status: 'success',
      profileId: 'prof-123',
      userId: 1,
      faceScores: { hydration: 80 },
      recommendationText: 'Usar hidratante facial',
      createdAt: new Date('2026-01-01T00:00:00Z')
    };
    atenaAgent.getBiometricDiagnosis.mockResolvedValue(mockProfile);

    // Note: The implementation does NOT use pool.query for this tool; it calls the agent directly.
    const result = await executeAuraTool('query_user_biometric_profile', { userId: 1 }, 1);
    expect(atenaAgent.getBiometricDiagnosis).toHaveBeenCalledWith(1);
    expect(result.status).toBe('success');
    expect(result.recommendationText).toBe('Usar hidratante facial');
  });

  test('Debería ejecutar query_user_biometric_profile y retornar error si no hay consentimiento', async () => {
    // Mock consent check - no consent
    consentService.checkConsent.mockResolvedValue({ granted: false });
    consentService.logAccess.mockResolvedValue(undefined);

    const result = await executeAuraTool('query_user_biometric_profile', { userId: 1 }, 1);
    expect(result.error).toBe('consent_required');
    expect(result.message).toContain('consentimiento biométrico');
  });

  // NEW: Ownership test for query_user_biometric_profile - should fail when userId in args does not match context userId
  test('Debería denegar query_user_biometric_profile cuando el userId solicitado no coincide con el contexto de autenticación', async () => {
    // Context userId is 1 (third argument), but args.userId is 2
    const result = await executeAuraTool('query_user_biometric_profile', { userId: 2 }, 1);
    expect(result.error).toBe('ownership_required');
    expect(result.message).toBe('No tienes permisos para acceder a los datos biométricos de otro usuario.');
    // Ensure no further processing (consent check, agent call, DB query)
    expect(consentService.checkConsent).not.toHaveBeenCalled();
    expect(atenaAgent.getBiometricDiagnosis).not.toHaveBeenCalled();
    expect(dbPool.pool.query).not.toHaveBeenCalled();
  });

  test('Debería ejecutar search_nearby_services delegando en HERMES con PostGIS', async () => {
    // Mock the agent
    hermesAgent.findNearbyServices.mockResolvedValue({
      status: 'success',
      foundCount: 1,
      services: [
        {
          service_id: 'serv-1',
          name: 'Manicura Semipermanente',
          price: 45000,
          business_name: 'Sonia Spa',
          distance_km: 1.2
        }
      ]
    });

    const result = await executeAuraTool('search_nearby_services', { latitude: 4.6097, longitude: -74.0817, category: 'Uñas' }, 1);
    expect(hermesAgent.findNearbyServices).toHaveBeenCalledWith({
      latitude: 4.6097,
      longitude: -74.0817,
      category: 'Uñas',
      maxDistanceKm: undefined // default
    });
    expect(result.status).toBe('success');
    expect(result.foundCount).toBe(1);
    expect(result.services[0].business_name).toBe('Sonia Spa');
  });

  // NEW: Test for recommend_glowstore_products (positive case - own user)
  test('Debería ejecutar recommend_glowstore_products delegando en HESTIA (usuario propio)', async () => {
    // Mock consent check for the biometric profile query (internal call) - actually, recommend_glowstore_products does NOT check consent, only ownership.
    // We'll still mock it to avoid any accidental calls, but we expect it not to be called.
    consentService.checkConsent.mockResolvedValue({ granted: true, grantedAt: new Date(), version: '1.0' });
    consentService.logAccess.mockResolvedValue(undefined);

    // Mock the agent: atenaAgent.getBiometricDiagnosis (called internally by hestiaAgent)
    atenaAgent.getBiometricDiagnosis.mockResolvedValue({
      faceScores: { hydration: 70, spots: 20, wrinkles: 10 },
      recommendation: 'Usar hidratante facial'
    });

    // Mock the agent: hestiaAgent.recommendProducts
    const recommendedProducts = [
      { id: 1, name: 'Product A', brand: 'BrandX' },
      { id: 2, name: 'Product B', brand: 'BrandY' }
    ];
    hestiaAgent.recommendProducts.mockResolvedValue(recommendedProducts);

    // Execute the tool: context userId = 1, args.userId = 1 (own user)
    const result = await executeAuraTool('recommend_glowstore_products', { userId: 1, /* other args */ }, 1);

    // Expect success: the result is the array of products (as returned by hestiaAgent)
    expect(result).toEqual(recommendedProducts);

    // El ejecutor delega DIRECTO en HESTIA (auraToolExecutor.js:268):
    //   return await hestiaAgent.recommendProducts({ userId: args.userId || userId, queryText, category });
    // La cadena atena -> hestia ocurre DENTRO de hestiaAgent, pero aqui hestiaAgent esta
    // mockeado (jest.mock en la cabecera), asi que su cuerpo real no corre y ATENA nunca se
    // invoca: asertar getBiometricDiagnosis en este test no podia pasar nunca, midiera el
    // codigo lo que midiera. Se aserta lo que el ejecutor SI es responsable de hacer: pasar
    // a HESTIA el userId del contexto de autenticacion.
    expect(hestiaAgent.recommendProducts).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1 })
    );
    // 2. Then hestiaAgent.recommendProducts was called with the result from atenaAgent (which includes userId? 
    //    Actually, in auraToolExecutor.js we do:
    //      const biometricProfile = await atenaAgent.getBiometricDiagnosis(userId);
    //      return hestiaAgent.recommendProducts({ userId, ...biometricProfile });
    //    So we expect hestiaAgent.recommendProducts to be called with an object that has userId: 1 and the faceScores, etc.
    expect(hestiaAgent.recommendProducts).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1 })
    );
  });

  // NEW: Ownership test for recommend_glowstore_products - should fail when userId in args does not match context userId
  test('Debería denegar recommend_glowstore_products cuando el userId solicitado no coincide con el contexto de autenticación', async () => {
    // Context userId is 1 (third argument), but args.userId is 2
    const result = await executeAuraTool('recommend_glowstore_products', { userId: 2 }, 1);
    expect(result.error).toBe('ownership_required');
    expect(result.message).toBe('No tienes permisos para acceder a los datos biométricos de otro usuario.');
    // Ensure no further processing
    expect(consentService.checkConsent).not.toHaveBeenCalled();
    expect(atenaAgent.getBiometricDiagnosis).not.toHaveBeenCalled();
    expect(hestiaAgent.recommendProducts).not.toHaveBeenCalled();
  });

  // Additional tests for other tools can be added if needed, but the focus is on ownership.
});

describe('get_provider_appointments · contrato de columnas', () => {
  // Regresión: la subconsulta a business_profiles filtraba por `user_id`, columna que
  // NO existe (la tabla usa `provider_id`). En producción eso devolvía
  // `column "user_id" does not exist` y el modelo respondía "error técnico" al pedir
  // el conteo de citas del mes.
  test('consulta business_profiles por provider_id y nunca por user_id', async () => {
    dbPool.pool.query.mockResolvedValue({ rows: [] });

    const result = await executeAuraTool('get_provider_appointments', { timeRange: 'this_month' }, 103);

    expect(result.status).toBe('success');
    expect(dbPool.pool.query).toHaveBeenCalled();
    const [sql, params] = dbPool.pool.query.mock.calls[0];
    expect(sql).toContain('business_profiles WHERE provider_id = $1');
    expect(sql).not.toContain('user_id = $1');
    expect(params).toEqual([103]);
  });

  test('aplica el rango this_month sobre scheduled_at', async () => {
    dbPool.pool.query.mockResolvedValue({ rows: [] });

    await executeAuraTool('get_provider_appointments', { timeRange: 'this_month' }, 7);

    const [sql] = dbPool.pool.query.mock.calls[0];
    expect(sql).toContain("DATE_TRUNC('month', CURRENT_DATE)");
  });

  test('el total sale del COUNT en base, no del tamaño de la lista', async () => {
    // 60 citas reales, pero la muestra solo trae 20
    dbPool.pool.query
      .mockResolvedValueOnce({ rows: [{ estado: 'PENDIENTE_PAGO', total: 40 }, { estado: 'COMPLETADA', total: 20 }] })
      .mockResolvedValueOnce({ rows: Array.from({ length: 20 }, (_, i) => ({ id: `b-${i}`, estado: 'COMPLETADA' })) });

    const result = await executeAuraTool('get_provider_appointments', { timeRange: 'this_month' }, 103);

    expect(result.totalAppointments).toBe(60);
    expect(result.breakdownByStatus).toEqual({ PENDIENTE_PAGO: 40, COMPLETADA: 20 });
    expect(result.previewReturned).toBe(20);
    expect(result.truncated).toBe(true);
    expect(result.countingNote).toContain('muestra');
  });

  test('sin truncar cuando la muestra cubre el total', async () => {
    dbPool.pool.query
      .mockResolvedValueOnce({ rows: [{ estado: 'CONFIRMADA', total: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });

    const result = await executeAuraTool('get_provider_appointments', { timeRange: 'this_month' }, 103);

    expect(result.totalAppointments).toBe(3);
    expect(result.truncated).toBe(false);
  });

describe('get_provider_financial_metrics · enum estado_cita', () => {
  // Regresión: el SQL comparaba con 'FINALIZADA', 'PENDIENTE' y 'RECHAZADA', que NO son
  // etiquetas del enum estado_cita. PostgreSQL aborta toda la consulta con
  // `invalid input value for enum estado_cita: "FINALIZADA"`, incluso dentro de un CASE WHEN.
  test('usa estado::text y solo etiquetas reales del enum', async () => {
    dbPool.pool.query.mockResolvedValue({ rows: [{ total_citas: 17, facturacion_bruta: '420000', citas_ejecutadas: 2 }] });

    const result = await executeAuraTool('get_provider_financial_metrics', { period: 'all_time' }, 103);

    expect(result.status).toBe('success');
    const [sql] = dbPool.pool.query.mock.calls[0];
    expect(sql).toContain('estado::text IN');
    expect(sql).not.toMatch(/estado IN \('COMPLETADA', 'FINALIZADA'/);
    expect(sql).not.toContain("'FINALIZADA'");
    expect(sql).not.toContain("'RECHAZADA'");
    expect(sql).not.toContain("'PENDIENTE'");
    expect(sql).toContain("'FINALIZADA_PRESTADOR'");
  });

  test('separa facturación ejecutada de la confirmada (no las suma)', async () => {
    dbPool.pool.query.mockResolvedValue({ rows: [{
      total_citas: 17, facturacion_bruta: '420000', facturacion_confirmada: '998000',
      ingreso_neto_prestador: '336000', citas_ejecutadas: 2,
    }] });

    const result = await executeAuraTool('get_provider_financial_metrics', { period: 'all_time' }, 103);

    expect(result.facturacion_bruta).toBe(420000);
    expect(result.facturacion_confirmada).toBe(998000);
    expect(result.ingreso_neto_prestador).toBe(336000);
  });
});
});
