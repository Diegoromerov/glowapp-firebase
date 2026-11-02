// backend/src/tests/sequelizeTenantContext.test.js
//
// Prueba el cableado del contexto de inquilino al pool de SEQUELIZE.
//
// Por qué existe: `FORCE ROW LEVEL SECURITY` (migración 068) hace que una
// consulta sin contexto en la conexión devuelva 0 filas. El enrutado de `db.js`
// cubre el pool de `pg`, pero Sequelize tiene el suyo, así que sus consultas
// (los 4 controladores y el webhook de Wompi) necesitan su propio cableado.
// Un fallo aquí no lanza ningún error: devuelve resultados vacíos.
//
// Sin base de datos: se inyecta un ConnectionManager falso que registra las
// sentencias. Verifica lo que no se ve leyendo el código:
//   - contexto de inquilino -> set_config con el tenant,
//   - contexto de sistema   -> SET ROLE app_system (BYPASSRLS),
//   - sin contexto          -> no se toca la conexión,
//   - AL LIBERAR            -> se limpia. Esto es lo crítico: una conexión que
//     vuelve al pool con BYPASSRLS o con el inquilino de otro es peor que una
//     consulta vacía.

const tenantRouting = require('../config/tenantRouting');
const { cablearContextoEnSequelize } = require('../config/database');

let llamadas = [];
let conexionActual;

function conexionFalsa() {
  return {
    // Un pg.Client real expone `connectionParameters`; el desempaquetado del
    // cableado lo usa para distinguirlo de un ResourceLock de Sequelize.
    connectionParameters: {},
    query: async (text, params) => {
      llamadas.push(params === undefined ? text : `${text} :: ${JSON.stringify(params)}`);
      return { rows: [] };
    },
  };
}

function instanciaFalsa() {
  return {
    connectionManager: {
      getConnection: async () => conexionActual,
      releaseConnection: async () => { llamadas.push('RELEASE'); },
    },
  };
}

describe('cableado del contexto de inquilino en el pool de Sequelize', () => {
  let instancia;

  beforeEach(() => {
    llamadas = [];
    conexionActual = conexionFalsa();
    instancia = instanciaFalsa();
    cablearContextoEnSequelize(instancia);
  });

  test('sin contexto no se toca la conexión (los tests y los caminos públicos no pagan nada)', async () => {
    await instancia.connectionManager.getConnection({ type: 'write' });
    expect(llamadas).toEqual([]);
  });

  test('con contexto de inquilino la conexión recibe set_config para ESE tenant', async () => {
    await tenantRouting.runWithClient(null, () => instancia.connectionManager.getConnection({ type: 'write' }), { tenantId: 7 });

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toContain('set_config');
    expect(llamadas[0]).toContain('app.tenant_id');
    expect(llamadas[0]).toContain('"7"');
    // is_local debe ser FALSE aquí: la adquisición ocurre ANTES del BEGIN de
    // Sequelize, así que un `true` se evaporaría antes de la primera consulta.
    expect(llamadas[0]).toContain('false');
  });

  test('con contexto de sistema la conexión escala a app_system (BYPASSRLS)', async () => {
    await tenantRouting.runAsSystemContext(() => instancia.connectionManager.getConnection({ type: 'write' }));

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toBe('SET ROLE app_system');
  });

  test('un tenant vacío o nulo no genera ninguna sentencia', async () => {
    await tenantRouting.runWithClient(null, () => instancia.connectionManager.getConnection({ type: 'write' }), { tenantId: null });
    await tenantRouting.runWithClient(null, () => instancia.connectionManager.getConnection({ type: 'write' }), { tenantId: '' });

    expect(llamadas).toEqual([]);
  });

  test('al LIBERAR se limpia el inquilino: RESET ROLE + RESET app.tenant_id antes de devolverla', async () => {
    await tenantRouting.runWithClient(null, async () => {
      const conexion = await instancia.connectionManager.getConnection({ type: 'write' });
      await instancia.connectionManager.releaseConnection(conexion);
    }, { tenantId: 42 });

    expect(llamadas).toEqual([
      `SELECT set_config('app.tenant_id', $1, false) :: ["42"]`,
      'RESET ROLE',
      'RESET app.tenant_id',
      'RELEASE',
    ]);
  });

  test('una conexión SIN contexto se libera sin RESET (no se limpia lo que no se ensució)', async () => {
    const conexion = await instancia.connectionManager.getConnection({ type: 'write' });
    await instancia.connectionManager.releaseConnection(conexion);

    expect(llamadas).toEqual(['RELEASE']);
  });

  test('cablear dos veces no envuelve dos veces (idempotente)', async () => {
    cablearContextoEnSequelize(instancia);
    cablearContextoEnSequelize(instancia);

    await tenantRouting.runAsSystemContext(() => instancia.connectionManager.getConnection({ type: 'write' }));

    expect(llamadas).toEqual(['SET ROLE app_system']);
  });

  test('se desempaqueta un ResourceLock de Sequelize (la conexión no está en la raíz)', async () => {
    const conexionEnvuelta = conexionFalsa();
    conexionActual = { connection: conexionEnvuelta }; // sin connectionParameters

    await tenantRouting.runAsSystemContext(() => instancia.connectionManager.getConnection({ type: 'write' }));

    expect(llamadas).toEqual(['SET ROLE app_system']);
  });
});
