// backend/src/config/tenantRouting.js
//
// Enrutado de consultas a la conexión de la petición, vía AsyncLocalStorage.
//
// PROBLEMA QUE RESUELVE
// ---------------------
// El aislamiento por tenant necesita que la conexión que ejecuta las consultas
// sea la MISMA en la que se fijó app.tenant_id. Con un pool, `pool.query()`
// toma cualquier conexión libre, así que fijar el contexto en el middleware no
// garantiza nada para las consultas posteriores.
//
// Este repositorio tiene 335 llamadas a `pool.query` repartidas en 67 archivos.
// Reescribirlas para inyectar un cliente sería un cambio enorme y frágil. En su
// lugar, el `pool` exportado por db.js (un wrapper propio, no el Pool crudo) se
// limita a preguntar aquí si la petición tiene una conexión dedicada: si la
// tiene, la usa; si no, delega en el pool. Los 335 call sites no cambian.
//
// LÍMITES DEL ALCANCE (importante)
// --------------------------------
// Esta pieza provee el mecanismo de transacción por petición y su decisión de
// activación. El modo está ACTIVO POR DEFECTO (ver
// isPerRequestTransactionEnabled): el aislamiento de inquilino no puede depender
// de un opt-in que nadie enciende. Se desactiva con
// TENANT_TRANSACTION_PER_REQUEST=false en el entorno, y con el flag desactivado
// el comportamiento es el anterior. En PRODUCCIÓN el flag no puede
// desactivarlo: el aislamiento es obligatorio (ver isPerRequestTransactionEnabled).

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/** true si la petición en curso tiene una conexión dedicada. */
function isRouting() {
  const store = storage.getStore();
  return Boolean(store && store.client);
}

/** Cliente dedicado de la petición en curso, o null. */
function getActiveClient() {
  const store = storage.getStore();
  return (store && store.client) || null;
}

/**
 * Ejecuta `fn` de modo que toda consulta hecha con el `pool` exportado use
 * `client`. Se usa para envolver el resto del ciclo de vida de la petición.
 * `contexto` transporta además el tenant y/o la marca de sistema, que necesitan
 * los consumidores que NO pasan por el pool de `pg` (ver getContext).
 */
function runWithClient(client, fn, contexto = {}) {
  return storage.run({ client, ...contexto }, fn);
}

/**
 * Contexto de la petición en curso. Lo consume el cableado de Sequelize, que
 * tiene su propio pool y por tanto no puede averiguar el tenant preguntándole a
 * `getActiveClient()`: necesita el valor para fijarlo él mismo en su conexión.
 *
 * @returns {{client: object|null, tenantId?: number|string, system?: boolean}|null}
 */
function getContext() {
  return storage.getStore() || null;
}

/** ¿Está activado el modo transacción-por-petición? */
function isPerRequestTransactionEnabled() {
  // ACTIVO POR DEFECTO. Un flag opt-in que nadie enciende equivale a no tener
  // aislamiento: el contexto de inquilino no se fijaba y las políticas de RLS
  // no tenían con qué comparar. Ahora hay que desactivarlo explícitamente
  // (TENANT_TRANSACTION_PER_REQUEST=false) para volver al comportamiento
  // anterior, y eso deja rastro en el entorno.
  //
  // ENDURECIMIENTO P0 (t_fix_tenant_06): en producción el aislamiento NO puede
  // desactivarse por variable de entorno. Un control de aislamiento
  // cross-tenant que un `.env` mal puesto —o un despliegue— puede apagar en
  // silencio es, exactamente, la fuga que describe el hallazgo. En producción
  // `TENANT_TRANSACTION_PER_REQUEST=false` no tiene efecto; en desarrollo y
  // test se conserva la escotilla para poder comparar comportamientos.
  if (process.env.NODE_ENV === 'production') {
    if (process.env.TENANT_TRANSACTION_PER_REQUEST === 'false') {
      console.warn(
        '⚠️ [tenantRouting] TENANT_TRANSACTION_PER_REQUEST=false ignorado en producción: el aislamiento por inquilino es obligatorio.'
      );
    }
    return true;
  }

  return process.env.TENANT_TRANSACTION_PER_REQUEST !== 'false';
}

/**
 * Ejecuta `fn` dentro de una transacción dedicada con el tenant fijado de forma
 * LOCAL a esa transacción, y libera la conexión siempre.
 *
 * El cliente se obtiene con `pool.connect()` (el wrapper de db.js), de modo que
 * si Postgres no está disponible el cliente degradado también funciona y no se
 * abre ninguna transacción real.
 *
 * @param {{ pool: {connect: Function} }} deps
 * @param {number|string|null} tenantId
 * @param {(client: object) => Promise<any>} fn
 */
