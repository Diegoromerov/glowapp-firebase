/**
 * FASE C · t_fix_backend_03 — P0 «Sin matriz degradación por dependencia»
 * Hallazgo citado: backend/src/middleware/degradedLock.js:52
 *   «No matriz degradación por dependencia; solo flag binario → blast radius 100%»
 *
 * Contrato que este test fija:
 *   1. Existe una MATRIZ DE DEGRADACIÓN POR DEPENDENCIA (postgres core, RAG/pgvector, Redis, IA externa)
 *      con alcance y comportamiento explícitos por dependencia.
 *   2. Solo la dependencia CORE (PostgreSQL transaccional) es de alcance global (bloquea 100% de /api).
 *      Una dependencia lateral (p. ej. RAG caído) NO puede tener blast radius total.
 *   3. El candado resuelve, por ruta, de qué dependencias laterales depende y degrada SOLO esas
 *      superficies (no bloquea dinero/identidad por una caída de RAG).
 *   4. Sin regresión: core degradado => 503 DATA_LAYER_DEGRADED (contrato vigente C6/CI-16).
 *
 * ESTE TEST ES ROJO ANTES DEL FIX: la matriz y los resolutores por dependencia no existen aún.
 */
const db = require('../config/db');
const degradedLock = require('../middleware/degradedLock');

function fakeRes() {
  const headers = {};
  const state = { statusCode: 200, body: null };
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status: (c) => { state.statusCode = c; return { json: (b) => { state.body = b; } }; },
  };
  return { res, headers, state };
}

async function correrMiddleware(path, dbStatus) {
  jest.spyOn(db, 'getDbStatus').mockReturnValue(dbStatus);
  const req = { originalUrl: path, url: path, method: 'GET' };
  const { res, headers, state } = fakeRes();
  let nextCalled = false;
  await degradedLock.degradedLockMiddleware(req, res, () => { nextCalled = true; });
  return { nextCalled, headers, state };
}

