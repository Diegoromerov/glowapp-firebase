// backend/src/tests/tenantAuthIsolation.test.js
//
// Hallazgo P0 (tarjeta t_fix_tenant_04): "set_config app.tenant_id is_local=false
// fuga cross-tenant" — backend/src/middleware/auth.js (bloque `set_config(..., false)`).
//
// POR QUÉ ESTE TEST EXISTE
// ------------------------
// No basta con leer el código: el fallo es de ESTADO COMPARTIDO. `authMiddleware`
// ejecutaba `pool.query('SELECT set_config($1, $2, false)', ['app.tenant_id', …])`.
// El tercer argumento `false` (is_local) hace que el ajuste sea de alcance SESIÓN:
// sobrevive al fin de la petición y QUEDA PEGADO a la conexión que vuelve al pool.
// La siguiente petición que reutilice esa conexión —antes de fijar su propio
// contexto, o en un camino no autenticado— hereda el tenant anterior.
//
// Este test modela UNA conexión reutilizada del pool: el ajuste de sesión persiste
// entre llamadas. Reproduce la fuga sin base de datos real.
//
// Las variables referenciadas dentro de jest.mock() llevan prefijo `mock` por la
// restricción de hoisting de babel-plugin-jest-hoist.

// ── Modelo de la conexión reutilizada del pool ──────────────────────────────
// `mockTenantEnSesion` representa `current_setting('app.tenant_id')` a nivel de
// SESIÓN en la única conexión del pool. Un `set_config(..., false)` lo fija y
// NO se limpia al terminar la petición: eso es la fuga.
let mockTenantEnSesion = null;
// Rastro de sentencias para poder afirmar QUÉ se ejecutó.
const mockConsultas = [];

const mockPool = {
  query: async (text, params) => {
    mockConsultas.push(params === undefined ? text : `${text} :: ${JSON.stringify(params)}`);

    if (/set_config/i.test(text)) {
      // En auth.js el `is_local` es un literal SQL: set_config($1, $2, false).
      const esLocal = /,\s*true\s*\)/i.test(text);
      const valor = params && params[1] !== undefined ? String(params[1]) : null;
      if (esLocal) {
        // is_local = true: vive solo dentro de una transacción explícita. Sin
        // BEGIN, el ajuste se descarta y NO queda en la conexión.
        return { rows: [{ set_config: valor }] };
      }
      // is_local = false: queda fijado en la conexión para las siguientes consultas.
      mockTenantEnSesion = valor;
      return { rows: [{ set_config: valor }] };
    }

    if (/current_setting/i.test(text)) {
      return { rows: [{ current_setting: mockTenantEnSesion }] };
    }

    if (/FROM usuarios/i.test(text)) {
          return { rows: [{ rol: 'SALON', tenant_id: 1 }] };
        }

        if (/app_usuario_identidad/i.test(text)) {
          return { rows: [{ rol: 'SALON', tenant_id: 1 }] };
        }

    return { rows: [] };
  },
  connect: async () => mockPool,
  on: () => {},
};

jest.mock('../config/db', () => ({ pool: mockPool }));

const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/jwt');
const { authMiddleware } = require('../middleware/auth');

function tokenDeUsuario(id) {
  return jwt.sign({ id, email: `user${id}@demo.com` }, getJwtSecret());
}

function fakeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

// Ejecuta authMiddleware para un usuario y devuelve el req resultante.
async function autenticar(id) {
  const req = { header: (h) => (h === 'Authorization' ? `Bearer ${tokenDeUsuario(id)}` : undefined) };
  const res = fakeRes();
  const next = jest.fn();
  await authMiddleware(req, res, next);
  return { req, res, next };
}

describe('Aislamiento de tenant en authMiddleware (P0 t_fix_tenant_04)', () => {
  beforeEach(() => {
    mockTenantEnSesion = null;
    mockConsultas.length = 0;
    // authMiddleware delega en middleware/tenantContext cuando el usuario tiene
    // tenant (fix/rls-tenant-context). Aquí se prueba la ausencia de fuga a nivel
    // de SESIÓN, no la capa transaccional: se deja tenantContext en passthrough
    // para que la cadena llame a next() sin abrir transacción sobre el pool falso.
    process.env.TENANT_TRANSACTION_PER_REQUEST = 'false';
  });

  test('la autenticación sigue poblando req.user (sin regresión funcional)', async () => {
    const { req, next } = await autenticar(1);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user.tenant_id).toBe(1);
    expect(req.user.rol).toBe('SALON');
  });

  test('ROJO: una petición posterior NO debe heredar el tenant de la anterior (fuga cross-tenant)', async () => {
    // 1) Petición autenticada del tenant 1.
    await autenticar(1);

    // 2) Siguiente uso de la conexión reutilizada del pool: un camino que no fija
    //    contexto (p. ej. consulta previa a su propio set_config o ruta pública).
    const siguiente = await mockPool.query(
      "SELECT current_setting('app.tenant_id', true) AS current_setting"
    );

    // El ajuste de sesión de la petición anterior NO debe seguir ahí.
    expect(siguiente.rows[0].current_setting).toBeNull();
  });

  test('ROJO: authMiddleware no debe fijar app.tenant_id con is_local=false sobre el pool compartido', async () => {
    await autenticar(1);

    const setConfigSesion = mockConsultas.filter(
      (c) => /set_config/i.test(c) && !/,\s*true\s*\)/i.test(c)
    );

    expect(setConfigSesion).toEqual([]);
  });
});