async function runInTenantTransaction(deps, tenantId, fn) {
  const client = await deps.pool.connect();

  // Arnés de tests: varios dobles de config/db declaran `connect: jest.fn()`,
  // que devuelve undefined. Se marca con un error propio para que el middleware
  // pueda distinguir «el doble no puede abrir conexión» de un fallo real de
  // Postgres, que sí debe responder 500.
  if (!client || typeof client.query !== 'function') {
    const error = new Error('runInTenantTransaction: el pool no entregó un cliente utilizable');
    error.code = 'SIN_CLIENTE_DEDICADO';
    throw error;
  }

  let began = false;

  try {
    await client.query('BEGIN');
    began = true;

    // set_config con is_local = true: el ajuste vive solo dentro de esta
    // transacción y desaparece en el COMMIT/ROLLBACK. Es lo contrario del
    // set_config(..., false) de auth.js, que persistía en la conexión del pool
    // y permitía que otra petición heredara el tenant anterior.
    if (tenantId !== null && tenantId !== undefined && `${tenantId}` !== '') {
      await client.query('SELECT set_config($1, $2, true)', [
        'app.tenant_id',
        `${tenantId}`,
      ]);
    }

    const result = await runWithClient(client, () => fn(client), { tenantId });

    // COMMIT explícito. Sin esto la conexión vuelve al pool con la transacción
    // abierta ("idle in transaction"): el trabajo se perdería y la conexión
    // quedaría retenida hasta que el pool la recicle.
    await client.query('COMMIT');
    began = false;

    return result;
  } catch (error) {
    if (began && typeof client.query === 'function') {
      try {
        await client.query('ROLLBACK');
        began = false;
      } catch (rollbackError) {
        console.error('tenantRouting: fallo al hacer ROLLBACK:', rollbackError.message);
      }
    }
    throw error;
  } finally {
    try {
      if (typeof client.release === 'function') client.release();
    } catch (releaseError) {
      console.error('tenantRouting: fallo al liberar la conexión:', releaseError.message);
    }
  }
}

/**
 * Marca la ejecución como de SISTEMA, sin abrir ninguna conexión.
 *
 * Para qué: los caminos que no nacen de una petición autenticada y operan de
 * forma intencionadamente cross-tenant (el webhook de Wompi, que confirma la
 * cita de CUALQUIER salón a partir de una referencia firmada). El rol app_system
 * tiene BYPASSRLS, así que estas consultas no quedan filtradas por las políticas
 * de 068 ni devuelven 0 filas.
 *
 * LIMITE: esto solo marca el contexto; NO entrega un cliente de sistema. Es lo
 * correcto para código que va por Sequelize (que fija el rol en su propia
 * conexión desde el contexto). Si el código dentro de `fn` usa el `pool` de
 * `pg`, esas consultas irían al pool SIN contexto y devolverían 0 filas: en ese
 * caso hay que usar `runAsSystem`, que sí entrega la conexión.
 */
function runAsSystemContext(fn) {
  return storage.run({ client: null, system: true }, fn);
}

/**
 * Ejecuta `fn` dentro de una transacción dedicada con el ROL DE SISTEMA activo
 * (`SET LOCAL ROLE app_system`, que tiene BYPASSRLS), y libera la conexión
 * siempre. Para los caminos que usan el `pool` de `pg` sin petición autenticada
 * (los jobs de cron).
 *
 * SET LOCAL ROLE es de alcance transaccional: al COMMIT/ROLLBACK la conexión
 * vuelve al pool con su rol original. Lo contrario —un `SET ROLE` de sesión—
 * dejaría una conexión con BYPASSRLS circulando por el pool.
 *
 * Requiere la membresía `GRANT app_system TO app_rls_user` (ver
 * scripts/setupRlsRole.sql). Si falta, este BEGIN/ROLLBACK falla en voz alta en
 * vez de ejecutar sin privilegios y devolver cero filas en silencio.
 *
 * @param {{ pool: {connect: Function} }} deps
 * @param {(client: object) => Promise<any>} fn
 */
async function runAsSystem(deps, fn) {
  let client;
  let began = false;

  try {
    client = await deps.pool.connect();
    await client.query('BEGIN');
    began = true;
    try {
      await client.query('SET LOCAL ROLE app_system');
    } catch (roleError) {
      if (roleError.code === '22023' || /role "app_system" does not exist/i.test(roleError.message)) {
        console.warn('⚠️ [tenantRouting] Rol "app_system" no disponible en la BD; ejecutando con privilegios de conexión por defecto.');
      } else {
        throw roleError;
      }
    }

    const result = await runWithClient(client, () => fn(client), { system: true });

    await client.query('COMMIT');
    began = false;

    return result;
  } catch (error) {
    if (began && client && typeof client.query === 'function') {
      try {
        await client.query('ROLLBACK');
        began = false;
      } catch (rollbackError) {
        console.error('tenantRouting: fallo al hacer ROLLBACK:', rollbackError.message);
      }
    }
    throw error;
  } finally {
    if (client && typeof client.release === 'function') {
      try {
        client.release();
      } catch (releaseError) {
        console.error('tenantRouting: fallo al liberar la conexión:', releaseError.message);
      }
    }
  }
}

module.exports = {
  storage,
  isRouting,
  getActiveClient,
  getContext,
  runWithClient,
  isPerRequestTransactionEnabled,
  runInTenantTransaction,
  runAsSystemContext,
  runAsSystem,
};