describe('FASE C · t_fix_backend_03 — Matriz de degradación por dependencia (degradedLock.js:52)', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('1. La matriz existe y declara cada dependencia con alcance y comportamiento', () => {
    const matriz = degradedLock.MATRIZ_DEGRADACION_POR_DEPENDENCIA;

    test('existe y cubre las dependencias conocidas (core, rag, redis, ai)', () => {
      expect(matriz).toBeDefined();
      expect(degradedLock.DEPENDENCIAS_CONOCIDAS).toEqual(
        expect.arrayContaining(['database', 'rag', 'redis', 'ai'])
      );
      for (const id of ['database', 'rag', 'redis', 'ai']) {
        expect(matriz[id]).toBeDefined();
        expect(typeof matriz[id].comportamiento).toBe('string');
        expect(typeof matriz[id].header).toBe('string');
        expect(typeof matriz[id].descripcion).toBe('string');
      }
    });

    test('solo la dependencia core es de alcance global (blast radius < 100% por cualquier dependencia)', () => {
      expect(matriz.database.alcanceGlobal).toBe(true);
      expect(matriz.rag.alcanceGlobal).toBe(false);
      expect(matriz.redis.alcanceGlobal).toBe(false);
      expect(matriz.ai.alcanceGlobal).toBe(false);

      const globales = Object.values(matriz).filter((d) => d.alcanceGlobal === true);
      expect(globales.length).toBe(1);
    });

    test('cada dependencia lateral declara las familias de ruta que degrada (puede ser vacío) y su alcance', () => {
      for (const id of ['rag', 'redis', 'ai']) {
        expect(Array.isArray(matriz[id].familiasDeRuta)).toBe(true);
        for (const prefijo of matriz[id].familiasDeRuta) {
          expect(prefijo.startsWith('/api/')).toBe(true);
        }
      }
      // RAG sí debe acotar superficies de conocimiento/IA (no comodines).
      expect(matriz.rag.familiasDeRuta.length).toBeGreaterThan(0);
      expect(matriz.rag.familiasDeRuta.some((p) => p.includes('*'))).toBe(false);
    });
  });

  describe('2. normalizarEstadoDependencias deriva la dependencia core del estado binario de la BD', () => {
    test('pgAvailable=false o servingFabricatedData=true => database degradada', () => {
      expect(degradedLock.normalizarEstadoDependencias({ pgAvailable: false, servingFabricatedData: false }).database).toBe(true);
      expect(degradedLock.normalizarEstadoDependencias({ pgAvailable: true, servingFabricatedData: true }).database).toBe(true);
    });

    test('estado sano o sin comprobar no marca database como degradada', () => {
      expect(degradedLock.normalizarEstadoDependencias({ pgAvailable: true, servingFabricatedData: false }).database).toBe(false);
      expect(degradedLock.normalizarEstadoDependencias({ pgAvailable: null, servingFabricatedData: false }).database).toBe(false);
    });

    test('las dependencias laterales se leen del estado extendido de dependencias', () => {
      const estado = degradedLock.normalizarEstadoDependencias({
        pgAvailable: true,
        servingFabricatedData: false,
        dependencias: { rag: true }
      });
      expect(estado.rag).toBe(true);
      expect(estado.redis).toBe(false);
      expect(estado.ai).toBe(false);
      expect(estado.database).toBe(false);
    });
  });

  describe('3. evaluarDegradacionPorDependencia separa alcance global de alcance lateral', () => {
    test('RAG caída NO bloquea globalmente (blast radius lateral, no 100%)', () => {
      const eval_ = degradedLock.evaluarDegradacionPorDependencia({ database: false, rag: true, redis: false, ai: false });
      expect(eval_.bloqueoGlobal).toBe(false);
      expect(eval_.dependenciasDegradadas).toContain('rag');
      expect(eval_.dependenciasGlobales).toHaveLength(0);
    });

    test('core caído SÍ bloquea globalmente', () => {
      const eval_ = degradedLock.evaluarDegradacionPorDependencia({ database: true, rag: false, redis: false, ai: false });
      expect(eval_.bloqueoGlobal).toBe(true);
      expect(eval_.dependenciasGlobales).toContain('database');
    });
  });

  describe('4. dependenciasDeRuta relaciona cada superficie con sus dependencias laterales', () => {
    test('la superficie RAG (business/academy IA) depende de rag', () => {
      expect(degradedLock.dependenciasDeRuta('/api/v1/business/report')).toContain('rag');
    });

    test('las superficies de dinero e identidad NO dependen de rag/ai', () => {
      expect(degradedLock.dependenciasDeRuta('/api/payments/wompi-webhook')).not.toContain('rag');
      expect(degradedLock.dependenciasDeRuta('/api/auth/login')).not.toContain('ai');
      expect(degradedLock.dependenciasDeRuta('/api/wallet/balance')).not.toContain('rag');
    });
  });

  describe('5. decidirDegradacionDeRuta acota la degradación a la ruta afectada', () => {
    test('con core sano y RAG caída, la superficie RAG queda degradada pero no bloqueada', () => {
      const decision = degradedLock.decidirDegradacionDeRuta('/api/v1/business/report', { database: false, rag: true, redis: false, ai: false });
      expect(decision.bloqueada).toBe(false);
      expect(decision.degradada).toBe(true);
      expect(decision.header).toBe('rag-degraded');
    });

    test('con core sano y RAG caída, una ruta de dinero no queda degradada', () => {
      const decision = degradedLock.decidirDegradacionDeRuta('/api/payments/wompi-webhook', { database: false, rag: true, redis: false, ai: false });
      expect(decision.bloqueada).toBe(false);
      expect(decision.degradada).toBe(false);
      expect(decision.header).toBeNull();
    });
  });

  describe('6. Middleware: degradación lateral acotada sin bloqueo 100%', () => {
    test('core sano + RAG caída: /api/v1/business pasa con marca rag-degraded (no 503)', async () => {
      const r = await correrMiddleware('/api/v1/business/report', {
        pgAvailable: true,
        servingFabricatedData: false,
        dependencias: { rag: true }
      });
      expect(r.nextCalled).toBe(true);
      expect(r.state.statusCode).not.toBe(503);
      expect(r.headers['X-GlowApp-Degraded']).toBe('rag-degraded');
    });

    test('core sano + RAG caída: /api/payments/wompi-webhook pasa SIN marca de degradación lateral', async () => {
      const r = await correrMiddleware('/api/payments/wompi-webhook', {
        pgAvailable: true,
        servingFabricatedData: false,
        dependencias: { rag: true }
      });
      expect(r.nextCalled).toBe(true);
      expect(r.headers['X-GlowApp-Degraded']).toBeUndefined();
    });
  });

  describe('7. Sin regresión: core degradado conserva el bloqueo global 503', () => {
    test('pgAvailable=false => /api/payments bloqueado 503 DATA_LAYER_DEGRADED', async () => {
      const r = await correrMiddleware('/api/payments/wompi-webhook', {
        pgAvailable: false,
        servingFabricatedData: false
      });
      expect(r.nextCalled).toBe(false);
      expect(r.state.statusCode).toBe(503);
      expect(r.headers['X-GlowApp-Degraded']).toBe('memory-fallback');
      expect(r.state.body.error).toBe('DATA_LAYER_DEGRADED');
    });
  });
});
