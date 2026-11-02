/**
 * t_fix_tenant_03 — Timeouts explícitos en el pool de PostgreSQL.
 *
 * Hallazgo P0 (integridad de datos): el pool principal de `src/config/db.js`
 * se construía sin límite de tiempo para las CONSULTAS. `connectionTimeoutMillis`
 * solo cubre la ADQUISICIÓN de una conexión libre; NO cubre una consulta ya
 * lanzada. Un `SELECT` que se cuelga (lock, tabla bloqueada, red que se abre a
 * medias, statement que se atasca) retenía una conexión del pool para siempre:
 * el proceso se quedaba sin conexiones y el pool servía errores de adquisición
 * sin que ningún statement hubiera fallado nunca.
 *
 * Este test fija los límites de tiempo que faltaban, probando la configuración
 * REAL que db.js entrega al driver. Se intercepta la frontera `pg.Pool` en vez
 * de reimplementar la lógica: lo que se verifica es que el módulo pasa las
 * opciones correctas, no una copia de ellas.
 */

const mockPoolOptions = [];

jest.mock('pg', () => {
  const actual = jest.requireActual('pg');
  class Pool {
    constructor(options) {
      mockPoolOptions.push({ ...options });
      this.options = { ...options };
    }
    on() { return this; }
    query() { return Promise.resolve({ rows: [] }); }
    connect() {
      return Promise.resolve({
        query: async () => ({ rows: [] }),
        release: () => {}
      });
    }
    end() { return Promise.resolve(); }
  }
  return { ...actual, Pool };
});

// Modo test sin base real; con URL RAG para que se construyan los DOS pools y
// poder verificar que ninguno se queda sin límite de consulta.
process.env.NODE_ENV = 'test';
process.env.RAG_DATABASE_URL = 'postgres://user:pass@localhost:5432/glowapp_rag';

const esEnteroPositivo = (v) => Number.isInteger(v) && v > 0;
const esRag = (o) => String(o.connectionString || '').includes('glowapp_rag');

describe('Pool de PostgreSQL: límites de tiempo explícitos (db.js)', () => {
  let principal;
  let rag;

  beforeAll(() => {
    // El módulo se carga una sola vez: los pools se construyen en el arranque.
    require('../config/db');
    principal = mockPoolOptions.find((o) => !esRag(o));
    rag = mockPoolOptions.find(esRag);
  });

  test('construye el pool principal con las opciones capturadas', () => {
    expect(principal).toBeDefined();
  });

  test('aplica un timeout de query para que una consulta colgada no retenga la conexión', () => {
    expect(esEnteroPositivo(principal.query_timeout)).toBe(true);
  });

  test('aplica statement_timeout del lado del servidor para cancelar statements atascados', () => {
    expect(esEnteroPositivo(principal.statement_timeout)).toBe(true);
  });

  test('aplica idle_in_transaction_session_timeout para no dejar transacciones idle reteniendo locks', () => {
    expect(esEnteroPositivo(principal.idle_in_transaction_session_timeout)).toBe(true);
  });

  // Guardas de regresión: estos límites ya existían y no deben perderse al
  // ampliar la configuración.
  test('conserva los límites de adquisición y de idle de conexión', () => {
    expect(esEnteroPositivo(principal.connectionTimeoutMillis)).toBe(true);
    expect(esEnteroPositivo(principal.idleTimeoutMillis)).toBe(true);
  });

  test('deja que el servidor cancele antes que el cliente (statement < query)', () => {
    expect(principal.query_timeout).toBeGreaterThan(principal.statement_timeout);
  });

  test('los timeouts son finitos y acotados, no esperas ilimitadas', () => {
    for (const nombre of ['query_timeout', 'statement_timeout', 'idle_in_transaction_session_timeout']) {
      expect(principal[nombre]).toBeLessThanOrEqual(300000);
    }
  });

  test('el pool RAG recibe los mismos límites de tiempo', () => {
    expect(rag).toBeDefined();
    expect(esEnteroPositivo(rag.query_timeout)).toBe(true);
    expect(esEnteroPositivo(rag.statement_timeout)).toBe(true);
    expect(esEnteroPositivo(rag.idle_in_transaction_session_timeout)).toBe(true);
  });
});
